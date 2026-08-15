import {expect, test} from 'bun:test'
import {Window} from 'happy-dom'
import type {
  MembershipMutationDetails,
  MutationBatchRecord,
  MutationJobRecord,
  MutationJobStatus,
  MutationRecoveryStatus,
  OperationHistoryRecord,
  RepositoryRecord
} from '../../src/domain/types'
import type {
  AppState,
  MembershipListPreviewItem,
  StableMembershipPreviewResponse
} from '../../src/shared/messages'

test('mounts accessible dashboard navigation and loading state', async () => {
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
  const root = browserWindow.document.createElement('main')
  browserWindow.document.body.append(root)
  mountDashboard(root as unknown as HTMLElement)

  expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Library')
  expect(root.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(root.textContent).toContain('Star List')
  expect(root.textContent).toContain('Inbox')

  const backlog = [...root.querySelectorAll('button')].find(
    (element) => element.textContent?.includes('Backlog')
  )
  backlog?.dispatchEvent(new browserWindow.MouseEvent('click', {bubbles: true}))
  await browserWindow.happyDOM.whenAsyncComplete()
  const active = root.querySelector('[aria-current="page"]')
  expect(active?.textContent).toContain('Backlog')
})

test('renders the five triage destinations in a labelled navigation group', async () => {
  const root = await mountReadyDashboard()
  const sidebar = sidebarNavigation(root)
  const triageGroup = navigationGroup(sidebar, 'Triage')
  const triageNavigation = directNavigationList(triageGroup)

  expect(triageGroup).not.toBeNull()
  expect(navigationGroupSummary(triageGroup)?.textContent).toBe('Triage')
  expect(navigationLabels(triageNavigation)).toEqual([
    'Inbox',
    'Backlog',
    'Due',
    'Organized',
    'All stars'
  ])
})

test('places history with Operations and Settings in a labelled utility group', async () => {
  const root = await mountReadyDashboard()
  const sidebar = sidebarNavigation(root)
  const utilityGroup = navigationGroup(sidebar, 'Utilities')
  const utilityNavigation = directNavigationList(utilityGroup)

  expect(utilityGroup).not.toBeNull()
  expect(navigationGroupSummary(utilityGroup)?.textContent).toBe('Utilities')
  expect(navigationLabels(utilityNavigation)).toEqual([
    'Unstarred history',
    'Operations',
    'Settings'
  ])
})

test('renders GitHub Lists and local tags in labelled, discoverable navigation groups', async () => {
  const root = await mountReadyDashboard()
  const sidebar = sidebarNavigation(root)
  const namedGroups = ['GitHub Lists', 'Local tags'].map((label) => {
    const group = navigationGroup(sidebar, label)
    return {
      label: navigationGroupSummary(group)?.textContent ?? null,
      items: navigationLabels(directNavigationList(group))
    }
  })

  expect(namedGroups).toEqual([
    {label: 'GitHub Lists', items: ['Current List']},
    {label: 'Local tags', items: ['#local-only']}
  ])
})

test('starts dynamic navigation groups collapsed', async () => {
  const root = await mountReadyDashboard()
  const sidebar = sidebarNavigation(root)

  for (const label of ['GitHub Lists', 'Local tags']) {
    const group = navigationGroup(sidebar, label)
    expect(group).not.toBeNull()
    expect(navigationGroupSummary(group)?.textContent).toBe(label)
    expect(group?.hasAttribute('open')).toBe(false)
  }
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
  const viewOptions = directHeaderControl(headerControls, 'details.view-options')
  const searchLabel = search?.labels?.[0] ?? null

  expect(search).not.toBeNull()
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
  const viewOptions = directHeaderControl(headerControls, 'details.view-options')
  const viewOptionControls = ['Language', 'Sort', 'Descending', 'Archived hidden']

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
  const {renderSettingsState} = await import('../../src/dashboard/scripts')
  const settings = renderSettingsState(
    accountState('42', {
      readiness: 'ready',
      membershipReady: true,
      previewVisible: false,
      authorization: null,
      error: null
    })
  )

  expect(settings.textContent).toContain(
    'account-scoped public_repo and user credential is ready'
  )
  expect(settings.textContent).toContain('confirmed Starring routes')
  expect(settings.textContent).toContain('structured native List membership mutation')
  expect(settings.textContent).toContain('controls remain disabled')
  expect(settings.textContent).toContain('independent read-back')
  expect(settings.textContent).not.toContain('access-secret')
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
    const restoredReview = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent === 'Review unstar'
    ) ?? null
    expect(library.querySelector('.unstar-confirmation')).toBeNull()
    expect((browserWindow.document.activeElement as unknown) === restoredReview).toBe(true)

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
    const cancel = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (element) => element.textContent === 'Cancel'
    ) ?? null
    expect(dialog).not.toBeNull()
    if (dialog === null) return

    dialog.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
    )
    await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
    const restoredFirstReview = [...library.querySelectorAll<HTMLButtonElement>('.membership-review')].find(
      (element) => element.textContent === 'Review additive assignment'
    ) ?? null
    expect((browserWindow.document.activeElement as unknown) === restoredFirstReview).toBe(true)
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
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
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
  const library = renderLibraryState(state)
  browserWindow.document.body.append(
    library as unknown as Parameters<typeof browserWindow.document.body.append>[0]
  )

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
    expect(nativeListHeader(root)?.querySelector('h1')?.textContent).toBe('Current List')
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
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(nativeListHeader(root)?.querySelector('h1')?.textContent).toBe('Current List')
    expect(messages).toBe(0)

    renameEditButton(root)?.click()
    await nextTurn(browserWindow)
    const reopened = nativeListHeader(root)?.querySelector<HTMLInputElement>('input') ?? null
    expect(reopened).not.toBeNull()
    if (reopened === null) throw new Error('The native List editor must reopen before Escape can cancel it.')
    reopened.dispatchEvent(
      new browserWindow.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}) as unknown as Event
    )
    await browserWindow.happyDOM.whenAsyncComplete()
    expect(nativeListHeader(root)?.querySelector('h1')?.textContent).toBe('Current List')
    expect(messages).toBe(0)
  } finally {
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
    expect(nativeListHeader(root)?.querySelector('h1')?.textContent).toBe('Verified Name')
    expect(navigationLabels(navigationGroup(sidebarNavigation(root), 'GitHub Lists'))).toEqual([
      'Other List',
      'Verified Name'
    ])
  } finally {
    pending.resolve()
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
      'Current List',
      'Other List'
    ])
  } finally {
    cleanup()
  }
})

