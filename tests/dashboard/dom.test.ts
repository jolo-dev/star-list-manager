import {expect, test} from 'bun:test'
import {readFile} from 'node:fs/promises'
import {Window} from 'happy-dom'
import type {
  MembershipMutationDetails,
  MutationBatchRecord,
  MutationJobRecord,
  MutationJobStatus,
  MutationRecoveryStatus,
  OperationHistoryRecord,
  RepositoryRecord,
  SyncKind,
  SyncStateRecord
} from '../../src/domain/types'
import type {
  AppState,
  MembershipListPreviewItem,
  StableMembershipPreviewResponse
} from '../../src/shared/messages'
import {
  buildLibraryRepositories,
  queryRepositories
} from '../../src/dashboard/library'

test('mounts one main landmark without a broad application live region', async () => {
  const indexHtml = await readFile(
    new URL('../../src/dashboard/index.html', import.meta.url),
    'utf8'
  )
  expect(indexHtml).toContain('<meta name="color-scheme" content="light dark" />')
  expect(indexHtml).toContain('<div id="app"></div>')
  expect(indexHtml).not.toMatch(/<main id="app"/)
  expect(indexHtml).not.toMatch(/id="app"[^>]*aria-live/)

  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  const globalKeys = ['window', 'document', 'HTMLElement', 'Text', 'Event', 'KeyboardEvent'] as const
  const previousGlobals = new Map(
    globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  )
  const root = browserWindow.document.createElement('div')
  try {
    Object.assign(globalThis, {
      window: browserWindow,
      document: browserWindow.document,
      HTMLElement: browserWindow.HTMLElement,
      Text: browserWindow.Text,
      Event: browserWindow.Event,
      KeyboardEvent: browserWindow.KeyboardEvent
    })
    const {mountDashboard} = await import('../../src/dashboard/scripts')
    root.id = 'app'
    browserWindow.document.body.append(root)
    mountDashboard(root as unknown as HTMLElement)

    expect(root.querySelectorAll('main')).toHaveLength(1)
    expect(root.querySelector('main')?.classList.contains('workspace')).toBe(true)
    expect(root.hasAttribute('aria-live')).toBe(false)
    expect(root.querySelector('nav[aria-label="Library"]')).not.toBeNull()
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(root.textContent).toContain('Star List')
    const unlist = [...root.querySelectorAll('button')].find(
      (element) => element.textContent?.includes('Unlist')
    )
    expect(unlist?.getAttribute('aria-current')).toBe('page')
  } finally {
    root.remove()
    for (const key of globalKeys) {
      const descriptor = previousGlobals.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
})

test('renders the Archive.Stars frame without changing repository activation contracts', async () => {
  const ready = readyDashboardState()
  const secondRepository = repositoryRecord('42', 'R_two', 'octocat/two')
  const root = await mountReadyDashboard({
    ...ready,
    library: {
      ...ready.library!,
      repositories: [...ready.library!.repositories, secondRepository]
    }
  })
  const browserWindow = window as unknown as Window
  const shell = root.querySelector<HTMLElement>('.archive-app-shell')
  const frame = root.querySelector<HTMLElement>('.archive-workspace-frame')
  const header = root.querySelector<HTMLElement>('.archive-app-header')
  const directory = root.querySelector<HTMLElement>('.archive-directory')
  const results = root.querySelector<HTMLElement>('main.workspace.archive-results')

  expect(shell).not.toBeNull()
  expect(root.querySelector('.app-shell')).toBeNull()
  expect(frame).not.toBeNull()
  expect(root.querySelector('.archive-workspace')).toBeNull()
  expect(header).not.toBeNull()
  expect(header?.querySelector('.archive-wordmark')?.textContent).toContain('Archive.Stars')
  expect(directory?.querySelector('nav')?.getAttribute('aria-label')).toBe('Library')
  expect(results?.parentElement).toBe(frame)
  expect(root.querySelector('div.archive-results')).toBeNull()
  expect(
    [...(header?.querySelectorAll<HTMLButtonElement>('.archive-utility-link') ?? [])].map(
      (element) => element.textContent
    )
  ).toEqual(expect.arrayContaining(['Operations', 'Settings']))

  const repositoryList = results?.querySelector<HTMLUListElement>('.repository-list') ?? null
  const rows = [...(repositoryList?.querySelectorAll<HTMLButtonElement>('.repository-row') ?? [])]
  const firstRow = rows[0] ?? null
  const nextRow = rows[1] ?? null
  expect(repositoryList?.getAttribute('aria-label')).toBe('Repositories')
  expect(firstRow?.tagName).toBe('BUTTON')
  expect(firstRow?.dataset.repositoryNodeId).toBe('R_one')
  expect(nextRow?.dataset.repositoryNodeId).toBe('R_two')
  if (firstRow === null || nextRow === null) throw new Error('Repository rows are required.')

  firstRow.focus()
  firstRow.dispatchEvent(
    new browserWindow.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}) as unknown as Event
  )
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  const focusedNextRow = browserWindow.document.querySelector(
    '[data-repository-node-id="R_two"]'
  )
  if (focusedNextRow === null) throw new Error('Focused repository row is required.')
  expect(browserWindow.document.activeElement === focusedNextRow).toBe(true)
  focusedNextRow.dispatchEvent(new browserWindow.MouseEvent('click', {bubbles: true}))
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(results?.querySelector('.repository-inspection-dialog h2')?.textContent).toBe('two')

  const utilityButton = (label: string) =>
    [...(header?.querySelectorAll<HTMLButtonElement>('.archive-utility-link') ?? [])].find(
      (element) => element.textContent === label
    ) ?? null
  utilityButton('Operations')?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(results?.querySelector('.operations-page h1')?.textContent).toBe('Operations')
  utilityButton('Settings')?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(results?.querySelector('.settings-page h1')?.textContent).toBe('Settings')
})

test('groups real View options and Filters under one archive Status container', async () => {
  const root = await mountReadyDashboard()
  const browserWindow = window as unknown as Window
  const heading = root.querySelector<HTMLElement>('.archive-filter-heading')
  const containers = [
    ...root.querySelectorAll<HTMLElement>(
      'section.archive-filter-container[aria-labelledby="archive-filter-heading"]'
    )
  ]

  expect(containers).toHaveLength(1)
  const container = containers[0] ?? null
  expect(container?.tagName).toBe('SECTION')
  expect(container?.contains(heading ?? document.createElement('h2'))).toBe(true)

  const viewOptions = container?.querySelector<HTMLDetailsElement>('details.view-options') ?? null
  const advancedFilters =
    container?.querySelector<HTMLDetailsElement>('details.advanced-filters') ?? null
  expect(viewOptions).not.toBeNull()
  expect(advancedFilters).not.toBeNull()
  expect(viewOptions?.parentElement).toBe(container)
  expect(advancedFilters?.parentElement).toBe(container)
  expect(viewOptions?.querySelector('summary')?.textContent).toBe('View options')
  expect(advancedFilters?.querySelector('summary')?.textContent).toBe('Filters')

  const archiveControl =
    [...(viewOptions?.querySelectorAll<HTMLButtonElement>('.filter-toggle') ?? [])].find((button) =>
      button.textContent?.startsWith('Archived')
    ) ?? null
  const starState = advancedFilters?.querySelector<HTMLSelectElement>('select') ?? null
  const clearFilters = advancedFilters?.querySelector<HTMLButtonElement>('.clear-filters') ?? null
  expect(archiveControl?.tagName).toBe('BUTTON')
  expect(starState?.tagName).toBe('SELECT')
  expect(clearFilters?.tagName).toBe('BUTTON')

  try {
    expect(archiveControl?.textContent).toBe('Archived hidden')
    archiveControl?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(archiveControl?.textContent).toBe('Archived shown')

    if (starState === null) throw new Error('Star state control is required.')
    starState.value = 'unstarred'
    starState.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.querySelector('.advanced-filters .filter-count')?.textContent).toBe('1')

    clearFilters?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.querySelector('.advanced-filters .filter-count')).toBeNull()
  } finally {
    if (archiveControl?.textContent === 'Archived shown') archiveControl.click()
    clearFilters?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
  }
})

test('renders archive directory and archive result archive markup for the ready library', async () => {
  const root = await mountReadyDashboard()

  expect(root.querySelector('.archive-directory-heading')?.textContent).toContain('Directory')
  expect(root.querySelector('.archive-filter-heading')?.textContent).toContain('Status')
  expect(root.querySelector('.archive-result-count')?.textContent).toMatch(/repositories/)
  expect(root.querySelector('.repository-row .archive-repository-reference')).not.toBeNull()
})

test('uses only targeted dashboard live regions', async () => {
  const root = await mountReadyDashboard()
  const selection = root.querySelector<HTMLInputElement>('.selection-control input')
  selection?.click()
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  const implicitStatuses = [...root.querySelectorAll<HTMLElement>('[role="status"]')]
  const explicitLiveRegions = [...root.querySelectorAll<HTMLElement>('[aria-live]')]

  expect(implicitStatuses.map((region) => region.className).sort()).toEqual(
    expect.arrayContaining([
      'result-count',
      'selection-announcement',
      'status-stack'
    ])
  )
  expect(explicitLiveRegions).toEqual([])
  expect(root.querySelector('.selection-bar')?.hasAttribute('role')).toBe(false)
  expect(root.querySelector('.selection-bar')?.hasAttribute('aria-live')).toBe(false)
  for (const region of implicitStatuses) {
    expect(region.querySelector('button, a, input, select, textarea, [role="status"]')).toBeNull()
    expect(region.closest('[role="status"]')).toBe(region)
  }
  expect(root.querySelector('nav [role="status"], [role="dialog"] [role="status"]')).toBeNull()
})

test('rejects hidden, inert, closed-details, aria-hidden, and disabled focus targets', async () => {
  const browserWindow = createDashboardWindow()
  const {isDashboardFocusTargetVisible} = await import('../../src/dashboard/scripts')
  const host = browserWindow.document.createElement('div')
  const details = browserWindow.document.createElement('details')
  const summary = browserWindow.document.createElement('summary')
  const button = browserWindow.document.createElement('button')
  summary.textContent = 'Toggle'
  details.append(summary, button)
  host.append(details)
  browserWindow.document.body.append(host)

  expect(isDashboardFocusTargetVisible(summary as unknown as HTMLElement)).toBe(true)
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
  details.open = true
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(true)
  button.disabled = true
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
  button.disabled = false
  host.setAttribute('aria-hidden', 'true')
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
  host.removeAttribute('aria-hidden')
  host.setAttribute('inert', '')
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
  host.removeAttribute('inert')
  host.hidden = true
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
  host.hidden = false
  host.style.display = 'none'
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
  host.style.display = ''
  host.style.visibility = 'hidden'
  expect(isDashboardFocusTargetVisible(button as unknown as HTMLElement)).toBe(false)
})

test('transitions a cold loading mount through ready utilities and recreates after phase exit', async () => {
  const browserWindow = createDashboardWindow()
  const {mountDashboard, renderAppState} = await import('../../src/dashboard/scripts')
  const root = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  mountDashboard(root)
  expect(root.querySelector('[aria-busy="true"]')).not.toBeNull()

  const ready: AppState = {
    ...readyDashboardState(),
    sync: completeSyncState('stars'),
    nativeListSync: completeSyncState('native-lists')
  }
  renderAppState(ready)
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.library-page')).not.toBeNull()

  const navigate = async (label: string) => {
    [...root.querySelectorAll<HTMLButtonElement>('.nav-item')]
      .find((button) => button.querySelector('.nav-label')?.textContent === label)!
      .click()
    await browserWindow.happyDOM.whenAsyncComplete()
  }
  await navigate('Operations')
  expect(root.querySelector('.operations-page h1')?.textContent).toBe('Operations')
  await navigate('Settings')
  const firstSettingsPage = root.querySelector('.settings-page')
  expect(firstSettingsPage?.querySelector('h1')?.textContent).toBe('Settings')

  renderAppState({...ready, phase: 'loading'})
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.settings-page')).toBeNull()
  renderAppState(ready)
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.settings-page')).not.toBe(firstSettingsPage)
  expect(root.querySelector('.settings-page h1')?.textContent).toBe('Settings')
})

test('renders only GitHub Lists in the directory before alphabetized imported native Lists', async () => {
  const readyState = readyDashboardState()
  const state: AppState = {
    ...readyState,
    library: {
      ...readyState.library!,
      nativeLists: [
        nativeList('L_zulu', 'Zulu List'),
        nativeList('L_alpha', 'Alpha List'),
        nativeList('L_middle', 'Middle List')
      ]
    }
  }
  const root = await mountReadyDashboard(state)
  const sidebar = sidebarNavigation(root)
  const groups = [...(sidebar?.querySelectorAll('details.nav-group') ?? [])]
  const githubLists = navigationGroup(sidebar, 'GitHub Lists')

  expect(groups).toHaveLength(1)
  expect(groups.map((group) => navigationGroupSummary(group)?.textContent)).toEqual(['GitHub Lists'])
  expect(githubLists?.hasAttribute('open')).toBe(true)
  expect(navigationGroup(sidebar, 'Utilities')).toBeNull()
  expect(navigationLabels(directNavigationList(githubLists))).toEqual([
    'Unlist',
    'Alpha List',
    'Middle List',
    'Zulu List'
  ])
  expect(root.querySelectorAll('[data-view-kind="operations"]')).toHaveLength(1)
  expect(root.querySelectorAll('[data-view-kind="settings"]')).toHaveLength(1)
})

test('keeps Operations and Settings reachable through utility navigation', async () => {
  const browserWindow = createDashboardWindow()
  const root = await mountReadyDashboard()
  const utilityButton = (label: string) =>
    [...(root.querySelectorAll<HTMLButtonElement>('.archive-utility-link'))].find(
      (button) => button.querySelector('.nav-label')?.textContent === label
    ) ?? null

  utilityButton('Operations')?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.operations-page h1')?.textContent).toBe('Operations')
  expect(utilityButton('Operations')?.getAttribute('aria-current')).toBe('page')

  utilityButton('Settings')?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.settings-page h1')?.textContent).toBe('Settings')
  expect(utilityButton('Settings')?.getAttribute('aria-current')).toBe('page')
})

test('selects Unlist as the active ready view with a population heading', async () => {
  const root = await mountReadyDashboard()
  const sidebar = sidebarNavigation(root)
  const active = sidebar?.querySelector('[aria-current="page"]')

  expect(active?.textContent).toContain('Unlist')
  expect(root.querySelector('.library-header h1')?.textContent).toBe('Starred repositories')
  expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Unlist')
})

test('hides completed unstars from default Unlist and retains explicit unstarred history', async () => {
  const readyState = readyDashboardState()
  const stillStarredStatuses: readonly MutationJobStatus[] = [
    'queued',
    'checking',
    'deleting',
    'verifying',
    'retry-waiting',
    'failed',
    'blocked-unknown',
    'cancelled'
  ]
  const completedStatuses: readonly MutationJobStatus[] = ['succeeded', 'succeeded-external']
  const stillStarredRepositories = stillStarredStatuses.map((status) =>
    repositoryRecord('42', `R_${status}`, `octocat/${status}`)
  )
  const completedRepositories = completedStatuses.map((status) => ({
    ...repositoryRecord('42', `R_${status}`, `octocat/${status}`),
    isStarred: false,
    unstarredAt: '2026-08-05T10:00:00Z'
  }))
  const starredListed = repositoryRecord('42', 'R_starred-listed', 'octocat/starred-listed')
  const repositories = [
    ...stillStarredRepositories,
    ...completedRepositories,
    starredListed
  ]
  const jobs = [...stillStarredStatuses, ...completedStatuses].map((status, index) => {
    const repository = repositories[index]!
    return {
      ...mutationJob('42', status, index),
      repositoryNodeId: repository.repositoryNodeId,
      ownerLogin: repository.ownerLogin,
      repositoryName: repository.name
    }
  })
  const state: AppState = {
    ...readyState,
    library: {
      ...readyState.library!,
      repositories,
      nativeLists: [nativeList('L_current', 'Current List')],
      nativeMemberships: [
        {
          githubUserId: '42',
          repositoryNodeId: 'R_starred-listed',
          listNodeId: 'L_current',
          lastObservedAt: '2026-08-04T10:00:00Z'
        }
      ],
      annotations: []
    },
    mutations: {jobs, batches: [], history: []}
  }
  const browserWindow = createDashboardWindow()
  const {mountDashboard} = await import('../../src/dashboard/scripts')
  const root = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  mountDashboard(root, state)
  await browserWindow.happyDOM.whenAsyncComplete()

  const defaultRepositoryIds = visibleRepositoryIds(root)
  expect(defaultRepositoryIds).toHaveLength(stillStarredStatuses.length)
  expect(defaultRepositoryIds).toEqual(
    expect.arrayContaining(stillStarredStatuses.map((status) => `R_${status}`))
  )
  expect(defaultRepositoryIds).not.toContain('R_succeeded')
  expect(defaultRepositoryIds).not.toContain('R_succeeded-external')
  expect(defaultRepositoryIds).not.toContain('R_starred-listed')
  expect(
    [...root.querySelectorAll('.repository-row .mutation-status')].map((status) =>
      status.getAttribute('data-status')
    )
  ).toEqual(expect.arrayContaining(stillStarredStatuses))

  const starStateSelect = [...root.querySelectorAll('label')].find(
    (label) => label.textContent?.includes('Star state')
  )?.querySelector('select') as HTMLSelectElement | null
  expect(starStateSelect).not.toBeNull()
  if (starStateSelect === null) return

  try {
    starStateSelect.value = 'unstarred'
    starStateSelect.dispatchEvent(
      new browserWindow.Event('change', {bubbles: true}) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()

    const unstarredRepositoryIds = visibleRepositoryIds(root)
    expect(unstarredRepositoryIds).toHaveLength(completedStatuses.length)
    expect(unstarredRepositoryIds).toEqual(
      expect.arrayContaining(['R_succeeded', 'R_succeeded-external'])
    )
    expect(
      [...root.querySelectorAll('.repository-row .mutation-status')].map((status) =>
        status.getAttribute('data-status')
      )
    ).toEqual(expect.arrayContaining(completedStatuses))
  } finally {
    // Module-level dashboard filter state is shared by this DOM suite; restore its default.
    starStateSelect.value = 'starred'
    starStateSelect.dispatchEvent(
      new browserWindow.Event('change', {bubbles: true}) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()
  }
})

test('resets a rendered ready dashboard to Unlist after another native List became active', async () => {
  const root = await mountReadyDashboard()
  const currentList = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.includes('Current List')
  ) ?? null
  expect(currentList).not.toBeNull()
  if (currentList === null) return

  currentList.dispatchEvent(new window.MouseEvent('click', {bubbles: true}) as unknown as Event)
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Current List')
  expect(root.querySelector('.library-header h1')?.textContent).toBe('Starred repositories')

  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState(readyDashboardState())
  expect(library.querySelector('.library-header .eyebrow')?.textContent).toBe('Unlist')
  expect(library.querySelector('.library-header h1')?.textContent).toBe('Starred repositories')
})

test('returns to Unlist when a normal refresh removes the active native List', async () => {
  const browserWindow = createDashboardWindow()
  const ready = readyDashboardState()
  const unlisted = repositoryRecord('42', 'R_unlisted', 'octocat/unlisted')
  const listed = repositoryRecord('42', 'R_listed', 'octocat/listed')
  const state: AppState = {
    ...ready,
    sync: completeSyncState('stars'),
    nativeListSync: completeSyncState('native-lists'),
    library: {
      ...ready.library!,
      repositories: [unlisted, listed],
      nativeLists: [nativeList('L_current', 'Current List')],
      nativeMemberships: [{
        githubUserId: '42',
        repositoryNodeId: listed.repositoryNodeId,
        listNodeId: 'L_current',
        lastObservedAt: '2026-08-04T10:00:00Z'
      }],
      annotations: []
    }
  }
  const refreshed: AppState = {
    ...state,
    library: {
      ...state.library!,
      nativeLists: [],
      nativeMemberships: []
    }
  }
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  const messages: string[] = []
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          messages.push(message.type)
          return {ok: true, data: refreshed}
        }
      }
    }
  })

  try {
    const {mountDashboard} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('main') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, state)
    await browserWindow.happyDOM.whenAsyncComplete()

    const currentList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (button) => button.querySelector('.nav-label')?.textContent === 'Current List'
    ) ?? null
    expect(currentList).not.toBeNull()
    if (currentList === null) throw new Error('Current List navigation is required.')
    currentList.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(visibleRepositoryIds(root)).toEqual(['R_listed'])
    currentList.focus()
    expect((browserWindow.document.activeElement as unknown) === currentList).toBe(true)

    const refresh = root.querySelector<HTMLButtonElement>('.refresh-button')
    expect(refresh).not.toBeNull()
    if (refresh === null) throw new Error('Refresh control is required.')
    refresh.click()
    await browserWindow.happyDOM.whenAsyncComplete()

    expect(messages).toEqual(['start-sync'])
    const activeNavigation = root.querySelector<HTMLButtonElement>(
      '.nav-item[aria-current="page"]'
    )
    expect(activeNavigation?.querySelector('.nav-label')?.textContent).toBe('Unlist')
    expect((browserWindow.document.activeElement as unknown) === activeNavigation).toBe(true)
    expect(visibleRepositoryIds(root)).toEqual(['R_listed', 'R_unlisted'])
  } finally {
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('returns sidebar selection to Unlist after disconnect and complete-data removal', async () => {
  for (const transition of [
    {actionLabel: 'Disconnect GitHub', messageType: 'disconnect'},
    {actionLabel: 'Delete all local data', messageType: 'clear-all-data'}
  ] as const) {
    const browserWindow = createDashboardWindow()
    const {mountDashboard, renderSettingsState} = await import(
      '../../src/dashboard/scripts'
    )
    const state = readyDashboardState()
    const root = browserWindow.document.createElement('main') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, state)
    await browserWindow.happyDOM.whenAsyncComplete()
    const currentList = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('Current List')
    ) ?? null
    expect(currentList).not.toBeNull()
    if (currentList === null) return
    currentList.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Current List')

    const messages: string[] = []
    const previousChrome = (globalThis as {chrome?: unknown}).chrome
    const confirmationWindow = browserWindow as unknown as {
      confirm: (message?: string) => boolean
    }
    const previousConfirm = confirmationWindow.confirm
    Object.assign(confirmationWindow, {confirm: () => true})
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          sendMessage: async (message: {readonly type: string}) => {
            messages.push(message.type)
            return {ok: true, data: signedOutDashboardState()}
          }
        }
      }
    })

    try {
      const settings = renderSettingsState(state)
      browserWindow.document.body.append(
        settings as unknown as Parameters<typeof browserWindow.document.body.append>[0]
      )
      const action = [...settings.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === transition.actionLabel
      ) ?? null
      expect(action).not.toBeNull()
      if (action === null) return

      action.dispatchEvent(
        new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
      )
      await browserWindow.happyDOM.whenAsyncComplete()

      expect(messages).toEqual([transition.messageType])
      const active = sidebarNavigation(root)?.querySelector('[aria-current="page"]')
      expect(active?.textContent).toContain('Unlist')
    } finally {
      Object.assign(confirmationWindow, {confirm: previousConfirm})
      if (previousChrome === undefined) {
        delete (globalThis as {chrome?: unknown}).chrome
      } else {
        Object.assign(globalThis, {chrome: previousChrome})
      }
    }
  }
})

test('keeps removed triage, local tag, history, and fixed utility destinations out of the directory', async () => {
  const root = await mountReadyDashboard()
  const sidebar = sidebarNavigation(root)

  for (const label of ['Triage', 'Local tags', 'Unstarred history', 'Operations', 'Settings']) {
    expect(sidebar?.textContent).not.toContain(label)
  }
})

test('keeps Star state within the selected population and renders exact headings', async () => {
  const browserWindow = createDashboardWindow()
  const root = await mountReadyDashboard()
  const currentList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.querySelector('.nav-label')?.textContent === 'Current List'
  )
  currentList?.click()
  await browserWindow.happyDOM.whenAsyncComplete()

  const starStateControl = () =>
    [...root.querySelectorAll('label')].find(
      (label) => label.firstElementChild?.textContent === 'Star state'
    )?.querySelector<HTMLSelectElement>('select') ?? null
  const currentListControl = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (button) => button.querySelector('.nav-label')?.textContent === 'Current List'
    ) ?? null
  const setStarState = async (value: string) => {
    const control = starStateControl()
    if (control === null) throw new Error('Star state control is required.')
    control.value = value
    control.dispatchEvent(
      new browserWindow.Event('change', {bubbles: true}) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()
  }
  expect(starStateControl()).not.toBeNull()

  try {
    expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Current List')
    expect(root.querySelector('.library-header h1')?.textContent).toBe('Starred repositories')
    expect(currentListControl()?.getAttribute('aria-current')).toBe('page')

    for (const [value, title] of [
      ['unstarred', 'Unstarred history'],
      ['all', 'All repositories'],
      ['starred', 'Starred repositories']
    ] as const) {
      await setStarState(value)
      expect(root.querySelector('.library-header h1')?.textContent).toBe(title)
      expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Current List')
      expect(currentListControl()?.getAttribute('aria-current')).toBe('page')
    }
  } finally {
    await setStarState('starred')
  }
})

test('counts only advanced controls and clears them without changing view options', async () => {
  const browserWindow = createDashboardWindow()
  const ready = readyDashboardState()
  const root = await mountReadyDashboard({
    ...ready,
    library: {
      ...ready.library!,
      repositories: ready.library!.repositories.map((repository) => ({
        ...repository,
        primaryLanguage: 'TypeScript'
      }))
    }
  })
  const controlByLabel = (text: string) =>
    [...root.querySelectorAll('label')].find(
      (label) => label.firstElementChild?.textContent === text
    )?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select') ?? null
  const archiveControl = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.filter-toggle')].find(
      (button) => button.textContent?.startsWith('Archived')
    ) ?? null
  const dispatchValue = async (control: HTMLInputElement | HTMLSelectElement, value: string) => {
    control.value = value
    control.dispatchEvent(
      new browserWindow.Event(
        control.tagName === 'INPUT' ? 'input' : 'change',
        {bubbles: true}
      ) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()
  }

  expect(root.querySelector('.advanced-filters .filter-count')).toBeNull()
  expect(archiveControl()?.textContent).toBe('Archived hidden')

  try {
    const search = controlByLabel('Search')
    if (search === null) throw new Error('Search control is required.')
    await dispatchValue(search, 'one')
    const language = controlByLabel('Language')
    if (language === null) throw new Error('Language control is required.')
    await dispatchValue(language, 'TypeScript')
    archiveControl()?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.querySelector('.advanced-filters .filter-count')).toBeNull()

    const starState = controlByLabel('Star state')
    if (starState === null) throw new Error('Star state control is required.')
    await dispatchValue(starState, 'unstarred')
    expect(root.querySelector('.advanced-filters .filter-count')?.textContent).toBe('1')

    root.querySelector<HTMLButtonElement>('.clear-filters')?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.querySelector('.advanced-filters .filter-count')).toBeNull()
    expect(controlByLabel('Search')?.value).toBe('one')
    expect(controlByLabel('Language')?.value).toBe('TypeScript')
    expect(archiveControl()?.textContent).toBe('Archived shown')
  } finally {
    const search = controlByLabel('Search')
    if (search) await dispatchValue(search, '')
    const language = controlByLabel('Language')
    if (language) await dispatchValue(language, '')
    if (archiveControl()?.textContent === 'Archived shown') archiveControl()?.click()
    const starState = controlByLabel('Star state')
    if (starState) await dispatchValue(starState, 'starred')
    await browserWindow.happyDOM.whenAsyncComplete()
  }
})

test('aligns Unlist and native List counts with the current archive scope', async () => {
  const browserWindow = createDashboardWindow()
  const ready = readyDashboardState()
  const activeUnlisted = repositoryRecord('42', 'R_active-unlisted', 'octocat/active-unlisted')
  const archivedUnlisted = {
    ...repositoryRecord('42', 'R_archived-unlisted', 'octocat/archived-unlisted'),
    archived: true
  }
  const activeListed = repositoryRecord('42', 'R_active-listed', 'octocat/active-listed')
  const archivedListed = {
    ...repositoryRecord('42', 'R_archived-listed', 'octocat/archived-listed'),
    archived: true
  }
  const state: AppState = {
    ...ready,
    library: {
      ...ready.library!,
      repositories: [activeUnlisted, archivedUnlisted, activeListed, archivedListed],
      nativeLists: [nativeList('L_current', 'Current List')],
      nativeMemberships: [activeListed, archivedListed].map((repository) => ({
        githubUserId: '42',
        repositoryNodeId: repository.repositoryNodeId,
        listNodeId: 'L_current',
        lastObservedAt: '2026-08-04T10:00:00Z'
      })),
      annotations: []
    }
  }
  const root = await mountReadyDashboard(state)
  const navigationCount = (label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (button) => button.querySelector('.nav-label')?.textContent === label
    )?.lastElementChild?.textContent
  const archiveControl = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.filter-toggle')].find(
      (button) => button.textContent?.startsWith('Archived')
    ) ?? null

  expect(visibleRepositoryIds(root)).toEqual(['R_active-unlisted'])
  expect(root.querySelector('.result-count')?.textContent).toContain('1 repositories')
  expect(navigationCount('Unlist')).toBe('1')
  expect(navigationCount('Current List')).toBe('1')
  const archiveToggle = archiveControl()
  expect(archiveToggle).not.toBeNull()
  if (archiveToggle === null) throw new Error('Archive visibility control is required.')

  const currentList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.querySelector('.nav-label')?.textContent === 'Current List'
  ) ?? null
  expect(currentList).not.toBeNull()
  if (currentList === null) throw new Error('Current List navigation is required.')
  currentList.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(visibleRepositoryIds(root)).toEqual(['R_active-listed'])
  expect(root.querySelector('.result-count')?.textContent).toContain('1 repositories')
  expect(navigationCount('Current List')).toBe('1')

  try {
    archiveControl()?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(visibleRepositoryIds(root)).toEqual([
      'R_active-listed',
      'R_archived-listed'
    ])
    expect(root.querySelector('.result-count')?.textContent).toContain('2 repositories')
    expect(navigationCount('Unlist')).toBe('2')
    expect(navigationCount('Current List')).toBe('2')
  } finally {
    if (archiveControl()?.textContent === 'Archived shown') archiveControl()?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
  }
})

test('renders GitHub Lists and Unlist without imported native Lists', async () => {
  const readyState = readyDashboardState()
  const state: AppState = {
    ...readyState,
    library: {
      ...readyState.library!,
      nativeLists: [],
      nativeMemberships: []
    }
  }
  const root = await mountReadyDashboard(state)
  const sidebar = sidebarNavigation(root)
  const githubLists = navigationGroup(sidebar, 'GitHub Lists')

  expect(githubLists).not.toBeNull()
  expect(navigationLabels(directNavigationList(githubLists))).toEqual(['Unlist'])
})

test('keeps a visible Search label beside the prominent Refresh control', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState(readyDashboardState())
  const headerControls = library.querySelector<HTMLElement>('.library-actions')
  expect(headerControls).not.toBeNull()
  if (headerControls === null) return
  const search = headerControls.querySelector<HTMLInputElement>('input[type="search"]')
  const refresh = directHeaderControl(headerControls, '.refresh-button')
  const filterContainer = headerControls.querySelector<HTMLElement>('.archive-filter-container')
  const viewOptions = directHeaderControl(filterContainer, 'details.view-options')
  const searchLabel = search?.labels?.[0] ?? null

  expect(search).not.toBeNull()
  expect(filterContainer).not.toBeNull()
  expect(viewOptions).not.toBeNull()
  expect(refresh?.textContent).toBe('Refresh')
  expect(searchLabel?.parentElement).toBe(headerControls)
  expect(refresh?.parentElement).toBe(headerControls)
  expect(viewOptions?.contains(search) ?? false).toBe(false)
  expect(viewOptions?.contains(refresh) ?? false).toBe(false)
  expect(searchLabel?.textContent?.trim()).toBe('Search')
  expect(searchLabel?.matches('.sr-only')).toBe(false)
  expect(searchLabel?.querySelector('.sr-only')).toBeNull()
  await browserWindow.happyDOM.whenAsyncComplete()
})

test('places language, sort, direction, and archive controls under View options', async () => {
  createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState(readyDashboardState())
  const headerControls = library.querySelector('.library-actions')
  const filterContainer = headerControls?.querySelector<HTMLElement>('.archive-filter-container') ?? null
  const viewOptions = directHeaderControl(filterContainer, 'details.view-options')
  const viewOptionControls = ['Language', 'Sort', 'Descending', 'Archived hidden']

  expect(filterContainer).not.toBeNull()
  expect(viewOptions).not.toBeNull()
  expect(viewOptions?.hasAttribute('open')).toBe(false)
  expect(viewOptions?.querySelector('summary')?.textContent).toBe('View options')
  expect(headerControlNames(viewOptions)).toEqual(expect.arrayContaining(viewOptionControls))
  expect(
    headerControlNamesOutside(headerControls, viewOptions).filter((name) =>
      viewOptionControls.includes(name)
    )
  ).toEqual([])
})

test('runs one shared repository query per flushed filter change', async () => {
  const browserWindow = createDashboardWindow()
  let queryCalls = 0
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const readyState = readyDashboardState()
  const state: AppState = {
    ...readyState,
    library: {
      ...readyState.library!,
      repositories: [
        {...readyState.library!.repositories[0]!, primaryLanguage: 'TypeScript'},
        {...repositoryRecord('42', 'R_two', 'github/two'), primaryLanguage: 'Rust'}
      ]
    }
  }
  const library = renderLibraryState(state, (...args) => {
    queryCalls += 1
    return queryRepositories(...args)
  })
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  await browserWindow.happyDOM.whenAsyncComplete()

  const labelledSelect = (labelText: string): HTMLSelectElement => {
    const label = [...library.querySelectorAll<HTMLLabelElement>('label')].find(
      (candidate) => candidate.textContent?.includes(labelText)
    )
    const control = label?.querySelector<HTMLSelectElement>('select') ?? null
    expect(control).not.toBeNull()
    return control!
  }
  const change = async (
    getControl: () => HTMLInputElement | HTMLSelectElement,
    value: string,
    eventName: 'input' | 'change',
    expectedIds: readonly string[]
  ) => {
    queryCalls = 0
    const control = getControl()
    control.value = value
    control.dispatchEvent(
      new browserWindow.Event(eventName, {bubbles: true}) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    await browserWindow.happyDOM.whenAsyncComplete()

    expect(queryCalls).toBe(1)
    expect(visibleRepositoryIds(library)).toEqual([...expectedIds])
    expect(library.querySelector('.result-count')?.textContent).toBe(
      `${expectedIds.length} repositories`
    )
    expect(queryCalls).toBe(1)
  }

  const search = () => library.querySelector<HTMLInputElement>('input[type="search"]')!
  await change(search, 'octocat/one', 'input', ['R_one'])
  await change(search, '', 'input', ['R_one', 'R_two'])
  await change(() => labelledSelect('Language'), 'TypeScript', 'change', ['R_one'])
  await change(() => labelledSelect('Language'), '', 'change', ['R_one', 'R_two'])
  await change(() => labelledSelect('Star state'), 'all', 'change', ['R_one', 'R_two'])
  await change(() => labelledSelect('Star state'), 'starred', 'change', ['R_one', 'R_two'])
  await change(() => labelledSelect('Sort'), 'name', 'change', ['R_one', 'R_two'])
  await change(() => labelledSelect('Sort'), 'starred-at', 'change', ['R_one', 'R_two'])

  queryCalls = 0
  library.querySelector<HTMLButtonElement>('[data-repository-node-id="R_two"]')!.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(queryCalls).toBe(0)
  expect(library.querySelector('.repository-inspection-dialog h2')?.textContent).toBe('two')
  expect(visibleRepositoryIds(library)).toEqual(['R_one', 'R_two'])

  await change(() => labelledSelect('Language'), 'TypeScript', 'change', ['R_one'])
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  expect(queryCalls).toBe(1)

  await change(() => labelledSelect('Language'), '', 'change', ['R_one', 'R_two'])
  library.remove()
})

test('stops repository queries after a rendered library is disconnected', async () => {
  const browserWindow = createDashboardWindow()
  let queryCalls = 0
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState(readyDashboardState(), (...args) => {
    queryCalls += 1
    return queryRepositories(...args)
  })
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  await browserWindow.happyDOM.whenAsyncComplete()
  const detachedSearch = library.querySelector<HTMLInputElement>('input[type="search"]')!

  library.remove()
  queryCalls = 0
  detachedSearch.value = 'disconnected'
  detachedSearch.dispatchEvent(
    new browserWindow.Event('input', {bubbles: true}) as unknown as Event
  )
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  expect(queryCalls).toBe(0)

  detachedSearch.value = ''
  detachedSearch.dispatchEvent(
    new browserWindow.Event('input', {bubbles: true}) as unknown as Event
  )
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(queryCalls).toBe(0)
})

test('keeps one library page while switching between Unlist and a native List', async () => {
  const root = await mountReadyDashboard(renameReadyDashboardState())
  const page = root.querySelector('.library-page')
  const currentList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.textContent?.includes('Current List')
  )!
  currentList.click()
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.library-page')).toBe(page)
  expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Current List')
  expect(root.querySelector('.native-list-header-editor')).not.toBeNull()
  expect(currentList.getAttribute('aria-current')).toBe('page')

  const unlist = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.textContent?.includes('Unlist')
  )!
  unlist.click()
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.library-page')).toBe(page)
  expect(root.querySelector('.library-header .eyebrow')?.textContent).toBe('Unlist')
  expect(unlist.getAttribute('aria-current')).toBe('page')
})