test('organizes inspector facts, local fields, and GitHub changes into labelled sections', async () => {
  createDashboardWindow()
  const {renderLibraryState} = await import('../../src/dashboard/scripts')
  const library = renderLibraryState(membershipReadyDashboardState())
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
  createDashboardWindow()
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
    const restoredReview = [...library.querySelectorAll<HTMLButtonElement>('button')].find(
      (element) => element.textContent?.includes('Review additive assignment')
    ) ?? null
    expect((browserWindow.document.activeElement as unknown) === restoredReview).toBe(true)

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

function deferred(): {readonly promise: Promise<void>; readonly resolve: () => void} {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return {promise, resolve}
}

async function mountReadyDashboard(): Promise<HTMLElement> {
  const browserWindow = createDashboardWindow()
  const {mountDashboard, renderLibraryState} = await import('../../src/dashboard/scripts')
  renderLibraryState(readyDashboardState())
  const root = browserWindow.document.createElement('main')
  browserWindow.document.body.append(root)
  mountDashboard(root as unknown as HTMLElement)
  await browserWindow.happyDOM.whenAsyncComplete()
  return root as unknown as HTMLElement
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
  const {mountDashboard, renderLibraryState} = await import('../../src/dashboard/scripts')
  renderLibraryState(state)
  const root = browserWindow.document.createElement('main')
  browserWindow.document.body.append(root)
  mountDashboard(root as unknown as HTMLElement)
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

function submitNativeListRename(_browserWindow: Window, root: Element): void {
  nativeListHeader(root)?.querySelector<HTMLButtonElement>(
    'form.native-list-rename-editor .primary-action'
  )?.click()
}

async function nextTurn(browserWindow: Window): Promise<void> {
  await new Promise<void>((resolve) => browserWindow.setTimeout(resolve, 0))
  await browserWindow.happyDOM.whenAsyncComplete()
}

function navigationLabels(group: Element | null): string[] {
  return [...(group?.querySelectorAll('.nav-label') ?? [])].map(
    (label) => label.textContent ?? ''
  )
}

function sidebarNavigation(root: Element): Element | null {
  return root.querySelector('nav.sidebar[aria-label="Library"]')
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