test('publishes the complete empty authentication state before awaiting the runtime', async () => {
  const browserWindow = createDashboardWindow()
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  let resolveResponse: (value: unknown) => void = () => undefined
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: () => new Promise((resolve) => {
          resolveResponse = resolve
        })
      }
    }
  })
  const {mountDashboard, sendDashboardAction} = await import(
    '../../src/dashboard/scripts'
  )
  const state = renameReadyDashboardState()
  const root = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  mountDashboard(root, state)
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.library-page')).not.toBeNull()

  try {
    const pending = sendDashboardAction({type: 'start-device-auth'})
    await browserWindow.happyDOM.whenAsyncComplete()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.querySelector('.library-page')).toBeNull()
    expect(root.textContent).not.toContain('Current List')
    expect(root.textContent).not.toContain('Connected as')

    resolveResponse({
      ok: true,
      data: {
        ...signedOutDashboardState(),
        phase: 'reauthentication'
      }
    })
    await pending
    await browserWindow.happyDOM.whenAsyncComplete()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(root.textContent).toContain('Preparing a new GitHub authorization')
    expect(root.querySelector('.library-page')).toBeNull()
  } finally {
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('projects repositories once per material library publication', async () => {
  const browserWindow = createDashboardWindow()
  const state = readyDashboardState()
  let projectionCalls = 0
  const countedBuilder: typeof buildLibraryRepositories = (snapshot) => {
    projectionCalls += 1
    return buildLibraryRepositories(snapshot)
  }
  const {mountDashboard, renderAppState} = await import('../../src/dashboard/scripts')
  const root = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )

  mountDashboard(root, state, queryRepositories, countedBuilder)
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(projectionCalls).toBe(1)

  renderAppState(structuredClone(state))
  renderAppState({
    ...state,
    mutations: {
      batches: [],
      jobs: [mutationJob('42', 'failed', 1)],
      history: []
    }
  })
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(projectionCalls).toBe(1)

  renderAppState({
    ...state,
    library: {
      ...state.library!,
      annotations: state.library!.annotations.map((annotation) => ({
        ...annotation,
        note: 'Material projection update'
      }))
    }
  })
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(projectionCalls).toBe(2)
})

test('rejects stale and out-of-order get-app-state responses', async () => {
  const browserWindow = createDashboardWindow()
  const accountA = membershipReadyDashboardState()
  const accountB = accountBDashboardState()
  const sameAccountNewer: AppState = {
    ...accountB,
    library: {
      ...accountB.library!,
      repositories: [repositoryRecord('7', 'R_newer', 'account-b/newer')],
      annotations: [],
      nativeMemberships: []
    }
  }
  const pendingResolvers: Array<(value: unknown) => void> = []
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: () => new Promise((resolve) => pendingResolvers.push(resolve))
      }
    }
  })

  try {
    const {mountDashboard, renderAppState, sendDashboardAction} = await import(
      '../../src/dashboard/scripts'
    )
    const root = browserWindow.document.createElement('main') as unknown as HTMLElement
    const sentinel = browserWindow.document.createElement('button')
    sentinel.textContent = 'Account B focus'
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0],
      sentinel
    )
    mountDashboard(root, accountA)

    const staleAccountRequest = sendDashboardAction({type: 'get-app-state'})
    renderAppState(accountB)
    await browserWindow.happyDOM.whenAsyncComplete()
    sentinel.focus()
    pendingResolvers.shift()?.({ok: true, data: accountA})
    await staleAccountRequest
    await nextTurn(browserWindow)

    expect((browserWindow.document.activeElement as unknown) === sentinel).toBe(true)
    await expectAccountBDashboard(root, browserWindow)
    root.querySelector<HTMLButtonElement>('[data-view-kind="unlist"]')?.click()
    await browserWindow.happyDOM.whenAsyncComplete()

    const olderRequest = sendDashboardAction({type: 'get-app-state'})
    const newerRequest = sendDashboardAction({type: 'get-app-state'})
    pendingResolvers[1]?.({ok: true, data: sameAccountNewer})
    await newerRequest
    await nextTurn(browserWindow)
    pendingResolvers[0]?.({ok: true, data: accountB})
    await olderRequest
    await nextTurn(browserWindow)
    expect(visibleRepositoryIds(root)).toEqual(['R_newer'])
  } finally {
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('keeps a membership confirmation authoritative over attempted polling and resumes polling afterward', async () => {
  const browserWindow = createDashboardWindow()
  const pendingMembership = deferred()
  const base = membershipReadyDashboardState()
  const pollingState: AppState = {
    ...base,
    mutations: {
      batches: [],
      jobs: [mutationJob('42', 'queued', 999)],
      history: []
    }
  }
  let getAppStateRequests = 0
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'preview-native-list-membership') {
        return {ok: true, data: membershipPreview('add', null)}
      }
      if (message.type === 'confirm-native-list-membership-preview') {
        await pendingMembership.promise
        return {ok: true, data: pollingState}
      }
      if (message.type === 'get-app-state') {
        getAppStateRequests += 1
        return {ok: true, data: base}
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })

  try {
    const {mountDashboard, sendDashboardAction} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, pollingState)
    await browserWindow.happyDOM.whenAsyncComplete()
    await openAndConfirmMembership(root, browserWindow)

    expect(await sendDashboardAction({type: 'get-app-state'})).toBe(false)
    expect(getAppStateRequests).toBe(0)
    expect(root.querySelector<HTMLButtonElement>('.membership-confirmation .primary-action')?.disabled).toBe(true)

    pendingMembership.resolve()
    await nextTurn(browserWindow)
    expect(root.querySelector('.membership-confirmation')).toBeNull()
    const row = root.querySelector<HTMLButtonElement>('.repository-row')
    expect(row?.isConnected).toBe(true)
    expect((browserWindow.document.activeElement as unknown) === row).toBe(true)

    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 1100))
    await nextTurn(browserWindow)
    expect(getAppStateRequests).toBe(1)
  } finally {
    pendingMembership.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('keeps an unstar confirmation authoritative over attempted polling and clears selection', async () => {
  const browserWindow = createDashboardWindow()
  const pendingUnstar = deferred()
  const base = membershipReadyDashboardState()
  const pollingState: AppState = {
    ...base,
    mutations: {
      batches: [],
      jobs: [mutationJob('42', 'queued', 999)],
      history: []
    }
  }
  let getAppStateRequests = 0
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'enqueue-confirmed-unstars') {
        await pendingUnstar.promise
        return {ok: true, data: base}
      }
      if (message.type === 'get-app-state') {
        getAppStateRequests += 1
        return {ok: true, data: pollingState}
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })

  try {
    const {mountDashboard, selectedUnstarRepositoryIds, sendDashboardAction} = await import(
      '../../src/dashboard/scripts'
    )
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, pollingState)
    await browserWindow.happyDOM.whenAsyncComplete()
    const checkbox = root.querySelector<HTMLInputElement>(
      'input[aria-label="Select octocat/one for unstar"]'
    )
    if (checkbox === null) throw new Error('Unstar selection did not render.')
    checkbox.checked = true
    checkbox.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
    await browserWindow.happyDOM.whenAsyncComplete()
    ;[...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Review unstar for 1')?.click()
    await nextTurn(browserWindow)
    ;[...root.querySelectorAll<HTMLButtonElement>('.unstar-confirmation button')]
      .find((button) => button.textContent?.includes('Confirm unstar'))?.click()

    expect(await sendDashboardAction({type: 'get-app-state'})).toBe(false)
    expect(getAppStateRequests).toBe(0)
    expect(selectedUnstarRepositoryIds()).toEqual(['R_one'])

    pendingUnstar.resolve()
    await nextTurn(browserWindow)
    expect(root.querySelector('.unstar-confirmation')).toBeNull()
    expect(selectedUnstarRepositoryIds()).toEqual([])
    const row = root.querySelector<HTMLButtonElement>('.repository-row')
    expect(row?.isConnected).toBe(true)
    expect((browserWindow.document.activeElement as unknown) === row).toBe(true)
  } finally {
    pendingUnstar.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('discards a poll that was already in flight when a foreground action begins', async () => {
  const browserWindow = createDashboardWindow()
  const pendingPoll = deferred()
  const pendingAction = deferred()
  const base = membershipReadyDashboardState()
  const pollState: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [repositoryRecord('42', 'R_poll', 'octocat/poll')],
      annotations: [],
      nativeMemberships: []
    }
  }
  const actionState: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [repositoryRecord('42', 'R_action', 'octocat/action')],
      annotations: [],
      nativeMemberships: []
    }
  }
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'get-app-state') {
        await pendingPoll.promise
        return {ok: true, data: pollState}
      }
      if (message.type === 'start-sync') {
        await pendingAction.promise
        return {ok: true, data: actionState}
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })

  try {
    const {mountDashboard, sendDashboardAction} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, base)
    const poll = sendDashboardAction({type: 'get-app-state'})
    const action = sendDashboardAction({type: 'start-sync', force: true})
    pendingAction.resolve()
    expect(await action).toBe(true)
    pendingPoll.resolve()
    expect(await poll).toBe(false)
    await nextTurn(browserWindow)
    expect(visibleRepositoryIds(root)).toEqual(['R_action'])
  } finally {
    pendingPoll.resolve()
    pendingAction.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('applies independent foreground responses in arrival order', async () => {
  const browserWindow = createDashboardWindow()
  const firstPending = deferred()
  const secondPending = deferred()
  const base = membershipReadyDashboardState()
  const firstState: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [repositoryRecord('42', 'R_first', 'octocat/first')],
      annotations: [],
      nativeMemberships: []
    }
  }
  const secondState: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [repositoryRecord('42', 'R_second', 'octocat/second')],
      annotations: [],
      nativeMemberships: []
    }
  }
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'start-sync') {
        await firstPending.promise
        return {ok: true, data: firstState}
      }
      if (message.type === 'disconnect-write-auth') {
        await secondPending.promise
        return {ok: true, data: secondState}
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })

  try {
    const {mountDashboard, sendDashboardAction} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, base)
    const first = sendDashboardAction({type: 'start-sync', force: true})
    const second = sendDashboardAction({type: 'disconnect-write-auth'})
    firstPending.resolve()
    expect(await first).toBe(true)
    await nextTurn(browserWindow)
    expect(visibleRepositoryIds(root)).toEqual(['R_first'])
    secondPending.resolve()
    expect(await second).toBe(true)
    await nextTurn(browserWindow)
    expect(visibleRepositoryIds(root)).toEqual(['R_second'])
  } finally {
    firstPending.resolve()
    secondPending.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('keeps dashboard nodes, focus, scroll, and query work stable across equivalent and mutation-only polls', async () => {
  const base = readyDashboardState()
  const failedJob = {
    ...mutationJob('42', 'failed', 1),
    repositoryNodeId: 'R_one'
  }
  const state: AppState = {
    ...base,
    mutations: {jobs: [failedJob], batches: [], history: []}
  }
  let queryCalls = 0
  const root = await mountReadyDashboard(state, (...args) => {
    queryCalls += 1
    return queryRepositories(...args)
  })
  const {renderAppState} = await import('../../src/dashboard/scripts')
  queryCalls = 0
  const directoryNavigation = root.querySelector('.archive-directory-nav')
  expect(directoryNavigation).not.toBeNull()
  const page = root.querySelector('.library-page')
  const list = root.querySelector<HTMLElement>('.repository-list')!
  const rows = [...root.querySelectorAll('.repository-row-shell')]
  const row = root.querySelector<HTMLElement>('.repository-row')!
  list.scrollTop = 96
  row.focus()

  renderAppState(structuredClone(state))
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.archive-directory-nav')).toBe(directoryNavigation)
  expect(root.querySelector('.library-page')).toBe(page)
  expect(root.querySelector('.repository-list')).toBe(list)
  rows.forEach((item, index) => expect(root.querySelectorAll('.repository-row-shell')[index]).toBe(item))
  expect(document.activeElement).toBe(row)
  expect(list.scrollTop).toBe(96)
  expect(queryCalls).toBe(0)

  const succeeded: AppState = {
    ...state,
    mutations: {
      jobs: [{...failedJob, status: 'succeeded', completedAt: '2026-08-04T10:01:00Z'}],
      batches: [],
      history: []
    }
  }
  renderAppState(succeeded)
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.archive-directory-nav')).toBe(directoryNavigation)
  expect(root.querySelector('.library-page')).toBe(page)
  expect(root.querySelector('.repository-list')).toBe(list)
  rows.forEach((item, index) => expect(root.querySelectorAll('.repository-row-shell')[index]).toBe(item))
  expect(root.querySelector('.repository-row')).toBe(row)
  expect(document.activeElement).toBe(row)
  expect(list.scrollTop).toBe(96)
  expect(root.querySelector('.mutation-status')?.getAttribute('data-status')).toBe('succeeded')
  expect(queryCalls).toBe(0)

  const navButton = root.querySelector<HTMLElement>('[aria-current="page"]')!
  navButton.focus()
  renderAppState(structuredClone(succeeded))
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.archive-directory-nav')).toBe(directoryNavigation)
  expect(root.querySelector('[aria-current="page"]')).toBe(navButton)
  expect(document.activeElement).toBe(navButton)
  expect(queryCalls).toBe(0)
})

test('updates material library metadata while restoring row and Search focus', async () => {
  const state = readyDashboardState()
  let queryCalls = 0
  const root = await mountReadyDashboard(state, (...args) => {
    queryCalls += 1
    return queryRepositories(...args)
  })
  const {renderAppState} = await import('../../src/dashboard/scripts')
  queryCalls = 0
  const page = root.querySelector('.library-page')
  const list = root.querySelector<HTMLElement>('.repository-list')!
  const row = root.querySelector<HTMLElement>('.repository-row')!
  list.scrollTop = 96
  row.focus()
  const renamed: AppState = {
    ...state,
    library: {
      ...state.library!,
      repositories: state.library!.repositories.map((repository) => ({
        ...repository,
        name: 'renamed',
        fullName: 'octocat/renamed',
        description: 'Updated description'
      })),
      nativeLists: state.library!.nativeLists.map((list) => ({
        ...list,
        name: 'Renamed List'
      }))
    }
  }
  renderAppState(renamed)
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.library-page')).toBe(page)
  expect(root.querySelector('.repository-row h2')?.textContent).toBe('renamed')
  expect(root.querySelector('.archive-directory-nav')?.textContent).toContain('Renamed List')
  expect(queryCalls).toBe(1)
  expect((document.activeElement as HTMLElement | null)?.dataset.repositoryNodeId).toBe('R_one')
  expect(root.querySelector<HTMLElement>('.repository-list')?.scrollTop).toBe(96)

  const search = root.querySelector<HTMLInputElement>('#library-search')!
  search.focus()
  search.value = 'rename'
  search.setSelectionRange(2, 5)
  const described: AppState = {
    ...renamed,
    library: {
      ...renamed.library!,
      repositories: renamed.library!.repositories.map((repository) => ({
        ...repository,
        description: 'Changed again'
      }))
    }
  }
  renderAppState(described)
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(document.activeElement).toBe(search)
  expect(search.value).toBe('rename')
  expect(search.selectionStart).toBe(2)
  expect(search.selectionEnd).toBe(5)
  expect(queryCalls).toBe(2)
})

test('restores focused native List navigation after material metadata publication', async () => {
  const state = renameReadyDashboardState()
  const root = await mountReadyDashboard(state)
  const {renderAppState} = await import('../../src/dashboard/scripts')
  const currentList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')]
    .find((button) => button.querySelector('.nav-label')?.textContent === 'Current List')!
  currentList.focus()

  renderAppState({
    ...state,
    library: {
      ...state.library!,
      nativeLists: state.library!.nativeLists.map((list) =>
        list.listNodeId === 'L_current' ? {...list, name: 'Renamed Current List'} : list
      )
    }
  })
  await (window as unknown as Window).happyDOM.whenAsyncComplete()

  const renamed = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')]
    .find((button) => button.dataset.viewKey === currentList.dataset.viewKey)!
  expect(renamed).not.toBe(currentList)
  expect(renamed.querySelector('.nav-label')?.textContent).toBe('Renamed Current List')
  expect(document.activeElement).toBe(renamed)
})

test('keeps Operations and Settings page content stable across unrelated slice updates', async () => {
  const base: AppState = {
    ...readyDashboardState(),
    sync: completeSyncState('stars'),
    nativeListSync: completeSyncState('native-lists')
  }
  const root = await mountReadyDashboard(base)
  const {renderAppState} = await import('../../src/dashboard/scripts')
  const navigationButton = (label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
      (button) => button.querySelector('.nav-label')?.textContent === label
    )!

  navigationButton('Operations').click()
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  const operationsPage = root.querySelector('.operations-page')
  const operationsContent = root.querySelector('.operations-page .state-page-content')
  const writeUpdated = {
    ...base,
    writeAuthorization: {...base.writeAuthorization, previewVisible: true}
  }
  renderAppState(writeUpdated)
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.operations-page')).toBe(operationsPage)
  expect(root.querySelector('.operations-page .state-page-content')).toBe(operationsContent)

  navigationButton('Settings').click()
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  const settingsPage = root.querySelector('.settings-page')
  const settingsContent = root.querySelector('.settings-page .state-page-content')
  renderAppState({
    ...writeUpdated,
    mutations: {
      jobs: [{...mutationJob('42', 'failed', 1), repositoryNodeId: 'R_one'}],
      batches: [],
      history: []
    }
  })
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.settings-page')).toBe(settingsPage)
  expect(root.querySelector('.settings-page .state-page-content')).toBe(settingsContent)
})

test('keeps library selection and status subtrees stable across unrelated slices', async () => {
  const state = readyDashboardState()
  const root = await mountReadyDashboard(state)
  const {renderAppState} = await import('../../src/dashboard/scripts')
  root.querySelector<HTMLInputElement>('.selection-control input')!.click()
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  const selection = root.querySelector('.selection-bar')
  const status = root.querySelector('.status-stack')

  renderAppState({...state, triageCounts: {inbox: 9, backlog: 8, due: 7, organized: 6}})
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.selection-bar')).toBe(selection)
  expect(root.querySelector('.status-stack')).toBe(status)
})

test('preserves repository focus and scroll across sort, filters, and List view changes', async () => {
  const base = readyDashboardState()
  const repositories = [
    {...base.library!.repositories[0]!, primaryLanguage: 'TypeScript'},
    {...repositoryRecord('42', 'R_two', 'octocat/two'), primaryLanguage: 'Rust'},
    {...repositoryRecord('42', 'R_three', 'octocat/three'), primaryLanguage: 'Go'}
  ]
  const state: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories,
      nativeLists: [
        ...base.library!.nativeLists,
        nativeList('L_other', 'Other List')
      ],
      nativeMemberships: repositories.flatMap((repository) => [
        {
          githubUserId: '42',
          repositoryNodeId: repository.repositoryNodeId,
          listNodeId: 'L_current',
          lastObservedAt: '2026-08-04T10:00:00Z'
        },
        {
          githubUserId: '42',
          repositoryNodeId: repository.repositoryNodeId,
          listNodeId: 'L_other',
          lastObservedAt: '2026-08-04T10:00:00Z'
        }
      ])
    }
  }
  const root = await mountReadyDashboard(state)
  const browserWindow = window as unknown as Window
  const search = root.querySelector<HTMLInputElement>('#library-search')!
  search.value = ''
  search.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
  const initialLanguage = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (label) => label.firstElementChild?.textContent === 'Language'
  )!.querySelector<HTMLSelectElement>('select')!
  initialLanguage.value = ''
  initialLanguage.dispatchEvent(
    new browserWindow.Event('change', {bubbles: true}) as unknown as Event
  )
  root.querySelector<HTMLButtonElement>('.clear-filters')?.click()
  const currentList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.querySelector('.nav-label')?.textContent === 'Current List'
  )!
  currentList.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  const focusedRepositoryId = 'R_two'
  const focusRow = () => root.querySelector<HTMLElement>(
    `.repository-row[data-repository-node-id="${focusedRepositoryId}"]`
  )!
  let list = root.querySelector<HTMLElement>('.repository-list')!
  list.scrollTop = 84
  focusRow().focus()

  const sort = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (label) => label.firstElementChild?.textContent === 'Sort'
  )!.querySelector<HTMLSelectElement>('select')!
  sort.value = 'name'
  sort.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  expect((document.activeElement as HTMLElement | null)?.dataset.repositoryNodeId).toBe(focusedRepositoryId)
  expect(root.querySelector<HTMLElement>('.repository-list')?.scrollTop).toBe(84)

  const assertQueryControlPreservesPosition = async (
    apply: () => void,
    scrollTop: number
  ) => {
    const currentListElement = root.querySelector<HTMLElement>('.repository-list')!
    currentListElement.scrollTop = scrollTop
    focusRow().focus()
    apply()
    await browserWindow.happyDOM.whenAsyncComplete()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    expect((document.activeElement as HTMLElement | null)?.dataset.repositoryNodeId).toBe(focusedRepositoryId)
    expect(root.querySelector<HTMLElement>('.repository-list')?.scrollTop).toBe(scrollTop)
  }
  await assertQueryControlPreservesPosition(() => {
    search.value = 'octocat'
    search.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
  }, 81)
  const starStateControl = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (label) => label.firstElementChild?.textContent === 'Star state'
  )!.querySelector<HTMLSelectElement>('select')!
  await assertQueryControlPreservesPosition(() => {
    starStateControl.value = 'all'
    starStateControl.dispatchEvent(
      new browserWindow.Event('change', {bubbles: true}) as unknown as Event
    )
  }, 79)
  const archiveControl = [...root.querySelectorAll<HTMLButtonElement>('.filter-toggle')].find(
    (button) => button.textContent?.startsWith('Archived')
  )!
  await assertQueryControlPreservesPosition(() => archiveControl.click(), 77)

  list = root.querySelector<HTMLElement>('.repository-list')!
  list.scrollTop = 73
  focusRow().focus()
  const otherList = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.querySelector('.nav-label')?.textContent === 'Other List'
  )!
  otherList.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  expect((document.activeElement as HTMLElement | null)?.dataset.repositoryNodeId).toBe(focusedRepositoryId)
  expect(root.querySelector<HTMLElement>('.repository-list')?.scrollTop).toBe(73)

  search.value = ''
  search.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
  starStateControl.value = 'starred'
  starStateControl.dispatchEvent(
    new browserWindow.Event('change', {bubbles: true}) as unknown as Event
  )
  archiveControl.click()
  sort.value = 'starred-at'
  sort.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  const unlist = [...root.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (button) => button.querySelector('.nav-label')?.textContent === 'Unlist'
  )!
  unlist.click()
  await browserWindow.happyDOM.whenAsyncComplete()
})

test('moves focus to an available repository when a filter removes the focused row', async () => {
  const base = readyDashboardState()
  const state: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [
        {...base.library!.repositories[0]!, primaryLanguage: 'TypeScript'},
        {...repositoryRecord('42', 'R_two', 'octocat/two'), primaryLanguage: 'Rust'},
        {...repositoryRecord('42', 'R_three', 'octocat/three'), primaryLanguage: 'TypeScript'}
      ]
    }
  }
  const root = await mountReadyDashboard(state)
  const browserWindow = window as unknown as Window
  const focused = root.querySelector<HTMLElement>(
    '.repository-row[data-repository-node-id="R_two"]'
  )!
  focused.focus()
  const language = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (label) => label.firstElementChild?.textContent === 'Language'
  )!.querySelector<HTMLSelectElement>('select')!
  language.value = 'TypeScript'
  language.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

  const active = document.activeElement as HTMLElement | null
  expect(active).not.toBe(document.body)
  expect(active?.classList.contains('repository-row')).toBe(true)
  expect(active?.dataset.repositoryNodeId).toBe('R_three')

  language.value = ''
  language.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
})

test('supersedes rapid query focus work and respects intentional focus movement', async () => {
  const base = readyDashboardState()
  const state: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [
        {...base.library!.repositories[0]!, primaryLanguage: 'TypeScript'},
        {...repositoryRecord('42', 'R_two', 'octocat/two'), primaryLanguage: 'Rust'}
      ]
    }
  }
  let queryCalls = 0
  const root = await mountReadyDashboard(state, (...args) => {
    queryCalls += 1
    return queryRepositories(...args)
  })
  queryCalls = 0
  const focused = root.querySelector<HTMLElement>(
    '.repository-row[data-repository-node-id="R_two"]'
  )!
  focused.focus()
  const search = root.querySelector<HTMLInputElement>('#library-search')!
  search.value = 'octocat'
  search.dispatchEvent(new Event('input', {bubbles: true}))
  const language = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.firstElementChild?.textContent === 'Language'
  )!.querySelector<HTMLSelectElement>('select')!
  language.value = 'TypeScript'
  language.dispatchEvent(new Event('change', {bubbles: true}))
  const intentionalTarget = root.querySelector<HTMLButtonElement>('.refresh-button')!
  intentionalTarget.focus()

  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(queryCalls).toBe(1)
  expect(root.querySelector('[data-repository-node-id="R_two"]')).toBeNull()
  expect(document.activeElement).toBe(intentionalTarget)
})

test('does not restore dashboard focus after focus moves outside its scope', async () => {
  const base = readyDashboardState()
  const state: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [
        {...base.library!.repositories[0]!, primaryLanguage: 'TypeScript'},
        {...repositoryRecord('42', 'R_two', 'octocat/two'), primaryLanguage: 'Rust'}
      ]
    }
  }
  const root = await mountReadyDashboard(state)
  const externalTarget = document.createElement('button')
  externalTarget.textContent = 'Outside dashboard'
  document.body.append(externalTarget)
  root.querySelector<HTMLElement>('[data-repository-node-id="R_two"]')!.focus()
  const language = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.firstElementChild?.textContent === 'Language'
  )!.querySelector<HTMLSelectElement>('select')!
  language.value = 'TypeScript'
  language.dispatchEvent(new Event('change', {bubbles: true}))
  externalTarget.focus()

  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('[data-repository-node-id="R_two"]')).toBeNull()
  expect(document.activeElement).toBe(externalTarget)
  externalTarget.remove()
})

test('cancels pending query reconciliation when its dashboard is unmounted', async () => {
  const base = readyDashboardState()
  const state: AppState = {
    ...base,
    library: {
      ...base.library!,
      repositories: [
        {...base.library!.repositories[0]!, primaryLanguage: 'TypeScript'},
        {...repositoryRecord('42', 'R_two', 'octocat/two'), primaryLanguage: 'Rust'}
      ]
    }
  }
  let queryCalls = 0
  const root = await mountReadyDashboard(state, (...args) => {
    queryCalls += 1
    return queryRepositories(...args)
  })
  queryCalls = 0
  root.querySelector<HTMLElement>('[data-repository-node-id="R_two"]')!.focus()
  const language = [...root.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.firstElementChild?.textContent === 'Language'
  )!.querySelector<HTMLSelectElement>('select')!
  language.value = 'TypeScript'
  language.dispatchEvent(new Event('change', {bubbles: true}))
  root.remove()

  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(queryCalls).toBe(0)
  expect(root.isConnected).toBe(false)
})

test('reindexes repository jobs when only the active account changes', async () => {
  const base = readyDashboardState()
  const jobs = [
    {...mutationJob('42', 'failed', 1), repositoryNodeId: 'R_one'},
    {...mutationJob('7', 'succeeded', 2), repositoryNodeId: 'R_one'}
  ]
  const state42: AppState = {
    ...base,
    sync: completeSyncState('stars'),
    nativeListSync: completeSyncState('native-lists'),
    mutations: {jobs, batches: [], history: []}
  }
  const root = await mountReadyDashboard(state42)
  const {renderAppState} = await import('../../src/dashboard/scripts')
  expect(root.querySelector('.mutation-status')?.getAttribute('data-status')).toBe('failed')

  renderAppState({
    ...state42,
    identity: {...state42.identity!, githubUserId: '7', userNodeId: 'U_7', login: 'seven'},
    sync: state42.sync ? {...state42.sync, githubUserId: '7'} : null,
    nativeListSync: state42.nativeListSync
      ? {...state42.nativeListSync, githubUserId: '7'}
      : null
  })
  await (window as unknown as Window).happyDOM.whenAsyncComplete()
  expect(root.querySelector('.mutation-status')?.getAttribute('data-status')).toBe('succeeded')
})

test('starts automatic synchronization once per active account', async () => {
  const {shouldStartAutoSync} = await import('../../src/dashboard/scripts')
  const accountState = (githubUserId: string): AppState => ({
    phase: 'ready',
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: `account-${githubUserId}`,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1'
    },
    authorization: null,
    writeAuthorization: {
      readiness: 'authorization-required',
      membershipReady: false,
      previewVisible: false,
      authorization: null,
      error: null
    },
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: null,
    mutations: null,
    error: null
  })

  expect(shouldStartAutoSync(accountState('101'), null)).toBe(true)
  expect(shouldStartAutoSync(accountState('101'), '101')).toBe(false)
  expect(shouldStartAutoSync(accountState('202'), '101')).toBe(true)
})

test('renders broad-scope disclosure before write device authorization', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {renderSettingsState} = await import('../../src/dashboard/scripts')
  const state = accountState('42', {
    readiness: 'authorization-required',
    membershipReady: false,
    previewVisible: true,
    authorization: null,
    error: null
  })

  const settings = renderSettingsState(state)
  expect(settings.textContent).toContain('public_repo')
  expect(settings.textContent).toContain('user')
  expect(settings.textContent).toContain('broader public-repository write access')
  expect(settings.textContent).toContain('broader profile authority')
  expect(settings.textContent).toContain('Starring status, star, and unstar routes')
  expect(settings.textContent).toContain('UpdateUserListsForItem')
  expect(settings.textContent).toContain('complete native List ID set')
  expect(settings.textContent).toContain('cannot send caller-provided GraphQL documents')
  expect(settings.textContent).toContain('Continue to GitHub')
  expect(settings.textContent).toContain('Cancel')
  expect(settings.textContent).not.toContain('access-secret')
})

test('renders non-secret write readiness and keeps native membership capability gated', async () => {
  createDashboardWindow()
  const {renderSettingsState} = await import('../../src/dashboard/scripts')
  const unverifiedBuildSettings = renderSettingsState({
    ...accountState('42', {
      readiness: 'ready',
      membershipReady: true,
      previewVisible: false,
      authorization: null,
      error: null
    }),
    nativeListMembership: {readiness: 'capability-unproven'}
  })
  const verifiedReleaseSettings = renderSettingsState({
    ...accountState('42', {
      readiness: 'authorization-required',
      membershipReady: false,
      previewVisible: false,
      authorization: null,
      error: null
    }),
    nativeListMembership: {readiness: 'write-authorization-required'}
  })

  expect(unverifiedBuildSettings.textContent).toContain(
    'account-scoped public_repo and user credential is ready'
  )
  expect(unverifiedBuildSettings.textContent).toContain('confirmed Starring routes')
  expect(unverifiedBuildSettings.textContent).toContain(
    'This build does not enable verified native List membership writes.'
  )
  expect(unverifiedBuildSettings.textContent).toContain(
    'GitHub write authorization alone does not prove a successful native List membership mutation.'
  )
  expect(verifiedReleaseSettings.textContent).toContain(
    'This verified release still needs GitHub write authorization before it can offer native List membership writes.'
  )
  expect(unverifiedBuildSettings.textContent).not.toContain('access-secret')
})

test('renders complete unstar confirmation and cancellation does not confirm', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {renderUnstarConfirmation} = await import('../../src/dashboard/scripts')
  let confirmations = 0
  let cancellations = 0
  const confirmation = renderUnstarConfirmation(
    accountState('42', {
      readiness: 'ready',
      membershipReady: true,
      previewVisible: false,
      authorization: null,
      error: null
    }),
    [
      {repositoryNodeId: 'R_one', fullName: 'octocat/one'},
      {repositoryNodeId: 'R_two', fullName: 'github/two'}
    ],
    () => {
      confirmations += 1
    },
    () => {
      cancellations += 1
    }
  )
  browserWindow.document.body.append(
    confirmation as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

  expect(confirmation.getAttribute('role')).toBe('presentation')
  const dialog = confirmation.querySelector('[role="dialog"]')
  expect(dialog?.getAttribute('aria-labelledby')).toBe('unstar-confirmation-title')
  expect(dialog?.getAttribute('aria-modal')).toBe('true')
  expect(accessibleDialogName(dialog)).toBe('Remove 2 stars from GitHub?')
  expect(confirmation.textContent).toContain('exactly 2 repositories')
  expect(confirmation.textContent).toContain('octocat/one')
  expect(confirmation.textContent).toContain('github/two')
  expect(confirmation.textContent).toContain('There is no Undo or re-star control')
  const cancel = [...confirmation.querySelectorAll('button')].find(
    (element) => element.textContent === 'Cancel'
  )
  expect((browserWindow.document.activeElement as unknown) === cancel).toBe(true)
  cancel?.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  expect(cancellations).toBe(1)
  expect(confirmations).toBe(0)
  // The public renderer exposes cancellation through this callback; pending targets stay private.
  const escape = new browserWindow.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true
  })
  dialog?.dispatchEvent(escape as unknown as Event)
  expect(escape.defaultPrevented).toBe(true)
  expect(cancellations).toBe(2)
  expect(confirmations).toBe(0)
})

test('gates unstar confirmation on write readiness', async () => {
  const {renderUnstarConfirmation} = await import('../../src/dashboard/scripts')
  const confirmation = renderUnstarConfirmation(
    accountState('42'),
    [{repositoryNodeId: 'R_one', fullName: 'octocat/one'}],
    () => undefined,
    () => undefined
  )
  const confirm = [...confirmation.querySelectorAll('button')].find((element) =>
    element.textContent?.includes('Confirm unstar')
  )
  expect(confirm?.hasAttribute('disabled')).toBe(true)
  expect(confirmation.textContent).toContain(
    'GitHub Starring write authorization must be ready'
  )
})

test('disables native membership review when membership readiness is unavailable', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState({
    ...membershipReadyDashboardState(),
    nativeListMembership: {readiness: 'capability-unproven'}
  })
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  const repositoryRow = library.querySelector<HTMLButtonElement>('.repository-row')
  expect(repositoryRow).not.toBeNull()
  if (repositoryRow === null) return
  repositoryRow.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  const listChoice = library.querySelector(
    '.native-list-choices input[type="checkbox"]'
  ) as HTMLInputElement | null

  expect(listChoice).not.toBeNull()
  if (listChoice === null) return

  listChoice.checked = true
  listChoice.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()

  const membershipActions = [
    ...library.querySelectorAll<HTMLButtonElement>('.membership-review')
  ]
  expect(membershipActions).not.toHaveLength(0)
  expect(membershipActions.every((action) => action.disabled)).toBe(true)
})

test('explains an active native List operation when membership review is disabled', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const activeMembershipJob: MutationJobRecord = {
    ...mutationJob('42', 'queued', 0),
    repositoryNodeId: 'R_one',
    mutationKind: 'native-list-membership',
    membershipDetails: membershipMutationDetails('queued')
  }
  const library = renderLibraryState({
    ...membershipReadyDashboardState(),
    mutations: {batches: [], jobs: [activeMembershipJob], history: []}
  })
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  await openRepositoryDetails(library, browserWindow)
  const listChoice = library.querySelector(
    '.inspector .native-list-choices input[type="checkbox"]'
  ) as HTMLInputElement | null

  expect(listChoice).not.toBeNull()
  if (listChoice === null) return

  listChoice.checked = true
  listChoice.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()

  const review = library.querySelector<HTMLButtonElement>('.inspector .membership-review')
  const descriptionId = review?.getAttribute('aria-describedby') ?? null
  const description = descriptionId === null
    ? null
    : library.querySelector(`#${descriptionId}`)

  expect(review?.disabled).toBe(true)
  expect(description).not.toBeNull()
  expect(description?.getAttribute('role')).toBe('status')
  expect(description?.textContent).toBe(
    'A native GitHub List membership operation is already active or queued for this repository. Wait for it to complete before reviewing another change.'
  )
})

test('selects rows without changing star state or local annotations', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {renderLibraryState, selectedUnstarRepositoryIds} = await import(
    '../../src/dashboard/scripts'
  )
  const repository = repositoryRecord('42', 'R_one', 'octocat/one')
  const state: AppState = {
    ...accountState('42', {
      readiness: 'ready',
      membershipReady: true,
      previewVisible: false,
      authorization: null,
      error: null
    }),
    library: {
      repositories: [repository],
      nativeLists: [],
      nativeMemberships: [],
      annotations: [
        {
          githubUserId: '42',
          repositoryNodeId: 'R_one',
          triageState: 'inbox',
          tags: ['keep'],
          note: 'Retain me',
          favorite: true,
          revisitAt: null,
          reviewedAt: null,
          localModifiedAt: '2026-08-04T10:00:00Z'
        }
      ]
    },
    mutations: {batches: [], jobs: [], history: []}
  }
  const before = JSON.stringify(state.library)
  const library = renderLibraryState(state)
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  const checkbox = library.querySelector(
    'input[aria-label="Select octocat/one for unstar"]'
  ) as HTMLInputElement | null
  expect(checkbox).not.toBeNull()
  if (checkbox) {
    checkbox.checked = true
    checkbox.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  }
  await browserWindow.happyDOM.whenAsyncComplete()

  expect(selectedUnstarRepositoryIds()).toEqual(['R_one'])
  expect(library.textContent).toContain('1 selected')
  expect(repository.isStarred).toBe(true)
  expect(JSON.stringify(state.library)).toBe(before)

  const review = [...library.querySelectorAll('button')].find(
    (element) => element.textContent === 'Review unstar for 1'
  )
  review?.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(library.querySelector('[role="dialog"]')).not.toBeNull()
})

test('uses a labelled repository button list and moves focus with arrow keys', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const first = repositoryRecord('42', 'R_one', 'octocat/one')
  const second = repositoryRecord('42', 'R_two', 'github/two')
  const library = renderLibraryState({
    ...membershipReadyDashboardState(),
    library: {
      repositories: [first, second],
      nativeLists: [],
      nativeMemberships: [],
      annotations: []
    },
    mutations: {batches: [], jobs: [], history: []}
  })
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  const repositoryList = library.querySelector('.repository-list')
  const rows = [...library.querySelectorAll<HTMLButtonElement>('.repository-row')]
  const firstRow = rows.find((row) => row.textContent?.includes('one')) ?? null
  const secondRow = rows.find((row) => row.textContent?.includes('two')) ?? null

  expect(repositoryList?.getAttribute('aria-label')).toBe('Repositories')
  expect(repositoryList?.getAttribute('role')).toBeNull()
  expect(firstRow?.getAttribute('role')).toBeNull()
  expect(firstRow?.getAttribute('aria-selected')).toBeNull()
  expect(firstRow).not.toBeNull()
  expect(secondRow).not.toBeNull()
  if (firstRow === null || secondRow === null) return

  firstRow.focus()
  firstRow.dispatchEvent(
    new browserWindow.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}) as unknown as Event
  )
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

  const focusedSecond = [...library.querySelectorAll<HTMLButtonElement>('.repository-row')].find(
    (row) => row.textContent?.includes('two')
  ) ?? null
  expect((browserWindow.document.activeElement as unknown) === focusedSecond).toBe(true)
  expect(focusedSecond?.classList.contains('is-selected')).toBe(true)
})

test('opens repository inspection in a modal only after a row is activated', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const repository = repositoryRecord('42', 'R_one', 'octocat/one')
  const library = renderLibraryState({
    ...membershipReadyDashboardState(),
    library: {
      repositories: [repository],
      nativeLists: [],
      nativeMemberships: [],
      annotations: []
    },
    mutations: {batches: [], jobs: [], history: []}
  })
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  const row = library.querySelector<HTMLButtonElement>('.repository-row')

  expect(library.querySelector('.library-grid > .inspector')).toBeNull()
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  expect(row).not.toBeNull()
  if (row === null) return

  row.dispatchEvent(new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event)
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

  const dialog = library.querySelector<HTMLElement>('.repository-inspection-dialog')
  expect(dialog?.getAttribute('role')).toBe('dialog')
  expect(dialog?.getAttribute('aria-modal')).toBe('true')
  expect(dialog?.textContent).toContain('octocat')
  expect(dialog?.textContent).toContain('Local organization')
  expect(dialog?.textContent).toContain('GitHub account changes')
})

test('dismisses repository inspection with Escape or its backdrop and restores row focus', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState(membershipReadyDashboardState())
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  const row = library.querySelector<HTMLButtonElement>('.repository-row')
  expect(row).not.toBeNull()
  if (row === null) return

  await openRepositoryDetails(library, browserWindow)
  const firstDialog = library.querySelector<HTMLElement>('.repository-inspection-dialog')
  firstDialog?.dispatchEvent(
    new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
  )
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  const restoredAfterEscape = library.querySelector<HTMLButtonElement>(
    '[data-dialog-invoker="repository-R_one"]'
  )
  expect((browserWindow.document.activeElement as unknown) === restoredAfterEscape).toBe(true)

  await openRepositoryDetails(library, browserWindow)
  const close = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === 'Close details'
  ) ?? null
  expect((browserWindow.document.activeElement as unknown) === close).toBe(true)
  close?.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  const restoredAfterClose = library.querySelector<HTMLButtonElement>(
    '[data-dialog-invoker="repository-R_one"]'
  )
  expect((browserWindow.document.activeElement as unknown) === restoredAfterClose).toBe(true)

  await openRepositoryDetails(library, browserWindow)
  const backdrop = library.querySelector<HTMLElement>('.dialog-backdrop')
  expect(backdrop).not.toBeNull()
  backdrop?.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  const restoredAfterBackdrop = library.querySelector<HTMLButtonElement>(
    '[data-dialog-invoker="repository-R_one"]'
  )
  expect((browserWindow.document.activeElement as unknown) === restoredAfterBackdrop).toBe(true)
})

test('traps and restores the unstar confirmation dialog without cancelling queued work', async () => {
  const browserWindow = createDashboardWindow()
  const queuedUnstar = deferred()
  const originalFocus = browserWindow.HTMLElement.prototype.focus
  let queuedUnstarCompleted = false
  let rerenderFocusCalls = 0
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          if (message.type === 'enqueue-confirmed-unstars') {
            await queuedUnstar.promise
            queuedUnstarCompleted = true
            return {ok: true, data: membershipReadyDashboardState()}
          }
          if (message.type === 'start-sync') return {ok: true, data: membershipReadyDashboardState()}
          throw new Error(`Unexpected runtime message: ${message.type}`)
        }
      }
    }
  })

  try {
    const {renderLibraryState} = await import('../../src/dashboard/scripts')
    const library = renderLibraryState(membershipReadyDashboardState())
    browserWindow.document.body.append(
      library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    await openRepositoryDetails(library, browserWindow)
    const review = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent === 'Review unstar'
    ) ?? null
    expect(review).not.toBeNull()
    if (review === null) return

    review.focus()
    review.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

    const dialog = library.querySelector<HTMLElement>('.unstar-confirmation[role="dialog"]')
    expect(library.querySelector('.repository-inspection-dialog') === null).toBe(true)
    const cancel = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent === 'Cancel'
    ) ?? null
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent?.includes('Confirm unstar')
    ) ?? null
    expect((browserWindow.document.activeElement as unknown) === cancel).toBe(true)
    expect(cancel).not.toBeNull()
    expect(confirm).not.toBeNull()
    if (dialog === null || cancel === null || confirm === null) return

    cancel.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Tab', bubbles: true}) as unknown as Event
    )
    expect((browserWindow.document.activeElement as unknown) === confirm).toBe(true)
    confirm.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true
      }) as unknown as Event
    )
    expect((browserWindow.document.activeElement as unknown) === cancel).toBe(true)

    dialog.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const restoredRow = library.querySelector<HTMLButtonElement>(
      '[data-dialog-invoker="repository-R_one"]'
    )
    expect(library.querySelector('.unstar-confirmation')).toBeNull()
    expect((browserWindow.document.activeElement as unknown) === restoredRow).toBe(true)

    await openRepositoryDetails(library, browserWindow)
    const restoredReview = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent === 'Review unstar'
    ) ?? null
    expect(restoredReview).not.toBeNull()
    restoredReview?.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const queueingDialog = library.querySelector<HTMLElement>('.unstar-confirmation[role="dialog"]')
    const queueingConfirm = [...(queueingDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent?.includes('Confirm unstar')
    ) ?? null
    expect(queueingDialog).not.toBeNull()
    expect(queueingConfirm).not.toBeNull()
    if (queueingDialog === null || queueingConfirm === null) return

    queueingConfirm.focus()
    browserWindow.HTMLElement.prototype.focus = function (): void {
      rerenderFocusCalls += 1
      originalFocus.call(this)
    }
    queueingConfirm.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const activeQueueingDialog = library.querySelector<HTMLElement>('.unstar-confirmation[role="dialog"]')
    expect(activeQueueingDialog?.querySelector<HTMLButtonElement>('.dialog-cancel')?.disabled).toBe(true)
    expect(rerenderFocusCalls).toBe(0)
    const escape = new browserWindow.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
    activeQueueingDialog?.dispatchEvent(escape as unknown as Event)
    expect(escape.defaultPrevented).toBe(false)
    expect(library.querySelector('.unstar-confirmation')).not.toBeNull()
    queuedUnstar.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    expect(queuedUnstarCompleted).toBe(true)
    expect(library.querySelector('.unstar-confirmation')).toBeNull()
    const survivingRow = library.querySelector<HTMLButtonElement>('.repository-row')
    expect(survivingRow?.isConnected).toBe(true)
    expect((browserWindow.document.activeElement as unknown) === survivingRow).toBe(true)
  } finally {
    queuedUnstar.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    browserWindow.HTMLElement.prototype.focus = originalFocus
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('focuses Operations when a successful unstar leaves no surviving result', async () => {
  const browserWindow = createDashboardWindow()
  const state = membershipReadyDashboardState()
  const completedState: AppState = {
    ...state,
    library: {
      ...state.library!,
      repositories: state.library!.repositories.map((repository) => ({
        ...repository,
        isStarred: false,
        unstarredAt: '2026-08-19T10:00:00Z'
      }))
    }
  }
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          if (message.type === 'enqueue-confirmed-unstars') {
            return {ok: true, data: completedState}
          }
          if (message.type === 'start-sync') return {ok: true, data: completedState}
          throw new Error(`Unexpected runtime message: ${message.type}`)
        }
      }
    }
  })

  try {
    const {mountDashboard} = await import('../../src/dashboard/scripts')
    const library = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(library, state)
    await browserWindow.happyDOM.whenAsyncComplete()
    await openRepositoryDetails(library, browserWindow)
    const review = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent === 'Review unstar'
    )
    review?.click()
    await nextTurn(browserWindow)
    const confirm = [...library.querySelectorAll<HTMLButtonElement>('.unstar-confirmation button')]
      .find((element) => element.textContent?.includes('Confirm unstar'))
    confirm?.click()
    await browserWindow.happyDOM.whenAsyncComplete()
    await nextTurn(browserWindow)

    expect(library.querySelector('.repository-row')).toBeNull()
    const operations = library.querySelector<HTMLButtonElement>(
      '[data-view-kind="operations"]'
    )
    expect(operations?.isConnected).toBe(true)
    expect((browserWindow.document.activeElement as unknown) === operations).toBe(true)
  } finally {
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('does not restore pending unstar focus into a replacement dashboard lifecycle', async () => {
  const browserWindow = createDashboardWindow()
  const pending = deferred()
  const state = membershipReadyDashboardState()
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          if (message.type === 'enqueue-confirmed-unstars') {
            await pending.promise
            return {ok: true, data: state}
          }
          if (message.type === 'start-sync') return {ok: true, data: state}
          throw new Error(`Unexpected runtime message: ${message.type}`)
        }
      }
    }
  })
  try {
    const {mountDashboard} = await import('../../src/dashboard/scripts')
    const firstRoot = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      firstRoot as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(firstRoot, state)
    await browserWindow.happyDOM.whenAsyncComplete()
    await openRepositoryDetails(firstRoot, browserWindow)
    ;[...firstRoot.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Review unstar')?.click()
    await nextTurn(browserWindow)
    ;[...firstRoot.querySelectorAll<HTMLButtonElement>('.unstar-confirmation button')]
      .find((button) => button.textContent?.includes('Confirm unstar'))?.click()

    const replacementRoot = browserWindow.document.createElement('div') as unknown as HTMLElement
    const sentinel = browserWindow.document.createElement('button')
    sentinel.textContent = 'Replacement focus'
    replacementRoot.append(
      sentinel as unknown as Parameters<typeof replacementRoot.append>[0]
    )
    browserWindow.document.body.append(
      replacementRoot as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(replacementRoot, state)
    sentinel.focus()
    pending.resolve()
    await browserWindow.happyDOM.whenAsyncComplete()
    await nextTurn(browserWindow)

    expect((browserWindow.document.activeElement as unknown) === sentinel).toBe(true)
  } finally {
    pending.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('keeps membership confirmation focus with its first review request', async () => {
  const browserWindow = createDashboardWindow()
  const releasePreview = deferred()
  let previewRequests = 0
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          if (message.type === 'preview-native-list-membership') {
            previewRequests += 1
            await releasePreview.promise
            return {ok: true, data: membershipPreview('add', null)}
          }
          throw new Error(`Unexpected runtime message: ${message.type}`)
        }
      }
    }
  })

  try {
    const {renderLibraryState} = await import('../../src/dashboard/scripts')
    const library = renderLibraryState(membershipReadyDashboardState())
    browserWindow.document.body.append(
      library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    await openRepositoryDetails(library, browserWindow)
    const listChoice = library.querySelector(
      '.native-list-choices input[type="checkbox"]'
    ) as HTMLInputElement | null
    expect(listChoice).not.toBeNull()
    if (listChoice === null) return

    listChoice.checked = true
    listChoice.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
    await browserWindow.happyDOM.whenAsyncComplete()
    const firstReview = [...library.querySelectorAll<HTMLButtonElement>('.membership-review')].find(
      (element) => element.textContent === 'Review additive assignment'
    ) ?? null
    expect(firstReview).not.toBeNull()
    if (firstReview === null) return

    firstReview.focus()
    firstReview.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    firstReview.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    expect(previewRequests).toBe(1)

    releasePreview.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const dialog = library.querySelector<HTMLElement>('.membership-confirmation[role="dialog"]')
    expect(library.querySelector('.repository-inspection-dialog') === null).toBe(true)
    const cancel = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent === 'Cancel'
    ) ?? null
    expect(dialog).not.toBeNull()
    if (dialog === null) return

    dialog.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const restoredRow = library.querySelector<HTMLButtonElement>(
      '[data-dialog-invoker="repository-R_one"]'
    )
    expect((browserWindow.document.activeElement as unknown) === restoredRow).toBe(true)
    expect(cancel).not.toBeNull()
  } finally {
    releasePreview.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('mounts existing native List controls separately from local tags', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {mountDashboard} = await import('../../src/dashboard/scripts')
  const repository = repositoryRecord('42', 'R_one', 'octocat/one')
  const state: AppState = {
    ...accountState('42', {
      readiness: 'ready',
      membershipReady: true,
      previewVisible: false,
      authorization: null,
      error: null
    }),
    nativeListMembership: {readiness: 'ready'},
    library: {
      repositories: [repository],
      nativeLists: [nativeList('L_current', 'Current List'), nativeList('L_other', 'Other List')],
      nativeMemberships: [
        {
          githubUserId: '42',
          repositoryNodeId: 'R_one',
          listNodeId: 'L_current',
          lastObservedAt: '2026-08-04T10:00:00Z'
        }
      ],
      annotations: [
        {
          githubUserId: '42',
          repositoryNodeId: 'R_one',
          triageState: 'inbox',
          tags: ['local-only'],
          note: '',
          favorite: false,
          revisitAt: null,
          reviewedAt: null,
          localModifiedAt: '2026-08-04T10:00:00Z'
        }
      ]
    },
    mutations: {batches: [], jobs: [], history: []}
  }
  const root = browserWindow.document.createElement('main')
  browserWindow.document.body.append(root)
  mountDashboard(root as unknown as HTMLElement, state)
  const currentListNavigationItem = [...root.querySelectorAll('button')].find(
    (element) => element.textContent?.includes('Current List')
  )
  currentListNavigationItem?.dispatchEvent(new browserWindow.MouseEvent('click', {bubbles: true}))
  await browserWindow.happyDOM.whenAsyncComplete()
  const library = root as unknown as HTMLElement
  await openRepositoryDetails(library, browserWindow)

  expect(library.textContent).toContain('Native GitHub Lists')
  expect(library.textContent).toContain('Local tags are separate')
  expect(library.textContent).toContain('Current List')
  expect(library.textContent).toContain('No-op')
  expect(library.textContent).toContain('Local organization')
  expect(library.textContent).toContain('Review additive assignment')
  expect(library.querySelector('.membership-review.primary-action')).not.toBeNull()
  expect(library.textContent).not.toContain('Create native List')
  expect(library.textContent).not.toContain('Rename native List')
  expect(library.textContent).not.toContain('Delete native List')
})

test('shows a native List header Edit control only when rename readiness is ready', async () => {
  const {root, cleanup} = await mountNativeListRenameDashboard(renameReadyDashboardState())
  try {
    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Current List')
    expect(renameEditButton(root)).not.toBeNull()

    const {root: unavailable, cleanup: unavailableCleanup} = await mountNativeListRenameDashboard(
      readyDashboardState()
    )
    try {
      expect(renameEditButton(unavailable)).toBeNull()
    } finally {
      unavailableCleanup()
    }
  } finally {
    cleanup()
  }
})

test('opens a focused, labelled native List header editor and Cancel or Escape sends no message', async () => {
  let messages = 0
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(
    renameReadyDashboardState(),
    async () => {
      messages += 1
      throw new Error('No runtime message was expected.')
    }
  )
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const editor = nativeListHeader(root)?.querySelector('form.native-list-rename-editor') ?? null
    const name = editor?.querySelector<HTMLInputElement>('input') ?? null
    expect(editor).not.toBeNull()
    expect(name).not.toBeNull()
    if (name === null) throw new Error('The native List editor must contain its name field.')
    expect(name.labels?.[0]?.textContent).toBe('List name')
    expect(name.value).toBe('Current List')
    expect(name.getAttribute('aria-invalid')).toBe('false')
    expect(name.hasAttribute('aria-describedby')).toBe(false)
    expect((browserWindow.document.activeElement as unknown) === name).toBe(true)
    expect(editor?.querySelector('.primary-action')?.textContent).toBe('Save')
    expect(editor?.querySelector('.secondary-action')?.textContent).toBe('Cancel')

    editor?.querySelector<HTMLButtonElement>('.secondary-action')?.click()
    await nextTurn(browserWindow)
    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Current List')
    expect((browserWindow.document.activeElement as unknown) === renameEditButton(root)).toBe(true)
    expect(messages).toBe(0)

    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const reopened = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(reopened).not.toBeNull()
    if (reopened === null) throw new Error('The native List editor must reopen before Escape can cancel it.')
    reopened.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
    )
    await nextTurn(browserWindow)
    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Current List')
    expect((browserWindow.document.activeElement as unknown) === renameEditButton(root)).toBe(true)
    expect(messages).toBe(0)
  } finally {
    cleanup()
  }
})

test('keeps native List rename dispatch locked while a pending request survives navigation', async () => {
  const firstRename = deferred()
  const messages: Array<{readonly type: string; readonly listNodeId?: string; readonly name?: string}> = []
  const state = renameReadyDashboardState()
  const verified = {
    ...state,
    library: {
      ...state.library!,
      nativeLists: [nativeList('L_current', 'Renamed Current'), nativeList('L_other', 'Other List')]
    }
  }
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(state, async (message) => {
    const rename = message as {readonly type: string; readonly listNodeId?: string}
    messages.push(rename)
    if (rename.type === 'rename-native-list' && rename.listNodeId === 'L_current') {
      await firstRename.promise
      return {ok: true, data: verified}
    }
    if (rename.type === 'rename-native-list' && rename.listNodeId === 'L_other') {
      return {ok: true, data: verified}
    }
    throw new Error(`Unexpected runtime message: ${rename.type}`)
  })
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const currentName = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(currentName).not.toBeNull()
    if (currentName === null) throw new Error('The current List editor must open.')
    currentName.value = 'Renamed Current'
    currentName.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    expect(messages).toEqual([
      {type: 'rename-native-list', listNodeId: 'L_current', name: 'Renamed Current'}
    ])

    nativeListNavigationButton(root, 'Other List')?.click()
    await nextTurn(browserWindow)
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    submitNativeListRename(browserWindow, root)
    expect(messages).toEqual([
      {type: 'rename-native-list', listNodeId: 'L_current', name: 'Renamed Current'}
    ])

    firstRename.resolve()
    await nextTurn(browserWindow)
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    submitNativeListRename(browserWindow, root)
    await nextTurn(browserWindow)
    expect(messages).toEqual([
      {type: 'rename-native-list', listNodeId: 'L_current', name: 'Renamed Current'},
      {type: 'rename-native-list', listNodeId: 'L_other', name: 'Other List'}
    ])
  } finally {
    firstRename.resolve()
    cleanup()
  }
})

test('does not apply a stale native List rename response after the active account changes', async () => {
  const renameResponse = deferred()
  let staleResponseDelivered = false
  const accountA = renameReadyDashboardState()
  const staleAccountAResponse = {
    ...accountA,
    library: {
      ...accountA.library!,
      nativeLists: [nativeList('L_current', 'Stale Account A Name'), nativeList('L_other', 'Other List')]
    }
  }
  const accountB: AppState = {
    ...renameReadyDashboardState(),
    identity: {
      githubUserId: '84',
      userNodeId: 'U_84',
      login: 'account-84',
      avatarUrl: 'https://avatars.githubusercontent.com/u/84'
    },
    library: {
      ...renameReadyDashboardState().library!,
      nativeLists: [nativeList('L_current', 'Account B List'), nativeList('L_other', 'Account B Other')]
    }
  }
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(accountA, async (message) => {
    const runtimeMessage = message as {readonly type: string}
    if (runtimeMessage.type === 'rename-native-list') {
      await renameResponse.promise
      staleResponseDelivered = true
      return {ok: true, data: staleAccountAResponse}
    }
    if (runtimeMessage.type === 'start-sync') return {ok: true, data: accountB}
    throw new Error(`Unexpected runtime message: ${runtimeMessage.type}`)
  })
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    submitNativeListRename(browserWindow, root)
    nativeListHeader(root)?.querySelector<HTMLButtonElement>('.refresh-button')?.click()
    await nextTurn(browserWindow)
    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Account B List')

    renameResponse.resolve()
    await nextTurn(browserWindow)
    expect(staleResponseDelivered).toBe(true)
    await nextTurn(browserWindow)
    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Account B List')
  } finally {
    renameResponse.resolve()
    cleanup()
  }
})

test('keeps invalid native List header edits inline without a runtime message', async () => {
  let messages = 0
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(
    renameReadyDashboardState(),
    async () => {
      messages += 1
      throw new Error('No runtime message was expected.')
    }
  )
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const name = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(name).not.toBeNull()
    if (name === null) throw new Error('The native List editor must contain its name field.')
    name.value = '   '
    name.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(name.value).toBe('   ')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBeTruthy()
    expect(nativeListHeader(root)?.querySelector('[role="alert"]')?.textContent).toBe(
      'A native List name is required.'
    )
    expect(messages).toBe(0)

    name.value = 'ｏｔｈｅｒ list'
    name.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(nativeListHeader(root)?.querySelector('[role="alert"]')?.textContent).toBe(
      'A native List with this name already exists.'
    )
    expect(messages).toBe(0)
  } finally {
    cleanup()
  }
})

test('sends one valid native List header rename and renders only verified returned state', async () => {
  const pending = deferred()
  const messages: unknown[] = []
  const state = renameReadyDashboardState()
  const verified = {
    ...state,
    library: {
      ...state.library!,
      nativeLists: [nativeList('L_current', 'Verified Name'), nativeList('L_other', 'Other List')]
    }
  }
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(state, async (message) => {
    messages.push(message)
    await pending.promise
    return {ok: true, data: verified}
  })
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const name = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(name).not.toBeNull()
    if (name === null) throw new Error('The native List editor must contain its name field.')
    name.value = '  Verified Name  '
    name.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    submitNativeListRename(browserWindow, root)
    expect(messages).toEqual([{type: 'rename-native-list', listNodeId: 'L_current', name: 'Verified Name'}])
    expect(nativeListHeader(root)?.textContent).toContain('Current List')
    pending.resolve()
    await nextTurn(browserWindow)
    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Verified Name')
    expect(navigationLabels(navigationGroup(sidebarNavigation(root), 'GitHub Lists'))).toEqual([
      'Unlist',
      'Other List',
      'Verified Name'
    ])
    const restoredEdit = renameEditButton(root)
    expect(restoredEdit?.isConnected).toBe(true)
    expect((browserWindow.document.activeElement as unknown) === restoredEdit).toBe(true)
  } finally {
    pending.resolve()
    cleanup()
  }
})

test('shows a fixed safe message when native List rename dispatch throws', async () => {
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(
    renameReadyDashboardState(),
    async () => {
      throw new Error('Unexpected remote failure: ghp_exampleSecretValue')
    }
  )
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const name = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(name).not.toBeNull()
    if (name === null) throw new Error('The native List editor must contain its name field.')
    name.value = 'Unverified Name'
    name.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    await nextTurn(browserWindow)

    const error = nativeListHeader(root)?.querySelector('[role="alert"]')?.textContent ?? ''
    expect(name.value).toBe('Unverified Name')
    expect(error).toBe('Unable to rename the GitHub List. Please try again.')
    expect(error).not.toContain('ghp_exampleSecretValue')
    expect(navigationLabels(navigationGroup(sidebarNavigation(root), 'GitHub Lists'))).toEqual([
      'Unlist',
      'Current List',
      'Other List'
    ])
  } finally {
    cleanup()
  }
})

test('preserves native List header editor and prior rendered name after a runtime failure', async () => {
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(
    renameReadyDashboardState(),
    async () => ({
      ok: false as const,
      error: {
        category: 'network',
        message: 'GitHub could not verify the renamed List. Refresh before trying again.',
        retryable: false
      }
    })
  )
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const name = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(name).not.toBeNull()
    if (name === null) throw new Error('The native List editor must contain its name field.')
    name.value = 'Unverified Name'
    name.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    await nextTurn(browserWindow)
    expect(name.value).toBe('Unverified Name')
    expect(nativeListHeader(root)?.querySelector('[role="alert"]')?.textContent).toBe(
      'GitHub could not verify the renamed List. Refresh before trying again.'
    )
    expect(navigationLabels(navigationGroup(sidebarNavigation(root), 'GitHub Lists'))).toEqual([
      'Unlist',
      'Current List',
      'Other List'
    ])
  } finally {
    cleanup()
  }
})

test('applies divergent native List state while retaining the sanitized rename result inline', async () => {
  const state = renameReadyDashboardState()
  const observed = {
    ...state,
    library: {
      ...state.library!,
      nativeLists: [nativeList('L_current', 'Observed List'), nativeList('L_other', 'Other List')]
    }
  }
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(
    state,
    async () => ({
      ok: false as const,
      data: observed,
      error: {
        category: 'validation',
        message: 'GitHub did not verify the requested native List name.',
        retryable: true
      }
    })
  )
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const name = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(name).not.toBeNull()
    if (name === null) throw new Error('The native List editor must contain its name field.')
    name.value = 'Desired List'
    name.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
    submitNativeListRename(browserWindow, root)
    await nextTurn(browserWindow)

    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Observed List')
    expect(navigationLabels(navigationGroup(sidebarNavigation(root), 'GitHub Lists'))).toEqual([
      'Unlist',
      'Observed List',
      'Other List'
    ])
    const retainedEditor = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(retainedEditor?.value).toBe('Desired List')
    expect(nativeListHeader(root)?.querySelector('[role="alert"]')?.textContent).toBe(
      'GitHub did not verify the requested native List name.'
    )
    expect(nativeListHeader(root)?.querySelector('.primary-action')?.textContent).toBe('Save')
  } finally {
    cleanup()
  }
})

test('removes a missing native List editor and shows its sanitized rename result', async () => {
  const state = renameReadyDashboardState()
  const observed = {
    ...state,
    library: {
      ...state.library!,
      nativeLists: [nativeList('L_other', 'Other List')]
    }
  }
  const {browserWindow, root, cleanup} = await mountNativeListRenameDashboard(
    state,
    async () => ({
      ok: false as const,
      data: observed,
      error: {
        category: 'validation',
        message: 'GitHub no longer reports the renamed native List.',
        retryable: true
      }
    })
  )
  try {
    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    submitNativeListRename(browserWindow, root)
    await nextTurn(browserWindow)

    expect(nativeListHeader(root)?.querySelector('.eyebrow')?.textContent).toBe('Unlist')
    expect(nativeListHeader(root)?.querySelector('form.native-list-rename-editor')).toBeNull()
    expect(navigationLabels(navigationGroup(sidebarNavigation(root), 'GitHub Lists'))).toEqual([
      'Unlist',
      'Other List'
    ])
    expect(root.querySelector('.status-banner.is-error')?.textContent).toBe(
      'GitHub no longer reports the renamed native List.'
    )
  } finally {
    cleanup()
  }
})

test('organizes inspector facts, local fields, and GitHub changes into labelled sections', async () => {
  const library = await mountReadyDashboard(membershipReadyDashboardState())
  const browserWindow = window as unknown as Window
  await openRepositoryDetails(library, browserWindow)
  const inspector = library.querySelector<HTMLElement>('.inspector')
  const sections = [...(inspector?.children ?? [])].filter((child) =>
    child.matches('section')
  )
  const githubChanges = sections.find(
    (section) => section.getAttribute('aria-label') === 'GitHub account changes'
  )
  const consequence = githubChanges?.querySelector('.inspector-section-intro') ?? null
  const membershipControls = githubChanges?.querySelector('.membership-controls') ?? null
  const unstarControl = githubChanges?.querySelector('.github-unstar-action') ?? null

  expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual([
    'Repository facts',
    'Local organization',
    'GitHub account changes'
  ])
  expect(githubChanges).not.toBeNull()
  expect(consequence?.textContent).toContain('connected GitHub account')
  expect(membershipControls).not.toBeNull()
  expect(unstarControl).not.toBeNull()
  expect(githubChanges?.contains(membershipControls)).toBe(true)
  expect(githubChanges?.contains(unstarControl)).toBe(true)
  expect(githubChanges?.querySelector('.remote-action-card')).toBeNull()
  const githubChildren = [...(githubChanges?.children ?? [])]
  expect(githubChildren.indexOf(consequence as HTMLElement)).toBeLessThan(
    githubChildren.indexOf(membershipControls as HTMLElement)
  )
})

test('keeps inspector unstar disabled without write authorization or while work is active', async () => {
  const browserWindow = createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const unavailable = renderLibraryState({
    ...membershipReadyDashboardState(),
    writeAuthorization: {
      readiness: 'authorization-required',
      membershipReady: false,
      previewVisible: false,
      authorization: null,
      error: null
    }
  })
  browserWindow.document.body.append(
    unavailable as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  await openRepositoryDetails(unavailable, browserWindow)
  const unavailableUnstar = unavailable.querySelector<HTMLButtonElement>(
    '.github-unstar-action .danger-action'
  )
  const activeJob = {
    ...mutationJob('42', 'queued', 0),
    repositoryNodeId: 'R_one'
  }
  const activeWork = renderLibraryState({
    ...membershipReadyDashboardState(),
    mutations: {batches: [], jobs: [activeJob], history: []}
  })
  browserWindow.document.body.append(
    activeWork as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  await openRepositoryDetails(activeWork, browserWindow)
  const activeUnstar = activeWork.querySelector<HTMLButtonElement>(
    '.github-unstar-action .danger-action'
  )

  expect(unavailableUnstar?.disabled).toBe(true)
  expect(activeUnstar?.disabled).toBe(true)
  expect(activeUnstar?.textContent).toBe('Unstar already queued')
})

test('keeps inspector native List changes in preview before confirmation', async () => {
  const browserWindow = createDashboardWindow()
  const preview = deferred()
  let previewRequests = 0
  let confirmationRequests = 0
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          if (message.type === 'preview-native-list-membership') {
            previewRequests += 1
            await preview.promise
            return {ok: true, data: membershipPreview('add', null)}
          }
          if (message.type === 'confirm-native-list-membership-preview') {
            confirmationRequests += 1
            return {ok: true, data: membershipReadyDashboardState()}
          }
          throw new Error(`Unexpected runtime message: ${message.type}`)
        }
      }
    }
  })

  try {
    const {renderLibraryState} = await import('../../src/dashboard/scripts')
    const library = renderLibraryState(membershipReadyDashboardState())
    browserWindow.document.body.append(
      library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    await openRepositoryDetails(library, browserWindow)
    const inspector = library.querySelector<HTMLElement>('.inspector')
    const listChoice = inspector?.querySelector<HTMLInputElement>(
      '.native-list-choices input[type="checkbox"]'
    ) ?? null
    expect(listChoice).not.toBeNull()
    if (listChoice === null) return

    listChoice.checked = true
    listChoice.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
    await browserWindow.happyDOM.whenAsyncComplete()
    const review = library.querySelector<HTMLButtonElement>('.inspector .membership-review')
    expect(review?.disabled).toBe(false)
    if (review === null) return

    review.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    expect(previewRequests).toBe(1)
    expect(library.querySelector('.membership-confirmation')).toBeNull()
    expect(confirmationRequests).toBe(0)

    preview.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    expect(library.querySelector('.membership-confirmation')).not.toBeNull()
    expect(confirmationRequests).toBe(0)
  } finally {
    preview.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('mounts stable bulk and refreshed membership previews with exact effects and safety disclosure', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {renderMembershipConfirmation} = await import('../../src/dashboard/scripts')
  const preview = membershipPreview('move', 'job-stale')
  const confirmation = renderMembershipConfirmation(preview)
  browserWindow.document.body.append(
    confirmation as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )

  const dialog = confirmation.querySelector('[role="dialog"]')
  expect(dialog?.getAttribute('aria-labelledby')).toBe('membership-confirmation-title')
  expect(dialog?.getAttribute('aria-modal')).toBe('true')
  expect(accessibleDialogName(dialog)).toBe('Review List memberships for 2 repositories')

  for (const value of [
    'octocat/one',
    'github/two',
    'Current',
    'Resulting',
    'Added',
    'Removed',
    'Unchanged',
    'No-op requests',
    'GitHub replaces the complete List membership set',
    'multiple requests, not an atomic snapshot',
    'between the final observation and mutation',
    'desired-versus-observed conflict',
    'original intent is preserved',
    'requires a new confirmation'
  ]) {
    expect(confirmation.textContent).toContain(value)
  }
  expect(confirmation.querySelectorAll('.membership-preview-card')).toHaveLength(2)
  expect(confirmation.querySelector('.membership-confirmation.is-destructive')).not.toBeNull()
  expect(confirmation.querySelector('.danger-action')).not.toBeNull()
})

test('leads native List confirmations with the affected outcome and safe next action', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {renderMembershipConfirmation} = await import('../../src/dashboard/scripts')
  const confirmation = renderMembershipConfirmation(membershipPreview('move', 'job-stale'))
  const scope = confirmation.querySelector('.membership-preview-scope')
  const outcome = confirmation.querySelector('.membership-outcome')
  const refreshed = confirmation.querySelector('.membership-refreshed-notice')

  expect(scope?.textContent).toBe('Preview scope: 2 repositories.')
  expect(outcome?.textContent).toBe(
    '1 repository will move between GitHub Lists. Review the current and resulting complete List sets below, then confirm the refreshed preview to queue the preserved original intent.'
  )
  expect(refreshed?.textContent).toBe(
    'GitHub List membership changed after your earlier confirmation. The original intent is preserved, but a fresh stable observation produced this updated preview and requires a new confirmation; the earlier confirmation will not execute.'
  )
})

test('separates no-op membership preview scope from zero changes and queued jobs', async () => {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  const {renderMembershipConfirmation} = await import('../../src/dashboard/scripts')
  const preview = membershipPreview('add', null)
  const noOpPreview: StableMembershipPreviewResponse = {
    ...preview,
    repositories: preview.repositories.map((repository) => ({
      ...repository,
      resulting: repository.current,
      added: [],
      removed: [],
      noOps: repository.current,
      createsJob: false
    }))
  }
  const confirmation = renderMembershipConfirmation(noOpPreview)
  const scope = confirmation.querySelector('.membership-preview-scope')
  const outcome = confirmation.querySelector('.membership-outcome')
  const confirm = confirmation.querySelector<HTMLButtonElement>('.primary-action')

  expect(scope?.textContent).toBe('Preview scope: 2 repositories.')
  expect(outcome?.textContent).toBe(
    '0 repositories will change. 0 jobs will be queued. Review the current and resulting complete List sets below; no confirmation is required.'
  )
  expect(confirm?.disabled).toBe(true)
})

test('cancels the named membership confirmation with Escape', async () => {
  const browserWindow = createDashboardWindow()
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  const queuedMembership = deferred()
  const originalFocus = browserWindow.HTMLElement.prototype.focus
  let queuedMembershipCompleted = false
  let rerenderFocusCalls = 0
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          if (message.type === 'preview-native-list-membership') {
            return {ok: true, data: membershipPreview('add', null)}
          }
          if (message.type === 'confirm-native-list-membership-preview') {
            await queuedMembership.promise
            queuedMembershipCompleted = true
            return {ok: true, data: membershipReadyDashboardState()}
          }
          if (message.type === 'start-sync') return {ok: true, data: membershipReadyDashboardState()}
          throw new Error(`Unexpected runtime message: ${message.type}`)
        }
      }
    }
  })

  try {
    const {renderLibraryState} = await import('../../src/dashboard/scripts')
    const library = renderLibraryState(membershipReadyDashboardState())
    browserWindow.document.body.append(
      library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    await openRepositoryDetails(library, browserWindow)
    const listChoice = library.querySelector(
      '.native-list-choices input[type="checkbox"]'
    ) as HTMLInputElement | null
    expect(listChoice).not.toBeNull()
    if (listChoice === null) return

    listChoice.checked = true
    listChoice.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
    await browserWindow.happyDOM.whenAsyncComplete()
    const review =
      [...library.querySelectorAll('button')].find((element) =>
        element.textContent?.includes('Review additive assignment')
      ) ?? null
    expect(review).not.toBeNull()
    if (review === null) return
    expect(review.hasAttribute('disabled')).toBe(false)
    review.focus()
    review.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

    const dialog = library.querySelector('.membership-confirmation[role="dialog"]')
    expect(library.querySelector('.repository-inspection-dialog') === null).toBe(true)
    expect(dialog?.getAttribute('aria-labelledby')).toBe('membership-confirmation-title')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(accessibleDialogName(dialog)).toBe('Review List memberships for 2 repositories')
    const cancel = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent === 'Cancel'
    ) ?? null
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent?.includes('Confirm and queue')
    ) ?? null
    expect((browserWindow.document.activeElement as unknown) === cancel).toBe(true)
    expect(cancel).not.toBeNull()
    expect(confirm).not.toBeNull()
    if (dialog === null || cancel === null || confirm === null) return
    cancel.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Tab', bubbles: true}) as unknown as Event
    )
    expect((browserWindow.document.activeElement as unknown) === confirm).toBe(true)
    confirm.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true
      }) as unknown as Event
    )
    expect((browserWindow.document.activeElement as unknown) === cancel).toBe(true)
    dialog?.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

    expect(library.querySelector('.membership-confirmation') === null).toBe(true)
    const restoredRow = library.querySelector<HTMLButtonElement>(
      '[data-dialog-invoker="repository-R_one"]'
    )
    expect((browserWindow.document.activeElement as unknown) === restoredRow).toBe(true)

    await openRepositoryDetails(library, browserWindow)
    const restoredReview = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent?.includes('Review additive assignment')
    ) ?? null
    expect(restoredReview).not.toBeNull()
    restoredReview?.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const queueingDialog = library.querySelector<HTMLElement>(
      '.membership-confirmation[role="dialog"]'
    )
    const queueingConfirm = [...(queueingDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent?.includes('Confirm and queue')
    ) ?? null
    expect(queueingDialog).not.toBeNull()
    expect(queueingConfirm).not.toBeNull()
    if (queueingDialog === null || queueingConfirm === null) return

    queueingConfirm.focus()
    browserWindow.HTMLElement.prototype.focus = function (): void {
      rerenderFocusCalls += 1
      originalFocus.call(this)
    }
    queueingConfirm.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const activeQueueingDialog = library.querySelector<HTMLElement>(
      '.membership-confirmation[role="dialog"]'
    )
    expect(activeQueueingDialog?.querySelector<HTMLButtonElement>('.dialog-cancel')?.disabled).toBe(true)
    expect(rerenderFocusCalls).toBe(0)
    const escape = new browserWindow.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    })
    activeQueueingDialog?.dispatchEvent(escape as unknown as Event)
    expect(escape.defaultPrevented).toBe(false)
    expect(library.querySelector('.membership-confirmation')).not.toBeNull()
    queuedMembership.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    expect(queuedMembershipCompleted).toBe(true)
    expect(library.querySelector('.membership-confirmation')).toBeNull()
    const restoredAfterSuccess = library.querySelector<HTMLButtonElement>(
      '[data-dialog-invoker="repository-R_one"]'
    )
    expect(restoredAfterSuccess?.isConnected).toBe(true)
    expect((browserWindow.document.activeElement as unknown) === restoredAfterSuccess).toBe(true)
  } finally {
    queuedMembership.resolve()
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    browserWindow.HTMLElement.prototype.focus = originalFocus
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('membership success falls back to visible Unlist when its repository disappears', async () => {
  const browserWindow = createDashboardWindow()
  const state = membershipReadyDashboardState()
  const result: AppState = {
    ...state,
    library: {...state.library!, repositories: [], annotations: [], nativeMemberships: []}
  }
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'preview-native-list-membership') {
        return {ok: true, data: membershipPreview('add', null)}
      }
      if (message.type === 'confirm-native-list-membership-preview') {
        return {ok: true, data: result}
      }
      if (message.type === 'start-sync') return {ok: true, data: result}
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })
  try {
    const {mountDashboard} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    mountDashboard(root, state)
    await browserWindow.happyDOM.whenAsyncComplete()
    await openAndConfirmMembership(root, browserWindow)
    await browserWindow.happyDOM.whenAsyncComplete()
    await nextTurn(browserWindow)

    expect(root.querySelector('.repository-row')).toBeNull()
    const unlist = root.querySelector<HTMLButtonElement>('[data-view-kind="unlist"]')
    expect(unlist?.isConnected).toBe(true)
    expect(unlist?.closest('[hidden]')).toBeNull()
    expect((browserWindow.document.activeElement as unknown) === unlist).toBe(true)
  } finally {
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('rejects a delayed membership response after an account lifecycle change', async () => {
  const browserWindow = createDashboardWindow()
  const pending = deferred()
  const state = membershipReadyDashboardState()
  const switched = accountBDashboardState()
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'preview-native-list-membership') {
        return {ok: true, data: membershipPreview('add', null)}
      }
      if (message.type === 'confirm-native-list-membership-preview') {
        await pending.promise
        return {ok: true, data: state}
      }
      if (message.type === 'start-sync') return {ok: true, data: state}
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })
  try {
    const {mountDashboard, renderAppState} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    const sentinel = browserWindow.document.createElement('button')
    sentinel.textContent = 'Account-change focus'
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0],
      sentinel
    )
    mountDashboard(root, state)
    await browserWindow.happyDOM.whenAsyncComplete()
    await openAndConfirmMembership(root, browserWindow)
    renderAppState(switched)
    await browserWindow.happyDOM.whenAsyncComplete()
    sentinel.focus()
    pending.resolve()
    await browserWindow.happyDOM.whenAsyncComplete()
    await nextTurn(browserWindow)

    expect((browserWindow.document.activeElement as unknown) === sentinel).toBe(true)
    await expectAccountBDashboard(root, browserWindow)
  } finally {
    pending.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('rejects a delayed unstar response after an account lifecycle change', async () => {
  const browserWindow = createDashboardWindow()
  const pending = deferred()
  const accountA = membershipReadyDashboardState()
  const accountB = accountBDashboardState()
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {runtime: {sendMessage: async (message: {readonly type: string}) => {
      if (message.type === 'enqueue-confirmed-unstars') {
        await pending.promise
        return {ok: true, data: accountA}
      }
      throw new Error(`Unexpected runtime message: ${message.type}`)
    }}}
  })
  try {
    const {mountDashboard, renderAppState} = await import('../../src/dashboard/scripts')
    const root = browserWindow.document.createElement('div') as unknown as HTMLElement
    const sentinel = browserWindow.document.createElement('button')
    sentinel.textContent = 'Switched account focus'
    browserWindow.document.body.append(
      root as unknown as Parameters<typeof browserWindow.document.body.append>[0],
      sentinel
    )
    mountDashboard(root, accountA)
    await browserWindow.happyDOM.whenAsyncComplete()
    await openRepositoryDetails(root, browserWindow)
    ;[...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Review unstar')?.click()
    await nextTurn(browserWindow)
    ;[...root.querySelectorAll<HTMLButtonElement>('.unstar-confirmation button')]
      .find((button) => button.textContent?.includes('Confirm unstar'))?.click()

    renderAppState(accountB)
    await browserWindow.happyDOM.whenAsyncComplete()
    sentinel.focus()
    pending.resolve()
    await nextTurn(browserWindow)

    expect((browserWindow.document.activeElement as unknown) === sentinel).toBe(true)
    await expectAccountBDashboard(root, browserWindow)
  } finally {
    pending.resolve()
    if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
    else Object.assign(globalThis, {chrome: previousChrome})
  }
})

test('keeps native List recovery outcomes actionable without automatic blocked retries', async () => {
  const {renderOperationsState} = await import('../../src/dashboard/scripts')
  const statuses: readonly MutationJobStatus[] = [
    'queued',
    'observing-membership',
    'unstable-observation',
    'needs-confirmation',
    'verification-conflict',
    'blocked-unknown',
    'succeeded'
  ]
  const jobs = statuses.map((status, index): MutationJobRecord => ({
    ...mutationJob('42', status, index),
    mutationKind: 'native-list-membership',
    membershipDetails: membershipMutationDetails(status)
  }))
  const baseBatch = mutationBatch('42', jobs)
  const state: AppState = {
    ...accountState('42'),
    mutations: {
      batches: [{...baseBatch, mutationKind: 'native-list-membership'}],
      jobs,
      history: []
    }
  }
  const operations = renderOperationsState(state)

  for (const value of [
    'Queued',
    'Observing membership',
    'Unstable observation',
    'Needs confirmation',
    'Verification conflict',
    'Verified',
    'List membership did not reach a stable observation',
    'Review refreshed preview',
    'Desired Lists:',
    'Observed Lists:',
    'Partial batch outcome',
    'Blocked result for 1 repository: its final GitHub state is unknown.',
    'This job is not retried automatically.',
    'Refresh the library, review the affected repository, then decide whether to make a separate manual attempt.'
  ]) {
    expect(operations.textContent).toContain(value)
  }
})

test('requests a refreshed preview from the stale membership recovery action', async () => {
  const browserWindow = createDashboardWindow()
  const messages: {readonly type: string; readonly jobId?: string}[] = []
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string; readonly jobId?: string}) => {
          messages.push(message)
          return {ok: true, data: membershipPreview('add', 'job-42-3')}
        }
      }
    }
  })

  try {
    const {renderOperationsState} = await import('../../src/dashboard/scripts')
    const job: MutationJobRecord = {
      ...mutationJob('42', 'needs-confirmation', 3),
      mutationKind: 'native-list-membership',
      membershipDetails: membershipMutationDetails('needs-confirmation')
    }
    const batch = mutationBatch('42', [job])
    const operations = renderOperationsState({
      ...accountState('42'),
      mutations: {
        batches: [{...batch, mutationKind: 'native-list-membership'}],
        jobs: [job],
        history: []
      }
    })
    browserWindow.document.body.append(
      operations as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    const refresh = operations.querySelector<HTMLButtonElement>('.refresh-membership-preview')

    expect(refresh).not.toBeNull()
    refresh?.dispatchEvent(new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event)
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

    expect(messages).toEqual([
      {type: 'refresh-native-list-membership-preview', jobId: 'job-42-3'}
    ])
  } finally {
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('does not initiate work from a blocked-unknown membership recovery', async () => {
  const browserWindow = createDashboardWindow()
  const messages: {readonly type: string}[] = []
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage: async (message: {readonly type: string}) => {
          messages.push(message)
          return {ok: true, data: accountState('42')}
        }
      }
    }
  })

  try {
    const {renderOperationsState} = await import('../../src/dashboard/scripts')
    const job: MutationJobRecord = {
      ...mutationJob('42', 'blocked-unknown', 5),
      mutationKind: 'native-list-membership',
      membershipDetails: membershipMutationDetails('blocked-unknown')
    }
    const batch = mutationBatch('42', [job])
    const operations = renderOperationsState({
      ...accountState('42'),
      mutations: {
        batches: [{...batch, mutationKind: 'native-list-membership'}],
        jobs: [job],
        history: []
      }
    })
    browserWindow.document.body.append(
      operations as unknown as Parameters<typeof browserWindow.document.body.append>[0]
    )
    const blockedStatus = operations.querySelector<HTMLElement>('[data-status="blocked-unknown"]')
    const blockedJob = blockedStatus?.closest('li') ?? null

    expect(blockedJob?.querySelector('button')).toBeNull()
    blockedJob?.dispatchEvent(
      new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

    expect(messages).toEqual([])
  } finally {
    if (previousChrome === undefined) {
      delete (globalThis as {chrome?: unknown}).chrome
    } else {
      Object.assign(globalThis, {chrome: previousChrome})
    }
  }
})

test('renders account-isolated job states, batch counts, and queued-only cancellation', async () => {
  const {renderOperationsState} = await import('../../src/dashboard/scripts')
  const statuses: readonly MutationJobStatus[] = [
    'queued',
    'checking',
    'deleting',
    'verifying',
    'succeeded',
    'succeeded-external',
    'failed',
    'blocked-unknown',
    'retry-waiting',
    'cancelled'
  ]
  const jobs = statuses.map((status, index) => mutationJob('42', status, index))
  const suspended = mutationJob('42', 'queued', statuses.length, 'account-suspended')
  const batch = mutationBatch('42', [...jobs, suspended])
  const otherAccountJob = mutationJob('99', 'failed', 99)
  const state: AppState = {
    ...accountState('42'),
    mutations: {
      batches: [batch, mutationBatch('99', [otherAccountJob])],
      jobs: [...jobs, suspended, otherAccountJob],
      history: [
        operationHistory('42', 'R_6', 'visible-repository'),
        operationHistory('99', 'R_99', 'hidden-repository')
      ]
    }
  }
  const operations = renderOperationsState(state)

  for (const label of [
    'Queued',
    'Checking',
    'Deleting',
    'Verifying',
    'Succeeded',
    'Succeeded externally',
    'Failed',
    'Blocked unknown',
    'Retry waiting',
    'Cancelled',
    'Account suspended'
  ]) {
    expect(operations.textContent).toContain(label)
  }
  for (const label of [
    'Succeeded1',
    'Failed1',
    'Blocked unknown1',
    'Queued2',
    'Cancelled1',
    'Pending4'
  ]) {
    expect(operations.textContent?.replaceAll(/\s/g, '')).toContain(
      label.replaceAll(/\s/g, '')
    )
  }
  expect(operations.textContent).toContain('visible-repository')
  expect(operations.textContent).not.toContain('hidden-repository')
  expect(
    [...operations.querySelectorAll('button')].filter(
      (element) => element.textContent === 'Cancel queued job'
    )
  ).toHaveLength(2)
  expect(operations.textContent).toContain('not retried automatically')
  expect(operations.textContent).not.toContain('Undo')
  expect(operations.textContent).not.toContain('re-star')
})

function accountState(
  githubUserId: string,
  writeAuthorization: AppState['writeAuthorization'] = {
    readiness: 'authorization-required',
    membershipReady: false,
    previewVisible: false,
    authorization: null,
    error: null
  }
): AppState {
  return {
    phase: 'ready',
    identity: {
      githubUserId,
      userNodeId: `U_${githubUserId}`,
      login: `account-${githubUserId}`,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1'
    },
    authorization: null,
    writeAuthorization,
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: null,
    mutations: null,
    error: null
  }
}

function repositoryRecord(
  githubUserId: string,
  repositoryNodeId: string,
  fullName: string
): RepositoryRecord {
  const [ownerLogin = '', name = ''] = fullName.split('/')
  return {
    githubUserId,
    repositoryNodeId,
    ownerLogin,
    name,
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: '2026-08-04T10:00:00Z',
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: '2026-08-04T10:00:00Z',
    lastObservedAt: '2026-08-04T10:00:00Z',
    unstarredAt: null
  }
}

function nativeList(listNodeId: string, name: string) {
  return {
    githubUserId: '42',
    listNodeId,
    name,
    description: null,
    visibility: 'public' as const,
    slug: null,
    createdAt: null,
    updatedAt: null,
    lastAddedAt: null,
    reportedItemCount: 1,
    importedItemCount: 1,
    importStatus: 'complete' as const,
    lastObservedAt: '2026-08-04T10:00:00Z'
  }
}

function membershipPreview(
  operation: StableMembershipPreviewResponse['operation'],
  refreshedFromJobId: string | null
): StableMembershipPreviewResponse {
  const current = previewList('L_current', 'Current List')
  const destination = previewList('L_destination', 'Destination List')
  const retained = previewList('L_retained', 'Retained List')
  return {
    status: 'stable',
    previewId: 'preview-one',
    operation,
    nonAtomic: true,
    attempts: 2,
    captureInterval: {
      startedAt: '2026-08-04T10:00:00Z',
      completedAt: '2026-08-04T10:00:10Z'
    },
    repositories: [
      {
        repositoryNodeId: 'R_one',
        fullName: 'octocat/one',
        current: [current, retained],
        resulting: [destination, retained],
        added: [destination],
        removed: [current],
        unchanged: [retained],
        noOps: [],
        createsJob: true
      },
      {
        repositoryNodeId: 'R_two',
        fullName: 'github/two',
        current: [destination],
        resulting: [destination],
        added: [],
        removed: [],
        unchanged: [destination],
        noOps: [destination],
        createsJob: false
      }
    ],
    refreshedFromJobId
  }
}

function previewList(listNodeId: string, name: string): MembershipListPreviewItem {
  return {listNodeId, name, visibility: 'public', exists: true}
}

function membershipMutationDetails(status: MutationJobStatus): MembershipMutationDetails {
  const before = {listNodeIds: ['L_current'], fingerprint: '["L_current"]'}
  const desired = {listNodeIds: ['L_destination'], fingerprint: '["L_destination"]'}
  const catalog = {
    entries: [
      {
        listNodeId: 'L_destination',
        exists: true as const,
        name: 'Destination List',
        visibility: 'public' as const
      }
    ],
    fingerprint: 'catalog'
  }
  return {
    intent: {
      kind: 'add',
      githubUserId: '42',
      repositoryNodeId: 'R_one',
      additions: ['L_destination']
    },
    confirmedBefore: before,
    desired,
    confirmedCatalog: catalog,
    latestObserved: status === 'queued' ? null : before,
    latestObservedCatalog: status === 'queued' ? null : catalog,
    membershipFingerprint: before.fingerprint,
    listCatalogFingerprint: catalog.fingerprint,
    mutationPayload: null,
    recoveryPhase: null,
    needsConfirmation: status === 'needs-confirmation'
      ? {
          confirmedBefore: before,
          observed: desired,
          confirmedCatalog: catalog,
          observedCatalog: catalog
        }
      : null,
    unstableObservation: status === 'unstable-observation'
      ? {
          status: 'changing',
          attempts: 3,
          rateLimitResetAt: null,
          occurredAt: '2026-08-04T10:00:00Z'
        }
      : null,
    verificationConflict: status === 'verification-conflict'
      ? {desired, observed: before}
      : null
  }
}

function mutationJob(
  githubUserId: string,
  status: MutationJobStatus,
  index: number,
  recoveryStatus: MutationRecoveryStatus = 'none'
): MutationJobRecord {
  return {
    githubUserId,
    jobId: `job-${githubUserId}-${index}`,
    batchId: `batch-${githubUserId}`,
    mutationKind: 'unstar',
    repositoryNodeId: `R_${index}`,
    ownerLogin: 'octocat',
    repositoryName: `repository-${index}`,
    status,
    recoveryStatus,
    retryEligibility:
      status === 'blocked-unknown' ? 'after-refresh' : 'not-retryable',
    attemptCount: status === 'queued' ? 0 : 1,
    nextEligibleExecutionAt:
      status === 'queued' || status === 'retry-waiting'
        ? '2026-08-04T10:00:00Z'
        : null,
    claimedAt: status === 'queued' ? null : '2026-08-04T10:00:00Z',
    completedAt:
      status === 'succeeded' ||
      status === 'succeeded-external' ||
      status === 'failed' ||
      status === 'blocked-unknown' ||
      status === 'cancelled'
        ? '2026-08-04T10:01:00Z'
        : null,
    lastError:
      status === 'failed' || status === 'blocked-unknown'
        ? {
            category: 'verification-mismatch',
            message: 'Safe failure detail.',
            statusCode: null,
            occurredAt: '2026-08-04T10:01:00Z'
          }
        : null,
    membershipDetails: null,
    createdAt: `2026-08-04T10:00:${String(index).padStart(2, '0')}Z`,
    updatedAt: '2026-08-04T10:01:00Z'
  }
}

function mutationBatch(
  githubUserId: string,
  jobs: readonly MutationJobRecord[]
): MutationBatchRecord {
  return {
    githubUserId,
    batchId: `batch-${githubUserId}`,
    mutationKind: 'unstar',
    origin: 'bulk',
    repositoryNodeIds: jobs.map((job) => job.repositoryNodeId),
    jobIds: jobs.map((job) => job.jobId),
    status: 'partially-completed',
    summary: {
      total: jobs.length,
      succeeded: 1,
      failed: 1,
      blockedUnknown: 1,
      queued: githubUserId === '42' ? 2 : 0,
      cancelled: 1,
      pending: 4,
      retryEligible: 1
    },
    createdAt: '2026-08-04T10:00:00Z',
    updatedAt: '2026-08-04T10:01:00Z'
  }
}

function operationHistory(
  githubUserId: string,
  repositoryNodeId: string,
  repositoryName: string
): OperationHistoryRecord {
  return {
    githubUserId,
    historyId: `history-${githubUserId}`,
    jobId: `history-job-${githubUserId}`,
    batchId: `batch-${githubUserId}`,
    mutationKind: 'unstar',
    origin: 'single',
    repositoryNodeId,
    ownerLogin: 'octocat',
    repositoryName,
    finalStatus: 'succeeded',
    verificationResult: 'verified-absent',
    attemptCount: 1,
    error: null,
    retryEligibility: 'not-retryable',
    membershipDetails: null,
    occurredAt: '2026-08-04T10:01:00Z'
  }
}

test('restores focus to an available result when filtering removes the inspected repository', async () => {
  const browserWindow = createDashboardWindow()
  // @ts-expect-error Bun query strings create a test-only module instance.
  const {mountDashboard} = await import('../../src/dashboard/scripts?stale-focus')
  const inspected = {
    ...repositoryRecord('42', 'R_inspected', 'octocat/inspected'),
    primaryLanguage: 'TypeScript'
  }
  const fallback = {
    ...repositoryRecord('42', 'R_fallback', 'github/fallback'),
    primaryLanguage: 'JavaScript'
  }
  const state: AppState = {
    ...membershipReadyDashboardState(),
    library: {
      repositories: [inspected, fallback],
      nativeLists: [],
      nativeMemberships: [],
      annotations: []
    },
    mutations: {batches: [], jobs: [], history: []}
  }
  const library = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  mountDashboard(library, state)
  const inspectedRow = library.querySelector<HTMLButtonElement>(
    '[data-repository-node-id="R_inspected"]'
  )
  expect(inspectedRow).not.toBeNull()
  if (inspectedRow === null) return
  inspectedRow.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  await browserWindow.happyDOM.whenAsyncComplete()

  const language = [...library.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Language'))
    ?.querySelector<HTMLSelectElement>('select') ?? null
  expect(language).not.toBeNull()
  if (language === null) return

  language.value = 'JavaScript'
  language.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  await browserWindow.happyDOM.whenAsyncComplete()

  const fallbackRow = library.querySelector<HTMLButtonElement>(
    '[data-repository-node-id="R_fallback"]'
  )
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  expect((browserWindow.document.activeElement as unknown) === fallbackRow).toBe(true)

  language.value = ''
  language.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
  library.remove()
})

test('restores focus to an available result when search removes the inspected repository', async () => {
  const browserWindow = createDashboardWindow()
  // @ts-expect-error Bun query strings create a test-only module instance.
  const {mountDashboard} = await import('../../src/dashboard/scripts?stale-search-focus')
  const inspected = repositoryRecord('42', 'R_inspected', 'octocat/inspected')
  const fallback = repositoryRecord('42', 'R_fallback', 'github/fallback')
  const state: AppState = {
    ...membershipReadyDashboardState(),
    library: {
      repositories: [inspected, fallback],
      nativeLists: [],
      nativeMemberships: [],
      annotations: []
    },
    mutations: {batches: [], jobs: [], history: []}
  }
  const library = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  mountDashboard(library, state)
  const inspectedRow = library.querySelector<HTMLButtonElement>(
    '[data-repository-node-id="R_inspected"]'
  )
  expect(inspectedRow).not.toBeNull()
  if (inspectedRow === null) return
  inspectedRow.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  await browserWindow.happyDOM.whenAsyncComplete()

  const search = library.querySelector<HTMLInputElement>('#library-search')
  expect(search).not.toBeNull()
  if (search === null) return
  search.value = 'github/fallback'
  search.dispatchEvent(new browserWindow.Event('input', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))

  const fallbackRow = library.querySelector<HTMLButtonElement>(
    '[data-repository-node-id="R_fallback"]'
  )
  expect(library.querySelector('.repository-inspection-dialog')).toBeNull()
  expect((browserWindow.document.activeElement as unknown) === fallbackRow).toBe(true)
  library.remove()
})

function createDashboardWindow(): Window {
  const browserWindow = new Window({url: 'chrome-extension://fixture/dashboard/index.html'})
  Object.assign(globalThis, {
    window: browserWindow,
    document: browserWindow.document,
    HTMLElement: browserWindow.HTMLElement,
    Text: browserWindow.Text,
    Event: browserWindow.Event,
    KeyboardEvent: browserWindow.KeyboardEvent
  })
  return browserWindow
}

async function openRepositoryDetails(library: HTMLElement, browserWindow: Window): Promise<void> {
  const row = library.querySelector<HTMLButtonElement>('.repository-row')
  expect(row).not.toBeNull()
  if (row === null) return
  row.dispatchEvent(new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event)
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
}

async function openAndConfirmMembership(root: HTMLElement, browserWindow: Window): Promise<void> {
  await openRepositoryDetails(root, browserWindow)
  const listChoice = root.querySelector<HTMLInputElement>(
    '.native-list-choices input[type="checkbox"]'
  )
  if (listChoice === null) throw new Error('Membership choice did not render.')
  listChoice.checked = true
  listChoice.dispatchEvent(new browserWindow.Event('change', {bubbles: true}) as unknown as Event)
  await browserWindow.happyDOM.whenAsyncComplete()
  const review = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.includes('Review additive assignment')
  )
  if (review === undefined) throw new Error('Membership review action did not render.')
  review.click()
  await nextTurn(browserWindow)
  const confirm = [...root.querySelectorAll<HTMLButtonElement>('.membership-confirmation button')]
    .find((button) => button.textContent?.includes('Confirm and queue'))
  if (confirm === undefined) throw new Error('Membership confirmation did not render.')
  confirm.click()
}

function deferred(): {readonly promise: Promise<void>; readonly resolve: () => void} {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return {promise, resolve}
}

async function mountReadyDashboard(
  state: AppState = readyDashboardState(),
  runQuery: typeof queryRepositories = queryRepositories
): Promise<HTMLElement> {
  const browserWindow = createDashboardWindow()
  const {mountDashboard} = await import('../../src/dashboard/scripts')
  const root = browserWindow.document.createElement('main') as unknown as HTMLElement
  browserWindow.document.body.append(
    root as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )
  mountDashboard(root, state, runQuery)
  await browserWindow.happyDOM.whenAsyncComplete()
  return root as unknown as HTMLElement
}

function completeSyncState(kind: SyncKind): SyncStateRecord {
  return {
    githubUserId: '42',
    kind,
    phase: 'complete',
    attempt: 1,
    pagesProcessed: 1,
    itemsObserved: 2,
    skippedItems: 0,
    convergenceAttempt: 1,
    baselineCompletedAt: '2026-08-04T10:00:00Z',
    lastStartedAt: '2026-08-04T10:00:00Z',
    lastCompletedAt: '2026-08-04T10:00:00Z',
    lastSuccessfulAt: '2099-08-04T10:00:00Z',
    rateLimit: {limit: null, remaining: null, resetAt: null},
    lastError: null
  }
}

function readyDashboardState(): AppState {
  const repository = repositoryRecord('42', 'R_one', 'octocat/one')
  return {
    ...accountState('42'),
    library: {
      repositories: [repository],
      nativeLists: [nativeList('L_current', 'Current List')],
      nativeMemberships: [],
      annotations: [
        {
          githubUserId: '42',
          repositoryNodeId: 'R_one',
          triageState: 'inbox',
          tags: ['local-only'],
          note: '',
          favorite: false,
          revisitAt: null,
          reviewedAt: null,
          localModifiedAt: '2026-08-04T10:00:00Z'
        }
      ]
    },
    mutations: {batches: [], jobs: [], history: []}
  }
}

function membershipReadyDashboardState(): AppState {
  return {
    ...readyDashboardState(),
    nativeListMembership: {readiness: 'ready'},
    writeAuthorization: {
      readiness: 'ready',
      membershipReady: true,
      previewVisible: false,
      authorization: null,
      error: null
    }
  }
}

function accountBDashboardState(): AppState {
  const repository = repositoryRecord('7', 'R_account_b', 'account-b/repository')
  const job = {
    ...mutationJob('7', 'failed', 77),
    repositoryNodeId: repository.repositoryNodeId,
    ownerLogin: repository.ownerLogin,
    repositoryName: repository.name
  }
  return {
    ...membershipReadyDashboardState(),
    identity: accountState('7').identity,
    sync: {...completeSyncState('stars'), githubUserId: '7'},
    nativeListSync: {...completeSyncState('native-lists'), githubUserId: '7'},
    library: {
      repositories: [repository],
      nativeLists: [],
      nativeMemberships: [],
      annotations: [{
        githubUserId: '7',
        repositoryNodeId: repository.repositoryNodeId,
        triageState: 'backlog',
        tags: ['account-b-only'],
        note: 'Account B private note',
        favorite: true,
        revisitAt: null,
        reviewedAt: null,
        localModifiedAt: '2026-08-19T10:00:00Z'
      }]
    },
    mutations: {batches: [mutationBatch('7', [job])], jobs: [job], history: []}
  }
}

async function expectAccountBDashboard(root: HTMLElement, browserWindow: Window): Promise<void> {
  expect(visibleRepositoryIds(root)).toEqual(['R_account_b'])
  await openRepositoryDetails(root, browserWindow)
  expect(root.querySelector<HTMLTextAreaElement>('.annotation-editor textarea')?.textContent).toBe(
    'Account B private note'
  )
  const operations = root.querySelector<HTMLButtonElement>('[data-view-kind="operations"]')
  operations?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.operations-page')?.textContent).toContain('repository')
  const settings = root.querySelector<HTMLButtonElement>('[data-view-kind="settings"]')
  settings?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  expect(root.querySelector('.settings-page')?.textContent).toContain('account-7')
}

function renameReadyDashboardState(): AppState {
  return {
    ...readyDashboardState(),
    nativeListRename: {readiness: 'ready'},
    library: {
      ...readyDashboardState().library!,
      nativeLists: [nativeList('L_current', 'Current List'), nativeList('L_other', 'Other List')]
    }
  }
}

async function mountNativeListRenameDashboard(
  state: AppState,
  sendMessage: (message: unknown) => Promise<unknown> = async () => {
    throw new Error('Unexpected runtime message.')
  }
): Promise<{readonly browserWindow: Window; readonly root: HTMLElement; readonly cleanup: () => void}> {
  const browserWindow = createDashboardWindow()
  const previousChrome = (globalThis as {chrome?: unknown}).chrome
  Object.assign(globalThis, {chrome: {runtime: {sendMessage}}})
  const {mountDashboard} = await import('../../src/dashboard/scripts')
  const root = browserWindow.document.createElement('main')
  browserWindow.document.body.append(root)
  mountDashboard(root as unknown as HTMLElement, state)
  const list = [...root.querySelectorAll('.nav-item')].find(
    (item) => item.textContent?.includes('Current List')
  ) as unknown as HTMLButtonElement | undefined
  list?.click()
  await browserWindow.happyDOM.whenAsyncComplete()
  return {
    browserWindow,
    root: root as unknown as HTMLElement,
    cleanup: () => {
      root.remove()
      if (previousChrome === undefined) delete (globalThis as {chrome?: unknown}).chrome
      else Object.assign(globalThis, {chrome: previousChrome})
    }
  }
}

function nativeListHeader(root: Element): HTMLElement | null {
  return root.querySelector<HTMLElement>('.library-header')
}

function renameEditButton(root: Element): HTMLButtonElement | null {
  return nativeListHeader(root)?.querySelector<HTMLButtonElement>('.native-list-header-actions button') ?? null
}

function nativeListNavigationButton(root: Element, name: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>('nav.archive-directory-nav .nav-item')].find(
      (button) => button.textContent?.includes(name)
    ) ?? null
  )
}

function submitNativeListRename(_browserWindow: Window, root: Element): void {
  nativeListHeader(root)?.querySelector<HTMLButtonElement>(
    'form.native-list-rename-editor .primary-action'
  )?.click()
}

async function nextTurn(browserWindow: Window): Promise<void> {
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  await browserWindow.happyDOM.whenAsyncComplete()
}

function signedOutDashboardState(): AppState {
  return {
    ...readyDashboardState(),
    phase: 'signed-out',
    identity: null,
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: null,
    mutations: null
  }
}

function visibleRepositoryIds(root: Element): string[] {
  return [...root.querySelectorAll('.repository-row')].map(
    (row) => row.getAttribute('data-repository-node-id') ?? ''
  )
}

function navigationLabels(group: Element | null): string[] {
  return [...(group?.querySelectorAll('.nav-label') ?? [])].map(
    (label) => label.textContent ?? ''
  )
}

function sidebarNavigation(root: Element): Element | null {
  return root.querySelector('nav.archive-directory-nav[aria-label="Library"]')
}

function navigationGroup(sidebar: Element | null, title: string): Element | null {
  return (
    [...(sidebar?.querySelectorAll('details.nav-group') ?? [])].find(
      (group) => navigationGroupSummary(group)?.textContent === title
    ) ?? null
  )
}

function navigationGroupSummary(group: Element | null): Element | null {
  return [...(group?.children ?? [])].find((element) => element.matches('summary')) ?? null
}

function directNavigationList(group: Element | null): Element | null {
  return [...(group?.children ?? [])].find((element) => element.matches('ul.nav-list')) ?? null
}

function accessibleDialogName(dialog: Element | null): string | null {
  if (dialog === null) return null

  const labelledBy = dialog.getAttribute('aria-labelledby')
  return labelledBy
    ? dialog.querySelector(`[id="${labelledBy}"]`)?.textContent ?? null
    : dialog.getAttribute('aria-label')
}

function directHeaderControl(container: Element | null, selector: string): Element | null {
  return [...(container?.children ?? [])].find((element) => element.matches(selector)) ?? null
}

function headerControlNames(container: Element | null): string[] {
  return [...(container?.querySelectorAll('label, button') ?? [])].map((control) => {
    if (control.matches('label')) {
      return control.querySelector('span:not(.sr-only)')?.textContent?.trim() ?? ''
    }
    return control.textContent?.trim() ?? ''
  })
}

function headerControlNamesOutside(
  container: Element | null,
  excludedContainer: Element | null
): string[] {
  return [...(container?.querySelectorAll('label, button') ?? [])]
    .filter((control) => !excludedContainer?.contains(control))
    .map((control) => {
      if (control.matches('label')) {
        return control.querySelector('span:not(.sr-only)')?.textContent?.trim() ?? ''
      }
      return control.textContent?.trim() ?? ''
    })
}
