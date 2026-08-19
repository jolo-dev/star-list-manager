import van from 'vanjs-core'
import {validateNativeListRename} from '../domain/native-list-rename'
import {sendRuntimeMessage} from '../platform/browser'
import type {
  AppState,
  MembershipListPreviewItem,
  MembershipOperationSelection,
  MembershipPreviewResponse,
  RuntimeMessage,
  RuntimeResponse,
  StableMembershipPreviewResponse
} from '../shared/messages'
import type {AnnotationPatch, AppPhase} from '../shared/messages'
import type {
  ExportPayload,
  ImportImpact,
  MutationBatchRecord,
  MutationJobRecord,
  MutationJobStatus,
  OperationHistoryRecord,
  RepositorySort,
  RepositoryRecord,
  TriageState
} from '../domain/types'
import {
  availableLanguages,
  buildLibraryRepositories,
  defaultRepositoryFilters,
  deriveViewCounts,
  nextSelectionIndex,
  operationHistoryForRepository,
  queryRepositories,
  safeGitHubUrl,
  type LibraryRepository,
  type LibraryView,
  type InclusionFilter,
  type RepositoryQuery,
  type StarFilter
} from './library'
import {
  classifyWorkspace,
  dashboardSliceFingerprints,
  indexLatestRepositoryJobs,
  projectRepositoryResults,
  type DashboardSliceFingerprints,
  type DashboardWorkspace,
  type DerivedRepositoryResults,
  type RepositoryQueryRunner
} from './derivations'
import './styles.css'

const {
  a,
  article: articleElement,
  button,
  details,
  div,
  form,
  h1,
  h2,
  h3,
  h4,
  header,
  input,
  label,
  li,
  main,
  nav,
  option,
  p,
  section,
  select,
  span,
  strong: strongText,
  summary,
  textarea,
  ul
} = van.tags

const emptyState: AppState = {
  phase: 'loading',
  identity: null,
  authorization: null,
  writeAuthorization: {
    readiness: 'signed-out',
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
}
const appState = van.state<AppState>(emptyState)
const publishedPhase = van.state<AppPhase>(emptyState.phase)
const publishedIdentity = van.state<AppState['identity']>(emptyState.identity)
const publishedAuthorization = van.state<AppState['authorization']>(emptyState.authorization)
const publishedWriteAuthorization = van.state<AppState['writeAuthorization']>(emptyState.writeAuthorization)
const publishedSync = van.state<AppState['sync']>(emptyState.sync)
const publishedNativeListSync = van.state<AppState['nativeListSync']>(emptyState.nativeListSync)
const publishedNativeListMembership = van.state<AppState['nativeListMembership']>(emptyState.nativeListMembership)
const publishedNativeListRename = van.state<AppState['nativeListRename']>(emptyState.nativeListRename)
const publishedTriageCounts = van.state<AppState['triageCounts']>(emptyState.triageCounts)
const publishedLibrary = van.state<AppState['library']>(emptyState.library)
const publishedMutations = van.state<AppState['mutations']>(emptyState.mutations)
const publishedError = van.state<AppState['error']>(emptyState.error)
let publishedFingerprints: DashboardSliceFingerprints = dashboardSliceFingerprints(emptyState)
const activeView = van.state<LibraryView>({kind: 'unlist'})
const searchText = van.state('')
const sort = van.state<RepositorySort>('starred-at')
const ascending = van.state(false)
const language = van.state<string | null>(null)
const hideArchived = van.state(true)
const starState = van.state<StarFilter>('starred')
const disabled = van.state<InclusionFilter>('all')
const triageState = van.state<TriageState | null>(null)
const starredAfter = van.state<string | null>(null)
const starredBefore = van.state<string | null>(null)
const pushedAfter = van.state<string | null>(null)
const pushedBefore = van.state<string | null>(null)
const selectedRepositoryNodeId = van.state<string | null>(null)
const inspectedRepositoryNodeId = van.state<string | null>(null)
const selectedForUnstar = van.state<ReadonlySet<string>>(new Set())
const pendingUnstarTargets = van.state<readonly UnstarConfirmationTarget[]>([])
const enqueueingUnstars = van.state(false)
const selectedNativeListIds = van.state<ReadonlySet<string>>(new Set())
const membershipOperation = van.state<'add' | 'remove' | 'move'>('add')
const moveSourceListNodeId = van.state('')
const moveDestinationListNodeId = van.state('')
const membershipActivity = van.state<string | null>(null)
const pendingMembershipPreview = van.state<StableMembershipPreviewResponse | null>(null)
const confirmingMembership = van.state(false)
const syncing = van.state(false)
const editingNativeListId = van.state<string | null>(null)
const nativeListRenameDraft = van.state('')
const nativeListRenameError = van.state<string | null>(null)
const savingNativeListRename = van.state(false)
let nextNativeListRenameRequestToken = 0
let activeNativeListRenameRequest: NativeListRenameRequest | null = null
let nativeListRenameInvoker: NativeListRenameInvoker | null = null
let unstarDialogInvoker: DialogInvoker | null = null
let membershipDialogInvoker: DialogInvoker | null = null
let repositoryDialogInvoker: DialogInvoker | null = null
let nextMembershipPreviewRequestToken = 0
let activeMembershipPreviewRequestToken: number | null = null
let pollTimer: number | null = null
let autoSyncAccountId: string | null = null
let dashboardAccountId: string | null = null
const latestJobsByRepository = van.state<ReadonlyMap<string, MutationJobRecord>>(new Map())
let latestJobsInputKey = ''

export interface UnstarConfirmationTarget {
  readonly repositoryNodeId: string
  readonly fullName: string
}

interface DialogInvoker {
  readonly element: HTMLElement
  readonly id: string | null
}

interface NativeListRenameRequest {
  readonly token: number
  readonly accountId: string | null
}

interface NativeListRenameInvoker {
  readonly listNodeId: string
}

const workspaceKind = van.derive(() =>
  classifyWorkspace(publishedPhase.val, activeView.val)
)

function Dashboard() {
  const workspaces = {
    library: ReadyLibraryState(),
    operations: PersistentStatePage('operations-page', OperationsState),
    settings: PersistentStatePage('settings-page', SettingsState),
    phase: div({class: 'phase-workspace'}, () => renderState(currentPublishedState()))
  }
  return div(
    {class: 'app-shell'},
    Navigation(),
    main(
      {class: 'workspace', 'data-workspace-kind': workspaceKind},
      () => renderWorkspace(
        classifyWorkspace(publishedPhase.val, activeView.val),
        workspaces
      )
    )
  )
}
function Navigation() {
  return nav(
    {class: 'sidebar', 'aria-label': 'Library'},
    div(
      {class: 'brand'},
      span({class: 'brand-mark', 'aria-hidden': 'true'}, 'S'),
      div(span({class: 'brand-name'}, 'Star List'), span('Manager'))
    ),
    () => div({class: 'nav-groups'}, ...NavigationGroups())
  )
}

function NavigationGroups() {
  const repositories = publishedLibrary.val
    ? buildLibraryRepositories(publishedLibrary.val)
    : []
  const counts = deriveViewCounts(
    repositories,
    hideArchived.val ? 'exclude' : 'all'
  )
  const lists = publishedLibrary.val?.nativeLists.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  ) ?? []
  return [
    details(
      {class: 'nav-group', open: true},
      summary('GitHub Lists'),
      ul(
        {class: 'nav-list nav-list-secondary'},
        NavItem('Unlist', {kind: 'unlist'}, counts.unlist),
        ...lists.map((nativeList) =>
          NavItem(
            nativeList.name,
            {kind: 'list', listNodeId: nativeList.listNodeId},
            counts.lists[nativeList.listNodeId] ?? 0
          )
        )
      )
    ),
    details(
      {class: 'nav-group nav-group-utilities', open: true},
      summary('Utilities'),
      ul(
        {class: 'nav-list nav-list-secondary'},
        NavItem('Operations', {kind: 'operations'}, null),
        NavItem('Settings', {kind: 'settings'}, null)
      )
    )
  ]
}

function NavItem(title: string, view: LibraryView, count: number | null) {
  return li(
    button(
      {
        class: () => isActiveView(view) ? 'nav-item is-active' : 'nav-item',
        type: 'button',
        'aria-current': () => isActiveView(view) ? 'page' : null,
        'data-view-key': JSON.stringify(view),
        onclick: () => {
          if (enqueueingUnstars.val || confirmingMembership.val) return
          setActiveView(view)
          selectedRepositoryNodeId.val = null
          inspectedRepositoryNodeId.val = null
          repositoryDialogInvoker = null
          selectedForUnstar.val = new Set()
          resetUnstarConfirmation()
          resetMembershipPreview()
        }
      },
      span({class: 'nav-label'}, title),
      count === null ? null : span(String(count))
    )
  )
}

function currentPublishedState(): AppState {
  return {
    phase: publishedPhase.val,
    identity: publishedIdentity.val,
    authorization: publishedAuthorization.val,
    writeAuthorization: publishedWriteAuthorization.val,
    ...(publishedNativeListMembership.val === undefined
      ? {}
      : {nativeListMembership: publishedNativeListMembership.val}),
    ...(publishedNativeListRename.val === undefined
      ? {}
      : {nativeListRename: publishedNativeListRename.val}),
    sync: publishedSync.val,
    nativeListSync: publishedNativeListSync.val,
    triageCounts: publishedTriageCounts.val,
    library: publishedLibrary.val,
    ...(publishedMutations.val === undefined
      ? {}
      : {mutations: publishedMutations.val}),
    error: publishedError.val
  }
}

function renderWorkspace(
  kind: DashboardWorkspace,
  workspaces: {
    readonly library: HTMLElement
    readonly operations: HTMLElement
    readonly settings: HTMLElement
    readonly phase: HTMLElement
  }
) {
  if (kind === 'library') return workspaces.library
  if (kind === 'operations') return workspaces.operations
  if (kind === 'settings') return workspaces.settings
  return workspaces.phase
}

function PersistentStatePage(
  className: string,
  render: (state: AppState) => HTMLElement
) {
  return div(
    {class: className},
    () => {
      const rendered = render(currentPublishedState())
      return div({class: 'state-page-content'}, ...rendered.childNodes)
    }
  )
}

function renderState(state: AppState) {
  switch (state.phase) {
    case 'loading':
    case 'reauthentication':
      return LoadingState(
        state.phase === 'reauthentication'
          ? 'Preparing a new GitHub authorization.'
          : 'Loading the local account state and extension configuration.'
      )
    case 'authorization-pending':
      return AuthorizationPendingState(state)
    case 'authorization-expired':
      return AuthorizationResultState('Code expired', 'The GitHub device code expired.')
    case 'authorization-denied':
      return AuthorizationResultState(
        'Authorization denied',
        'GitHub did not authorize this extension. No local data was changed.'
      )
    case 'signed-out':
      return FirstRunState(true, state.error?.message ?? null)
    case 'first-run':
      return FirstRunState(false, state.error?.message ?? null)
    case 'ready':
      return ReadyLibraryState()
  }
}

function ReadyLibraryState(
  runQuery: RepositoryQueryRunner = queryRepositories
) {
  const repositories = van.derive(() =>
    publishedLibrary.val ? buildLibraryRepositories(publishedLibrary.val) : []
  )
  let page: HTMLElement | null = null
  let wasConnected = false
  let lastMatches: readonly LibraryRepository[] = []
  const repositoryMatches = van.derive(() => {
    if (page?.isConnected) wasConnected = true
    if (wasConnected && !page?.isConnected) return lastMatches
    const snapshot = publishedLibrary.val
    const queryRepositoriesInput = snapshot
      ? buildLibraryRepositories(snapshot)
      : []
    lastMatches = runQuery(queryRepositoriesInput, currentQuery(), Date.now())
    return lastMatches
  })
  page = div(
    {class: 'library-page'},
    LibraryHeader(repositories, repositoryMatches),
    () => SelectionActions(currentPublishedState(), repositories.val),
    () => AdvancedFilters(),
    () => StatusBanners(currentPublishedState()),
    () => {
      publishedLibrary.val
      return LibraryResults(
        projectRepositoryResults(
          repositoryMatches.val,
          inspectedRepositoryNodeId.val,
          200
        )
      )
    },
    () =>
      pendingUnstarTargets.val.length > 0
        ? UnstarConfirmation(
            currentPublishedState(),
            pendingUnstarTargets.val,
            () => void confirmPendingUnstars(),
            () => cancelUnstarConfirmation(true)
          )
        : '',
    () =>
      pendingMembershipPreview.val
        ? MembershipConfirmation(
            pendingMembershipPreview.val,
            () => void confirmMembershipPreview(),
            () => cancelMembershipPreview(true)
          )
        : ''
  )
  window.setTimeout(() => {
    if (page?.isConnected) wasConnected = true
  }, 0)
  return page
}

function LibraryResults(results: DerivedRepositoryResults) {
  const query = currentQuery()
  const visibleResults = results.visible
  const selected = selectCurrentRepository(visibleResults)
  const inspected = inspectedRepositoryNodeId.val
    ? results.all.find(
        (item) => item.repository.repositoryNodeId === inspectedRepositoryNodeId.val
      ) ?? null
    : null
  if (inspectedRepositoryNodeId.val && !results.inspectedRemainsVisible) {
    dismissStaleRepositoryInspection()
  }

  return div(
    {class: 'library-results'},
    div(
      {class: 'library-grid'},
      section(
        {class: 'results-panel'},
        results.count === 0
          ? NoResultsState(query.search.length > 0)
          : ul(
              {
                class: 'repository-list',
                'aria-label': 'Repositories',
                onkeydown: (event: KeyboardEvent) =>
                  handleResultKey(event, visibleResults)
              },
              ...visibleResults.map((item) => RepositoryRow(item, selected))
            ),
        results.count > visibleResults.length
          ? p(
              {class: 'result-limit'},
              `Showing the first ${visibleResults.length} of ${results.count} matches. Refine the local search to narrow the list.`
            )
          : null
      )
    ),
    inspected ? RepositoryInspectionDialog(inspected) : null
  )
}

function LibraryHeader(
  repositories: {readonly val: readonly LibraryRepository[]},
  repositoryMatches: {readonly val: readonly LibraryRepository[]}
) {
  return header(
    {class: 'library-header'},
    div(
      () => LibraryViewContext(),
      h1(() => populationTitle(starState.val)),
      p(
        {class: 'result-count', 'aria-live': 'polite'},
        () => `${repositoryMatches.val.length} repositories`
      )
    ),
    div(
      {class: 'library-actions'},
      label(
        {class: 'search-field'},
        span('Search'),
        input({
          id: 'library-search',
          type: 'search',
          placeholder: 'Search stars, notes, Lists…',
          value: searchText,
          oninput: (event: Event) => {
            searchText.val = (event.currentTarget as HTMLInputElement).value
            selectedRepositoryNodeId.val = null
          }
        })
      ),
      button(
        {
          class: 'refresh-button',
          type: 'button',
          disabled: syncing,
          onclick: () => void sendAction({type: 'start-sync', force: true})
        },
        () => (syncing.val ? 'Syncing…' : 'Refresh')
      ),
      details(
        {class: 'view-options'},
        summary('View options'),
        div(
          {class: 'view-options-controls'},
          label(
            span('Language'),
            () => select(
              {
                value: () => language.val ?? '',
                onchange: (event: Event) => {
                  language.val = (event.currentTarget as HTMLSelectElement).value || null
                }
              },
              option({value: ''}, 'All'),
              ...availableLanguages(repositories.val).map((value) =>
                option({value}, value)
              )
            )
          ),
          label(
            span('Sort'),
            select(
              {
                value: sort,
                onchange: (event: Event) => {
                  sort.val = (event.currentTarget as HTMLSelectElement)
                    .value as RepositorySort
                }
              },
              option({value: 'starred-at'}, 'Star date'),
              option({value: 'pushed-at'}, 'Push date'),
              option({value: 'reviewed-at'}, 'Review date'),
              option({value: 'name'}, 'Name')
            )
          ),
          button(
            {
              class: 'filter-toggle',
              type: 'button',
              'aria-pressed': ascending,
              onclick: () => {
                ascending.val = !ascending.val
              }
            },
            () => (ascending.val ? 'Ascending' : 'Descending')
          ),
          button(
            {
              class: 'filter-toggle',
              type: 'button',
              'aria-pressed': hideArchived,
              onclick: () => {
                hideArchived.val = !hideArchived.val
              }
            },
            () => (hideArchived.val ? 'Archived hidden' : 'Archived shown')
          )
        )
      ),
      () => {
        const identity = publishedIdentity.val
        return identity
          ? span(
              {
                class: 'header-avatar',
                title: `Connected as ${identity.login}`,
                'aria-label': `Connected as ${identity.login}`
              },
              identity.login.slice(0, 1).toLocaleUpperCase()
            )
          : null
      }
    )
  )
}

function LibraryViewContext() {
  const currentNativeList = () => {
    const view = activeView.val
    return view.kind === 'list'
      ? publishedLibrary.val?.nativeLists.find(
          (list) => list.listNodeId === view.listNodeId
        ) ?? null
      : null
  }
  const hasEditor = () =>
    currentNativeList() !== null &&
    publishedNativeListRename.val?.readiness === 'ready'
  return div(
    {class: 'library-view-context'},
    p(
      {class: 'eyebrow', hidden: hasEditor},
      () => {
        const view = activeView.val
        if (view.kind === 'unlist') return 'Unlist'
        return currentNativeList()?.name ?? 'GitHub List'
      }
    ),
    () => {
      const nativeList = currentNativeList()
      if (!nativeList || !hasEditor()) return null
      const editing = () => editingNativeListId.val === nativeList.listNodeId
      return div(
        {class: 'native-list-header-editor'},
        div(
          {class: 'native-list-header-title', hidden: editing},
          p({class: 'eyebrow'}, nativeList.name),
          div(
            {class: 'native-list-header-actions'},
            button(
              {
                class: 'secondary-action',
                type: 'button',
                'data-native-list-rename-invoker': nativeList.listNodeId,
                onclick: (event: MouseEvent) =>
                  beginNativeListRename(
                    nativeList.listNodeId,
                    nativeList.name,
                    event.currentTarget as HTMLElement
                  )
              },
              'Edit'
            )
          )
        ),
        NativeListRenameEditor(nativeList.listNodeId, editing)
      )
    }
  )
}

function NativeListRenameEditor(listNodeId: string, editing: () => boolean) {
  const inputId = `native-list-rename-${listNodeId}`
  const errorId = `${inputId}-error`
  const nameInput = input({
    id: inputId,
    type: 'text',
    value: nativeListRenameDraft,
    disabled: savingNativeListRename,
    'aria-invalid': () => (nativeListRenameError.val === null ? 'false' : 'true'),
    oninput: (event: Event) => {
      nativeListRenameDraft.val = (event.currentTarget as HTMLInputElement).value
      nativeListRenameError.val = null
    }
  })
  return form(
    {
      class: 'native-list-rename-editor',
      hidden: () => !editing(),
      onsubmit: (event: SubmitEvent) => {
        event.preventDefault()
        void submitNativeListRename(listNodeId)
      },
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelNativeListRename()
        }
      }
    },
    label(
      {for: inputId},
      span('List name'),
      nameInput
    ),
    div(
      {class: 'native-list-header-actions'},
      button(
        {
          class: 'primary-action',
          type: 'submit',
          disabled: savingNativeListRename
        },
        () => (savingNativeListRename.val ? 'Saving…' : 'Save')
      ),
      button(
        {
          class: 'secondary-action',
          type: 'button',
          disabled: savingNativeListRename,
          onclick: cancelNativeListRename
        },
        'Cancel'
      )
    ),
    () => {
      const error = nativeListRenameError.val
      if (error === null) {
        nameInput.removeAttribute('aria-describedby')
        return ''
      }
      nameInput.setAttribute('aria-describedby', errorId)
      return p({class: 'inline-error', id: errorId, role: 'alert'}, error)
    }
  )
}

function beginNativeListRename(listNodeId: string, name: string, invoker: HTMLElement): void {
  if (savingNativeListRename.val || activeNativeListRenameRequest !== null) return
  nativeListRenameInvoker = {
    listNodeId: invoker.dataset.nativeListRenameInvoker ?? listNodeId
  }
  editingNativeListId.val = listNodeId
  nativeListRenameDraft.val = name
  nativeListRenameError.val = null
  window.setTimeout(() => {
    const inputElement = document.getElementById(`native-list-rename-${listNodeId}`)
    if (
      inputElement instanceof HTMLElement &&
      inputElement.isConnected &&
      inputElement.closest('[hidden]') === null
    ) {
      inputElement.focus()
    }
  }, 0)
}

function cancelNativeListRename(): void {
  if (savingNativeListRename.val || activeNativeListRenameRequest !== null) return
  const invoker = nativeListRenameInvoker
  resetNativeListRenameEditor()
  restoreNativeListRenameInvoker(invoker)
}

async function submitNativeListRename(listNodeId: string): Promise<void> {
  if (
    savingNativeListRename.val ||
    activeNativeListRenameRequest !== null ||
    editingNativeListId.val !== listNodeId
  ) {
    return
  }
  const validation = validateNativeListRename(
    nativeListRenameDraft.val,
    listNodeId,
    appState.val.library?.nativeLists ?? []
  )
  if (!validation.ok) {
    nativeListRenameError.val = validation.error.message
    return
  }

  const request: NativeListRenameRequest = {
    token: ++nextNativeListRenameRequestToken,
    accountId: appState.val.identity?.githubUserId ?? null
  }
  activeNativeListRenameRequest = request
  savingNativeListRename.val = true
  nativeListRenameError.val = null
  try {
    const response = (await sendRuntimeMessage({
      type: 'rename-native-list',
      listNodeId,
      name: validation.value
    })) as RuntimeResponse<AppState>
    if (!response.ok) {
      if (
        response.data !== undefined &&
        isCurrentNativeListRenameAccount(request) &&
        response.data.identity?.githubUserId === request.accountId
      ) {
        const targetExists = response.data.library?.nativeLists.some(
          (list) => list.listNodeId === listNodeId
        ) ?? false
        applyState({...response.data, error: response.error})
        if (targetExists && isCurrentNativeListRenameEditor(request, listNodeId)) {
          nativeListRenameError.val = response.error.message
        }
        return
      }
      if (isCurrentNativeListRenameEditor(request, listNodeId)) {
        nativeListRenameError.val = response.error.message
      }
      return
    }
    if (
      !isCurrentNativeListRenameAccount(request) ||
      response.data.identity?.githubUserId !== request.accountId
    ) {
      return
    }
    applyState(response.data)
    if (activeView.val.kind === 'list' && activeView.val.listNodeId === listNodeId) {
      resetNativeListRenameEditor()
    }
  } catch {
    if (isCurrentNativeListRenameEditor(request, listNodeId)) {
      nativeListRenameError.val = 'Unable to rename the GitHub List. Please try again.'
    }
  } finally {
    releaseNativeListRenameRequest(request)
  }
}

function isCurrentNativeListRenameAccount(request: NativeListRenameRequest): boolean {
  return (
    activeNativeListRenameRequest?.token === request.token &&
    appState.val.identity?.githubUserId === request.accountId
  )
}

function isCurrentNativeListRenameEditor(
  request: NativeListRenameRequest,
  listNodeId: string
): boolean {
  return (
    isCurrentNativeListRenameAccount(request) &&
    editingNativeListId.val === listNodeId
  )
}

function releaseNativeListRenameRequest(request: NativeListRenameRequest): void {
  if (activeNativeListRenameRequest?.token !== request.token) return
  activeNativeListRenameRequest = null
  savingNativeListRename.val = false
}

function resetNativeListRenameEditor(): void {
  editingNativeListId.val = null
  nativeListRenameDraft.val = ''
  nativeListRenameError.val = null
  nativeListRenameInvoker = null
}

function restoreNativeListRenameInvoker(invoker: NativeListRenameInvoker | null): void {
  if (invoker === null) return
  window.setTimeout(() => {
    const editButton = [...document.querySelectorAll<HTMLButtonElement>(
      '[data-native-list-rename-invoker]'
    )].find((element) => element.dataset.nativeListRenameInvoker === invoker.listNodeId) ?? null
    if (
      editButton !== null &&
      editButton.isConnected &&
      editButton.closest('[hidden]') === null
    ) {
      editButton.focus()
    }
  }, 0)
}

function SelectionActions(
  state: AppState,
  repositories: readonly LibraryRepository[]
) {
  const selected = repositories
    .filter(
      (item) =>
        item.repository.isStarred &&
        selectedForUnstar.val.has(item.repository.repositoryNodeId)
    )
    .map((item) => item.repository)
  if (selected.length === 0) return ''

  return section(
    {class: 'selection-bar', 'aria-live': 'polite'},
    div(
      span({class: 'selection-count'}, `${selected.length} selected`),
      span('Selection changes no stars, notes, tags, favorites, or triage state.')
    ),
    div(
      {class: 'selection-actions'},
      NativeListMembershipControls(state, selected, 'bulk'),
      button(
        {
          class: 'danger-action',
          type: 'button',
          'data-dialog-invoker': `unstar-bulk-${selected.map((repository) => repository.repositoryNodeId).join('-')}`,
          disabled:
            state.writeAuthorization.readiness !== 'ready' ||
            selected.some((repository) =>
              hasActiveRepositoryJob(repository.repositoryNodeId)
          ),
          onclick: (event: MouseEvent) =>
            openUnstarConfirmation(selected, event.currentTarget as HTMLElement)
        },
        `Review unstar for ${selected.length}`
      ),
      button(
        {
          class: 'secondary-action',
          type: 'button',
          onclick: () => {
            selectedForUnstar.val = new Set()
          }
        },
        'Clear selection'
      )
    ),
    state.writeAuthorization.readiness !== 'ready'
      ? WriteReadinessNotice(state)
      : null
  )
}

function NativeListMembershipControls(
  state: AppState,
  repositories: readonly RepositoryRecord[],
  context: 'single' | 'bulk'
) {
  const lists = state.library?.nativeLists.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  ) ?? []
  if (lists.length === 0 || repositories.length === 0) return null
  const ready = state.nativeListMembership?.readiness === 'ready'
  const blockedByJob = repositories.some((repository) =>
    hasActiveRepositoryJob(repository.repositoryNodeId)
  )
  const activeOperationNoticeId = `membership-active-operation-${context}-${repositories.map((repository) => repository.repositoryNodeId).join('-')}`
  const selected = selectedNativeListIds.val
  const commonMemberships = new Set(
    lists
      .filter((list) =>
        repositories.every((repository) =>
          state.library?.nativeMemberships.some(
            (membership) =>
              membership.repositoryNodeId === repository.repositoryNodeId &&
              membership.listNodeId === list.listNodeId
          )
        )
      )
      .map((list) => list.listNodeId)
  )
  const operation = membershipOperation.val
  const selectionReady = operation === 'move'
    ? moveSourceListNodeId.val.length > 0 &&
      moveDestinationListNodeId.val.length > 0 &&
      moveSourceListNodeId.val !== moveDestinationListNodeId.val
    : selected.size > 0
  const heading = context === 'single' ? h4 : h3

  return div(
    {
      class: `membership-controls membership-controls-${context}`,
      'aria-label': `Native GitHub List membership for ${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'}`
    },
    div(
      {class: 'membership-heading'},
      div(
        heading('Native GitHub Lists'),
        p('Remote membership among existing Lists. Local tags are separate and stay unchanged.')
      ),
      span({class: 'remote-chip'}, 'GitHub account')
    ),
    div(
      {
        class: 'membership-operation-tabs',
        role: 'group',
        'aria-label': 'Membership operation'
      },
      ...(['add', 'remove', 'move'] as const).map((kind) =>
        button(
          {
            type: 'button',
            class: membershipOperation.val === kind ? 'is-active' : '',
            'aria-pressed': membershipOperation.val === kind,
            onclick: () => {
              membershipOperation.val = kind
              membershipActivity.val = null
            }
          },
          kind === 'add'
            ? 'Add to Lists'
            : kind === 'remove'
              ? 'Remove from Lists'
              : 'Move between Lists'
        )
      )
    ),
    operation === 'move'
      ? div(
          {class: 'move-fields'},
          label(
            span('Current source List'),
            select(
              {
                value: moveSourceListNodeId,
                onchange: (event: Event) => {
                  moveSourceListNodeId.val = (event.currentTarget as HTMLSelectElement).value
                }
              },
              option({value: ''}, 'Choose a current source'),
              ...lists
                .filter((list) => commonMemberships.has(list.listNodeId))
                .map((list) => option({value: list.listNodeId}, list.name))
            )
          ),
          label(
            span('Existing destination List'),
            select(
              {
                value: moveDestinationListNodeId,
                onchange: (event: Event) => {
                  moveDestinationListNodeId.val = (event.currentTarget as HTMLSelectElement).value
                }
              },
              option({value: ''}, 'Choose a destination'),
              ...lists.map((list) =>
                option(
                  {value: list.listNodeId},
                  `${list.name}${commonMemberships.has(list.listNodeId) ? ' (already present; addition is a no-op)' : ''}`
                )
              )
            )
          )
        )
      : div(
          {class: 'native-list-choices'},
          ...lists.map((nativeList) => {
            const presentForAll = commonMemberships.has(nativeList.listNodeId)
            const presentForAny = repositories.some((repository) =>
              state.library?.nativeMemberships.some(
                (membership) =>
                  membership.repositoryNodeId === repository.repositoryNodeId &&
                  membership.listNodeId === nativeList.listNodeId
              )
            )
            const noOp = operation === 'add' ? presentForAll : !presentForAny
            return label(
              input({
                type: 'checkbox',
                checked: selected.has(nativeList.listNodeId),
                onchange: (event: Event) =>
                  toggleNativeListSelection(
                    nativeList.listNodeId,
                    (event.currentTarget as HTMLInputElement).checked
                  )
              }),
              span(nativeList.name),
              noOp ? span({class: 'no-op-label'}, 'No-op') : null
            )
          })
        ),
    operation === 'move' && commonMemberships.size === 0
      ? p(
          {class: 'membership-block', role: 'status'},
          'No synchronized source List is shared by every selected repository. Choose repositories with a common current membership.'
        )
      : null,
    membershipActivity.val
      ? p({class: 'membership-activity', role: 'status'}, membershipActivity.val)
      : null,
    !ready
      ? p(
          {class: 'membership-block', role: 'status'},
          membershipReadinessMessage(state)
        )
      : null,
    blockedByJob
      ? p(
          {
            class: 'membership-block',
            id: activeOperationNoticeId,
            role: 'status'
          },
          `A native GitHub List membership operation is already active or queued for ${repositories.length === 1 ? 'this repository' : 'one or more selected repositories'}. Wait for it to complete before reviewing another change.`
        )
      : null,
    button(
      {
        class: operation === 'add'
          ? 'primary-action membership-review'
          : 'danger-action membership-review',
        type: 'button',
        'data-dialog-invoker': `membership-${context}-${repositories.map((repository) => repository.repositoryNodeId).join('-')}`,
        disabled: !ready || blockedByJob || !selectionReady,
        ...(blockedByJob ? {'aria-describedby': activeOperationNoticeId} : {}),
        onclick: (event: MouseEvent) =>
          void requestMembershipPreview(
            repositories.map((repository) => repository.repositoryNodeId),
            selectedMembershipOperation(),
            event.currentTarget as HTMLElement
          )
      },
      operation === 'add'
        ? `Review additive assignment${context === 'bulk' ? ` for ${repositories.length}` : ''}`
        : operation === 'remove'
          ? `Review explicit removal${context === 'bulk' ? ` for ${repositories.length}` : ''}`
          : `Review destructive move${context === 'bulk' ? ` for ${repositories.length}` : ''}`
    )
  )
}

function MembershipConfirmation(
  preview: StableMembershipPreviewResponse,
  onConfirm: () => void,
  onCancel: () => void
) {
  const changed = preview.repositories.filter((repository) => repository.createsJob)
  const destructive = preview.operation !== 'add'
  const repositoryCount = preview.repositories.length
  const repositoryNoun = repositoryCount === 1 ? 'repository' : 'repositories'
  const changeSummary = {
    add: 'will be added to the selected GitHub Lists',
    remove: 'will be removed from the selected GitHub Lists',
    move: 'will move between GitHub Lists'
  }[preview.operation]
  return div(
    {class: 'dialog-backdrop', role: 'presentation'},
    section(
      {
        class: `confirmation-dialog membership-confirmation${destructive ? ' is-destructive' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'membership-confirmation-title',
        tabindex: -1,
        onkeydown: (event: KeyboardEvent) =>
          handleDialogKeydown(event, !confirmingMembership.val, onCancel)
      },
      p(
        {class: 'eyebrow'},
        preview.refreshedFromJobId
          ? 'Refreshed confirmation required'
          : 'Remote GitHub List change'
      ),
      h2({id: 'membership-confirmation-title'}, `Review List memberships for ${repositoryCount} ${repositoryNoun}`),
      p({class: 'membership-preview-scope'}, `Preview scope: ${repositoryCount} ${repositoryNoun}.`),
      p(
        {class: 'membership-outcome'},
        changed.length === 0
          ? '0 repositories will change. 0 jobs will be queued. Review the current and resulting complete List sets below; no confirmation is required.'
          : `${changed.length} ${changed.length === 1 ? 'repository' : 'repositories'} ${changeSummary}. Review the current and resulting complete List sets below, then confirm${preview.refreshedFromJobId ? ' the refreshed preview' : ''} to queue the preserved original intent.`
      ),
      preview.refreshedFromJobId
        ? p(
            {class: 'membership-refreshed-notice'},
            'GitHub List membership changed after your earlier confirmation. The original intent is preserved, but a fresh stable observation produced this updated preview and requires a new confirmation; the earlier confirmation will not execute.'
          )
        : null,
      p(
        `Stable after ${preview.attempts} complete observations. This preview covers exactly ${repositoryCount} ${repositoryNoun}; ${changed.length} will create queued jobs.`
      ),
      div(
        {class: 'membership-preview-list'},
        ...preview.repositories.map(MembershipRepositoryPreviewCard)
      ),
      p(
        {class: 'replace-all-warning'},
        'GitHub replaces the complete List membership set; it does not provide an additive or conditional write. Star List Manager sends the resulting complete set and preserves memberships in the final stable pre-write observation.'
      ),
      p(
        {class: 'concurrency-warning'},
        'Membership discovery and verification use multiple requests, not an atomic snapshot. Changes made on GitHub during observation, between the final observation and mutation, or during verification cannot be prevented and may cause reconfirmation, instability, or a desired-versus-observed conflict.'
      ),
      changed.length === 0
        ? p(
            {class: 'no-op-summary', role: 'status'},
            'Every requested destination or removal is already satisfied. No mutation jobs will be created.'
          )
        : null,
      div(
        {class: 'action-row'},
        button(
          {
            class: destructive ? 'danger-action' : 'primary-action',
            type: 'button',
            disabled: changed.length === 0 || confirmingMembership.val,
            onclick: onConfirm
          },
          confirmingMembership.val
            ? 'Queueing...'
            : `Confirm and queue ${changed.length}`
        ),
        button(
          {
            class: 'secondary-action dialog-cancel',
            type: 'button',
            disabled: confirmingMembership.val,
            onclick: () => {
              if (!confirmingMembership.val) onCancel()
            }
          },
          'Cancel'
        )
      )
    )
  )
}

function MembershipRepositoryPreviewCard(
  repository: StableMembershipPreviewResponse['repositories'][number]
) {
  return articleElement(
    {class: `membership-preview-card${repository.createsJob ? '' : ' is-no-op'}`},
    div(
      {class: 'membership-preview-title'},
      h3(repository.fullName),
      span(repository.createsJob ? 'Will queue' : 'No job needed')
    ),
    PreviewSet('Current', repository.current),
    PreviewSet('Resulting', repository.resulting),
    PreviewSet('Added', repository.added),
    PreviewSet('Removed', repository.removed),
    PreviewSet('Unchanged', repository.unchanged),
    repository.noOps.length > 0
      ? PreviewSet('No-op requests', repository.noOps)
      : null
  )
}

function PreviewSet(title: string, lists: readonly MembershipListPreviewItem[]) {
  return div(
    {class: 'membership-preview-set'},
    strongText(title),
    span(lists.length > 0 ? lists.map((list) => list.name).join(', ') : 'None')
  )
}

function UnstarConfirmation(
  state: AppState,
  targets: readonly UnstarConfirmationTarget[],
  onConfirm: () => void,
  onCancel: () => void
) {
  const ready = state.writeAuthorization.readiness === 'ready'
  return div(
    {
      class: 'dialog-backdrop',
      role: 'presentation'
    },
    section(
      {
        class: 'confirmation-dialog unstar-confirmation',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'unstar-confirmation-title',
        tabindex: -1,
        onkeydown: (event: KeyboardEvent) =>
          handleDialogKeydown(event, !enqueueingUnstars.val, onCancel)
      },
      p({class: 'eyebrow'}, 'Remote GitHub account change'),
      h2(
        {id: 'unstar-confirmation-title'},
        `Remove ${targets.length} ${targets.length === 1 ? 'star' : 'stars'} from GitHub?`
      ),
      p(
        `This will change the connected GitHub account for exactly ${targets.length} ${targets.length === 1 ? 'repository' : 'repositories'}. Local annotations are retained.`
      ),
      ul(
        {class: 'confirmation-list', 'aria-label': 'Repositories to unstar'},
        ...targets.map((target) => li(target.fullName))
      ),
      p(
        {class: 'no-undo-note'},
        'There is no Undo or re-star control. Each result is checked against GitHub before the local starred state changes.'
      ),
      ready
        ? null
        : p(
            {class: 'inline-error', role: 'alert'},
            'GitHub Starring write authorization must be ready before confirmation.'
          ),
      div(
        {class: 'action-row'},
        button(
          {
            class: 'danger-action',
            type: 'button',
            disabled: !ready || enqueueingUnstars.val,
            onclick: onConfirm
          },
          enqueueingUnstars.val ? 'Queueing...' : `Confirm unstar ${targets.length}`
        ),
        button(
          {
            class: 'secondary-action dialog-cancel',
            type: 'button',
            disabled: enqueueingUnstars.val,
            onclick: () => {
              if (!enqueueingUnstars.val) onCancel()
            }
          },
          'Cancel'
        )
      )
    )
  )
}

export function renderUnstarConfirmation(
  state: AppState,
  targets: readonly UnstarConfirmationTarget[],
  onConfirm: () => void,
  onCancel: () => void
): HTMLElement {
  const confirmation = UnstarConfirmation(state, targets, onConfirm, onCancel) as HTMLElement
  focusInitialDialogAction('.unstar-confirmation')
  return confirmation
}

function OperationsState(state: AppState) {
  const mutations = state.mutations
  const githubUserId = state.identity?.githubUserId
  const batches = (mutations?.batches ?? []).filter(
    (batch) => batch.githubUserId === githubUserId
  ).toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.batchId.localeCompare(left.batchId)
  )
  const history = (mutations?.history ?? []).filter(
    (record) => record.githubUserId === githubUserId
  ).toSorted(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) ||
      right.historyId.localeCompare(left.historyId)
  )
  return div(
    {class: 'operations-page'},
    header(
      p({class: 'eyebrow'}, 'Connected account only'),
      h1('Operations'),
      p(
        {class: 'operations-intro'},
        'Durable GitHub star changes and verified outcomes. No credential material is shown or stored with these records.'
      )
    ),
    batches.length === 0
      ? section(
          {class: 'settings-card'},
          h2('No remote operations'),
          p('Confirmed single and bulk operations will appear here.')
        )
      : section(
          {class: 'operation-section', 'aria-label': 'Mutation batches'},
          h2('Batches'),
          ...batches.map((batch) => MutationBatchCard(batch, mutations?.jobs ?? []))
        ),
    section(
      {class: 'operation-section', 'aria-label': 'Operation history'},
      h2('History'),
      history.length === 0
        ? p('No completed operation history for this account.')
        : ul(
            {class: 'operation-history-list'},
            ...history.map(OperationHistoryRow)
          )
    ),
    () =>
      pendingMembershipPreview.val
        ? MembershipConfirmation(
            pendingMembershipPreview.val,
            () => void confirmMembershipPreview(),
            () => cancelMembershipPreview(true)
          )
        : ''
  )
}

function MutationBatchCard(
  batch: MutationBatchRecord,
  jobs: readonly MutationJobRecord[]
) {
  const batchJobs = batch.jobIds.flatMap((jobId) => {
    const job = jobs.find(
      (candidate) =>
        candidate.jobId === jobId && candidate.githubUserId === batch.githubUserId
    )
    return job ? [job] : []
  })
  return articleElement(
    {class: 'batch-card'},
    div(
      {class: 'batch-heading'},
      div(
        p(
          {class: 'eyebrow'},
          `${batch.origin === 'bulk' ? 'Bulk' : 'Single'} ${batch.mutationKind === 'native-list-membership' ? 'List membership' : 'unstar'}`
        ),
        h3(`${batch.summary.total} ${batch.summary.total === 1 ? 'repository' : 'repositories'}`)
      ),
      span({class: 'batch-status'}, formatBatchStatus(batch.status))
    ),
    div(
      {class: 'batch-summary', 'aria-label': 'Batch outcome counts'},
      SummaryCount('Succeeded', batch.summary.succeeded),
      SummaryCount('Failed', batch.summary.failed),
      SummaryCount('Blocked unknown', batch.summary.blockedUnknown),
      SummaryCount('Queued', batch.summary.queued),
      SummaryCount('Cancelled', batch.summary.cancelled),
      SummaryCount('Pending', batch.summary.pending)
    ),
    ul(
      {class: 'batch-jobs'},
      ...batchJobs.map((job) =>
        li(
          div(
            strongText(`${job.ownerLogin}/${job.repositoryName}`),
            job.lastError ? span({class: 'job-error'}, job.lastError.message) : null,
            MembershipJobDetails(job)
          ),
          div(
            {class: 'job-actions'},
            MutationStatus(job),
            job.status === 'queued'
              ? button(
                  {
                    class: 'secondary-action cancel-job',
                    type: 'button',
                    onclick: () => void cancelMutationJob(job.jobId)
                  },
                  'Cancel queued job'
                )
              : null
          )
        )
      )
    ),
    batch.summary.blockedUnknown > 0
      ? p(
          {class: 'blocked-note'},
          `Blocked result for ${batch.summary.blockedUnknown} ${batch.summary.blockedUnknown === 1 ? 'repository: its' : 'repositories: their'} final GitHub ${batch.summary.blockedUnknown === 1 ? 'state is' : 'states are'} unknown. ${batch.summary.blockedUnknown === 1 ? 'This job is' : 'These jobs are'} not retried automatically. Refresh the library, review the affected ${batch.summary.blockedUnknown === 1 ? 'repository' : 'repositories'}, then decide whether to make a separate manual attempt.`
        )
      : null,
    batch.status === 'partially-completed'
      ? p(
          {class: 'partial-batch-note'},
          'Partial batch outcome: completed repositories remain complete; blocked or conflicting repositories require separate review.'
        )
      : null
  )
}

function SummaryCount(title: string, count: number) {
  return div(span(title), strongText(String(count)))
}

function MembershipJobDetails(job: MutationJobRecord) {
  const details = job.membershipDetails
  if (job.mutationKind !== 'native-list-membership' || !details) return null
  const repository = `${job.ownerLogin}/${job.repositoryName}`
  if (job.status === 'needs-confirmation') {
    return div(
      {class: 'membership-job-detail membership-recovery-detail'},
      span(
        `${repository}: GitHub List membership changed after the earlier confirmation. A fresh stable observation produced a new preview; no write occurred.`
      ),
      button(
        {
          class: 'secondary-action refresh-membership-preview',
          type: 'button',
          'data-dialog-invoker': `membership-refresh-${job.jobId}`,
          onclick: (event: MouseEvent) =>
            void refreshMembershipPreview(job.jobId, event.currentTarget as HTMLElement)
        },
        'Review refreshed preview'
      )
    )
  }
  if (job.status === 'unstable-observation' && details.unstableObservation) {
    return span(
      {class: 'membership-job-detail membership-recovery-detail'},
      `${repository}: List membership did not reach a stable observation after ${details.unstableObservation.attempts} attempts, so no membership write was verified. Refresh the library and review the current Lists before making a new request.`
    )
  }
  if (job.status === 'verification-conflict' && details.verificationConflict) {
    return span(
      {class: 'membership-job-detail membership-recovery-detail conflict-detail'},
      `${repository}: GitHub's observed Lists do not match the requested result. Desired Lists: ${formatListIds(details.verificationConflict.desired.listNodeIds)}. Observed Lists: ${formatListIds(details.verificationConflict.observed.listNodeIds)}. Refresh the library and review before making a new request.`
    )
  }
  if (job.status === 'blocked-unknown') {
    return span(
      {class: 'membership-job-detail membership-recovery-detail'},
      `${repository}: GitHub's final List membership is unknown. This job is not retried automatically. Refresh the library, review the affected repository, then decide whether to make a separate manual attempt.`
    )
  }
  if (job.status === 'succeeded') {
    return span(
      {class: 'membership-job-detail'},
      `Verified complete membership: ${formatListIds(details.desired.listNodeIds)}.`
    )
  }
  return null
}

function OperationHistoryRow(record: OperationHistoryRecord) {
  return li(
    div(
      strongText(`${record.ownerLogin}/${record.repositoryName}`),
      span(`${formatMutationStatus(record.finalStatus)} on ${formatDate(record.occurredAt)}`)
    ),
    record.error ? p(record.error.message) : null,
    record.membershipDetails?.verificationConflict
      ? p(
          `Desired Lists: ${formatListIds(record.membershipDetails.verificationConflict.desired.listNodeIds)}. Observed Lists: ${formatListIds(record.membershipDetails.verificationConflict.observed.listNodeIds)}.`
        )
      : null
  )
}

function RepositoryOperationDetails(repositoryNodeId: string) {
  const githubUserId = publishedIdentity.val?.githubUserId
  const jobs = (publishedMutations.val?.jobs ?? [])
    .filter(
      (job) =>
        job.githubUserId === githubUserId &&
        job.repositoryNodeId === repositoryNodeId
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  const history = operationHistoryForRepository(
    (publishedMutations.val?.history ?? []).filter(
      (record) => record.githubUserId === githubUserId
    ),
    repositoryNodeId
  )
  if (jobs.length === 0 && history.length === 0) return null
  return div(
    {class: 'detail-group repository-operations'},
    h4('Remote operation outcomes'),
    jobs[0] ? div({class: 'repository-job-status'}, MutationStatus(jobs[0])) : null,
    ...history.map((record) =>
      p(
        `${formatMutationStatus(record.finalStatus)} on ${formatDate(record.occurredAt)}. ${record.error?.message ?? formatVerification(record)}`
      )
    )
  )
}

function MutationStatus(job: MutationJobRecord) {
  const suspended = job.recoveryStatus === 'account-suspended'
  return span(
    {
      class: `mutation-status status-${job.status}`,
      'data-status': job.status,
      ...(suspended
        ? {title: 'The owning account is not currently active.'}
        : {})
    },
    suspended
      ? 'Account suspended'
      : job.mutationKind === 'native-list-membership' && job.status === 'succeeded'
        ? 'Verified'
        : formatMutationStatus(job.status)
  )
}

function RepositoryRow(item: LibraryRepository, selected: LibraryRepository | null) {
  const repository = item.repository
  const active = () =>
    selectedRepositoryNodeId.val === repository.repositoryNodeId ||
    (selectedRepositoryNodeId.val === null &&
      selected?.repository.repositoryNodeId === repository.repositoryNodeId)
  return li(
    {class: 'repository-row-shell'},
    repository.isStarred
      ? label(
          {class: 'selection-control'},
          input({
            type: 'checkbox',
            checked: () => selectedForUnstar.val.has(repository.repositoryNodeId),
            disabled: () => hasActiveRepositoryJob(repository.repositoryNodeId),
            'aria-label': `Select ${repository.fullName} for unstar`,
            onchange: (event: Event) =>
              toggleUnstarSelection(
                repository.repositoryNodeId,
                (event.currentTarget as HTMLInputElement).checked
              )
          }),
          span({class: 'sr-only'}, `Select ${repository.fullName}`)
        )
      : null,
    button(
      {
        class: () => active() ? 'repository-row is-selected' : 'repository-row',
        type: 'button',
        'data-repository-node-id': repository.repositoryNodeId,
        'data-dialog-invoker': `repository-${repository.repositoryNodeId}`,
        onclick: (event: MouseEvent) =>
          openRepositoryInspection(
            repository.repositoryNodeId,
            event.currentTarget as HTMLElement
          )
      },
      div(
        {class: 'repository-row-main'},
        div(
          span({class: 'repository-owner'}, repository.ownerLogin),
          h2(repository.name)
        ),
        p(repository.description ?? 'No description provided.'),
        div(
          {class: 'repository-meta'},
          repository.primaryLanguage ? span(repository.primaryLanguage) : null,
          span(`Starred ${formatDate(repository.starredAt)}`),
          item.annotation?.favorite ? span({title: 'Local favorite'}, 'Favorite') : null,
          () => {
            const latestJob = latestRepositoryJob(repository.repositoryNodeId)
            return latestJob ? MutationStatus(latestJob) : null
          }
        )
      ),
      span({class: `triage-pill triage-${item.annotation?.triageState ?? 'unclassified'}`},
        item.annotation?.triageState ?? 'unclassified'
      )
    )
  )
}

function RepositoryInspectionDialog(item: LibraryRepository) {
  return div(
    {
      class: 'dialog-backdrop',
      role: 'presentation',
      onclick: (event: MouseEvent) => {
        if (event.target === event.currentTarget) closeRepositoryInspection()
      }
    },
    RepositoryInspector(item)
  )
}

function RepositoryInspector(item: LibraryRepository) {
  const repository = item.repository
  const annotation = item.annotation
  const githubUrl = safeGitHubUrl(repository.htmlUrl)
  return section(
    {
      class: 'inspector repository-inspection-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'repository-inspection-title',
      tabindex: -1,
      onkeydown: (event: KeyboardEvent) =>
        handleDialogKeydown(event, true, closeRepositoryInspection)
    },
    div(
      {class: 'inspector-heading'},
      div(p({class: 'eyebrow'}, repository.ownerLogin), h2({id: 'repository-inspection-title'}, repository.name)),
      div(
        {class: 'inspector-actions'},
        githubUrl
          ? a({class: 'github-link', href: githubUrl, target: '_blank', rel: 'noopener noreferrer'}, 'Open GitHub')
          : null,
        button(
          {
            class: 'secondary-action dialog-cancel',
            type: 'button',
            onclick: closeRepositoryInspection
          },
          'Close details'
        )
      )
    ),
    p({class: 'inspector-description'}, repository.description ?? 'No description provided.'),
    section(
      {class: 'inspector-section', 'aria-label': 'Repository facts'},
      h3('Repository facts'),
      DetailGroup(
        'Repository',
        repository.primaryLanguage ? `Language: ${repository.primaryLanguage}` : 'Language: not reported',
        `Starred: ${formatDate(repository.starredAt)}`,
        repository.pushedAt ? `Last push: ${formatDate(repository.pushedAt)}` : 'Last push: not reported',
        repository.archived ? 'Archived' : 'Active',
        repository.disabled ? 'Disabled by GitHub' : null
      ),
      DetailGroup(
        'GitHub Lists',
        ...(item.nativeLists.length > 0
          ? item.nativeLists.map((nativeList) => nativeList.name)
          : ['No synchronized List membership'])
      ),
      DetailGroup(
        'Topics',
        ...(repository.topics.length > 0 ? repository.topics : ['No topics reported'])
      )
    ),
    section(
      {class: 'inspector-section annotation-editor', 'aria-label': 'Local organization'},
      h3('Local organization'),
      div(
        {class: 'triage-actions'},
        TriageButton('Inbox', 'inbox', item),
        TriageButton('Backlog', 'backlog', item),
        TriageButton('Reviewed', 'reviewed', item)
      ),
      label(
        span('Tags'),
        input({
          type: 'text',
          value: annotation?.tags.join(', ') ?? '',
          placeholder: 'research, browser, later',
          onchange: (event: Event) =>
            void updateAnnotation(repository.repositoryNodeId, {
              tags: (event.currentTarget as HTMLInputElement).value
                .split(',')
                .map((tag) => tag.trim())
            })
        })
      ),
      label(
        span('Private note'),
        textarea(
          {
            rows: 5,
            placeholder: 'Why did this repository matter?',
            onchange: (event: Event) =>
              void updateAnnotation(repository.repositoryNodeId, {
                note: (event.currentTarget as HTMLTextAreaElement).value
              })
          },
          annotation?.note ?? ''
        )
      ),
      label(
        span('Revisit date'),
        input({
          type: 'date',
          value: annotation?.revisitAt?.slice(0, 10) ?? '',
          onchange: (event: Event) => {
            const value = (event.currentTarget as HTMLInputElement).value
            void updateAnnotation(repository.repositoryNodeId, {
              revisitAt: value ? `${value}T09:00:00Z` : null,
              ...(value ? {triageState: 'snoozed' as const} : {})
            })
          }
        })
      ),
      button(
        {
          class: annotation?.favorite ? 'favorite-button is-active' : 'favorite-button',
          type: 'button',
          'aria-pressed': annotation?.favorite ?? false,
          onclick: () =>
            void updateAnnotation(repository.repositoryNodeId, {
              favorite: !(annotation?.favorite ?? false)
            })
        },
        annotation?.favorite ? 'Remove local favorite' : 'Add local favorite'
      )
    ),
    section(
      {class: 'inspector-section github-account-section', 'aria-label': 'GitHub account changes'},
      h3('GitHub account changes'),
      p(
        {class: 'inspector-section-intro'},
        'List membership and starring controls below change your connected GitHub account. Local organization stays in this browser.'
      ),
      repository.isStarred
        ? () => NativeListMembershipControls(currentPublishedState(), [repository], 'single')
        : null,
      repository.isStarred
        ? div(
            {class: 'github-unstar-action'},
            h4('Unstar this repository'),
            p('Remove this repository from your GitHub stars after explicit confirmation and remote verification.'),
            button(
              {
                class: 'danger-action',
                type: 'button',
                'data-dialog-invoker': `unstar-${repository.repositoryNodeId}`,
                disabled: () =>
                  publishedWriteAuthorization.val.readiness !== 'ready' ||
                  hasActiveRepositoryJob(repository.repositoryNodeId),
                onclick: (event: MouseEvent) =>
                  openUnstarConfirmation([repository], event.currentTarget as HTMLElement)
              },
              hasActiveRepositoryJob(repository.repositoryNodeId)
                ? 'Unstar already queued'
                : 'Review unstar'
            ),
            () => publishedWriteAuthorization.val.readiness !== 'ready'
              ? WriteReadinessNotice(currentPublishedState())
              : null
          )
        : null,
      RepositoryOperationDetails(repository.repositoryNodeId)
    )
  )
}

function TriageButton(
  title: string,
  triageState: 'inbox' | 'backlog' | 'reviewed',
  item: LibraryRepository
) {
  return button(
    {
      class: item.annotation?.triageState === triageState ? 'is-active' : '',
      type: 'button',
      'aria-pressed': item.annotation?.triageState === triageState,
      onclick: () =>
        void updateAnnotation(item.repository.repositoryNodeId, {triageState})
    },
    title
  )
}

function DetailGroup(title: string, ...values: Array<string | null>) {
  return div(
    {class: 'detail-group'},
    h4(title),
    ul(...values.flatMap((value) => (value ? [li(value)] : [])))
  )
}

function SettingsState(state: AppState) {
  return div(
    {class: 'settings-page'},
    header(p({class: 'eyebrow'}, 'Local account controls'), h1('Settings')),
    section(
      {class: 'settings-card'},
      h2(state.identity ? `Connected as ${state.identity.login}` : 'GitHub disconnected'),
      p(syncSummary(state)),
      p(nativeListSummary(state)),
      div(
        {class: 'action-row'},
        button(
          {
            class: 'primary-action',
            type: 'button',
            onclick: () => void exportData()
          },
          'Export local data'
        ),
        label(
          {class: 'file-action'},
          'Import JSON',
          input({
            type: 'file',
            accept: 'application/json,.json',
            onchange: (event: Event) => void importData(event)
          })
        ),
        button(
          {
            class: 'secondary-action',
            type: 'button',
            onclick: () => void confirmDisconnect()
          },
          'Disconnect GitHub'
        ),
        button(
          {
            class: 'danger-action',
            type: 'button',
            onclick: () => void confirmCompleteRemoval()
          },
          'Delete all local data'
        )
      )
    ),
    WriteAuthorizationCard(state)
  )
}

function WriteAuthorizationCard(state: AppState) {
  const write = state.writeAuthorization
  if (write.previewVisible) {
    return section(
      {class: 'settings-card write-auth-card'},
      p({class: 'eyebrow'}, 'Optional write access'),
      h2('Review GitHub write authorization'),
      p(
        'GitHub requires public_repo for Starring changes and user for UpdateUserListsForItem. public_repo grants broader public-repository write access, while user grants broader profile authority than Star List Manager uses.'
      ),
      p(
        'The extension restricts this credential to confirmed authenticated-user Starring status, star, and unstar routes plus one internally constructed UpdateUserListsForItem mutation using a repository node ID and the complete native List ID set. It does not read or change profile, email, or follow data and cannot send caller-provided GraphQL documents or other write requests.'
      ),
      p(nativeListMembershipWriteReadinessCopy(state)),
      p(
        'The separate account-scoped token stays in extension-owned browser storage and is excluded from exports, rendered pages, and logs.'
      ),
      p(
        'You can disconnect it here or revoke Star List Manager under GitHub Settings, Applications, Authorized OAuth Apps.'
      ),
      span({class: 'scope-pill'}, 'public_repo'),
      span({class: 'scope-pill'}, 'user'),
      div(
        {class: 'action-row'},
        button(
          {
            class: 'primary-action',
            type: 'button',
            onclick: () => void sendAction({type: 'start-write-device-auth'})
          },
          'Continue to GitHub'
        ),
        button(
          {
            class: 'secondary-action',
            type: 'button',
            onclick: () => void sendAction({type: 'cancel-write-device-auth'})
          },
          'Cancel'
        )
      )
    )
  }

  if (write.readiness === 'pending') {
    return section(
      {class: 'settings-card write-auth-card'},
      p({class: 'eyebrow'}, 'Optional write access'),
      h2('Approve GitHub write access'),
      p(
        'Open GitHub, enter this code, and approve the disclosed public_repo and user authorization.'
      ),
      write.authorization
        ? div({class: 'auth-code'}, write.authorization.userCode)
        : p('Requesting a GitHub device code...'),
      p(nativeListMembershipWriteReadinessCopy(state)),
      div(
        {class: 'action-row'},
        write.authorization
          ? a(
              {
                class: 'primary-action',
                href: write.authorization.verificationUri,
                target: '_blank',
                rel: 'noopener noreferrer'
              },
              'Open GitHub'
            )
          : null,
        button(
          {
            class: 'secondary-action',
            type: 'button',
            onclick: () => void sendAction({type: 'cancel-write-device-auth'})
          },
          'Cancel'
        )
      )
    )
  }

  if (write.readiness === 'ready') {
    return section(
      {class: 'settings-card write-auth-card'},
      p({class: 'eyebrow'}, 'Optional write access'),
      h2('GitHub write credential is ready'),
      p(
        write.membershipReady
          ? 'The separate account-scoped public_repo and user credential is ready for confirmed Starring routes. Native List membership writes also require the reviewed release proof and retain preview, confirmation, queue, and independent read-back safeguards.'
          : 'The stored account-scoped public_repo credential remains ready for confirmed Starring routes. Reauthorize to grant user before changing native List membership.'
      ),
      p(nativeListMembershipWriteReadinessCopy(state)),
      p(
        'Disconnecting write access preserves GitHub sign-in, synchronization, and all local library data.'
      ),
      write.error ? p({class: 'inline-error', role: 'alert'}, write.error.message) : null,
      button(
        {
          class: 'secondary-action',
          type: 'button',
          onclick: () => void confirmWriteDisconnect()
        },
        'Disconnect write access'
      )
    )
  }

  return section(
    {class: 'settings-card write-auth-card'},
    p({class: 'eyebrow'}, 'Optional write access'),
    h2('Confirmed GitHub changes'),
    p(
      'Read-only synchronization remains available without this authorization. Enable it only for confirmed Starring requests and, after separate capability proof, structured native List membership changes.'
    ),
    p(nativeListMembershipWriteReadinessCopy(state)),
    write.error ? p({class: 'inline-error', role: 'alert'}, write.error.message) : null,
    button(
      {
        class: 'secondary-action',
        type: 'button',
        onclick: () => void sendAction({type: 'show-write-auth-preview'})
      },
      write.readiness === 'authorization-required'
        ? 'Review write authorization'
        : 'Review authorization again'
    )
  )
}

function nativeListMembershipWriteReadinessCopy(state: AppState): string {
  switch (state.nativeListMembership?.readiness) {
    case 'ready':
      return 'This verified release has reviewed native List membership evidence. This account has separate write authorization; OAuth authorization alone does not prove a successful native List membership mutation.'
    case 'write-authorization-required':
      return 'This verified release still needs GitHub write authorization before it can offer native List membership writes. GitHub sign-in alone does not prove a successful native List membership mutation.'
    case 'capability-unproven':
    default:
      return 'This build does not enable verified native List membership writes. GitHub write authorization alone does not prove a successful native List membership mutation.'
  }
}

function AdvancedFilters() {
  const constraints = activeAdvancedFilterLabels()
  return details(
    {class: 'advanced-filters'},
    summary(
      'Filters',
      constraints.length > 0
        ? span({class: 'filter-count'}, String(constraints.length))
        : null
    ),
    div(
      {class: 'filter-panel'},
      FilterSelect(
        'Star state',
        starState.val,
        [
          ['starred', 'Starred'],
          ['unstarred', 'Unstarred history'],
          ['all', 'All states']
        ],
        (value) => {
          starState.val = value as StarFilter
        }
      ),
      FilterSelect(
        'Triage',
        triageState.val ?? '',
        [
          ['', 'All states'],
          ['inbox', 'Inbox'],
          ['backlog', 'Backlog'],
          ['reviewed', 'Reviewed'],
          ['snoozed', 'Snoozed']
        ],
        (value) => {
          triageState.val = value ? (value as TriageState) : null
        }
      ),
      FilterSelect(
        'Disabled',
        disabled.val,
        [
          ['all', 'Shown'],
          ['exclude', 'Hidden'],
          ['only', 'Only disabled']
        ],
        (value) => {
          disabled.val = value as InclusionFilter
        }
      ),
      DateFilter('Starred after', starredAfter),
      DateFilter('Starred before', starredBefore),
      DateFilter('Pushed after', pushedAfter),
      DateFilter('Pushed before', pushedBefore),
      button(
        {class: 'clear-filters', type: 'button', onclick: clearAdvancedFilters},
        'Clear filters'
      )
    ),
    constraints.length > 0
      ? div(
          {class: 'active-filters', 'aria-label': 'Active filters'},
          ...constraints.map((constraint) => span(constraint))
        )
      : null
  )
}

function FilterSelect(
  title: string,
  value: string,
  choices: readonly (readonly [string, string])[],
  onChange: (value: string) => void
) {
  return label(
    span(title),
    select(
      {
        value,
        onchange: (event: Event) =>
          onChange((event.currentTarget as HTMLSelectElement).value)
      },
      ...choices.map(([choiceValue, choiceTitle]) =>
        option({value: choiceValue}, choiceTitle)
      )
    )
  )
}

function DateFilter(title: string, state: {val: string | null}) {
  return label(
    span(title),
    input({
      type: 'date',
      value: state.val ?? '',
      onchange: (event: Event) => {
        state.val = (event.currentTarget as HTMLInputElement).value || null
      }
    })
  )
}

function StatusBanners(state: AppState) {
  return div(
    {class: 'status-stack', 'aria-live': 'polite'},
    state.sync?.phase === 'stale'
      ? p({class: 'status-banner is-warning'}, 'Star data is stale; the last complete library remains available.')
      : null,
    state.nativeListSync?.phase === 'partial'
      ? p({class: 'status-banner is-warning'}, 'Native List coverage is partial because inaccessible items are not disclosed.')
      : null,
    state.error || state.sync?.lastError
      ? p(
          {class: 'status-banner is-error'},
          state.error?.message ?? state.sync?.lastError?.message ?? 'A recoverable error occurred.'
        )
      : null
  )
}

function NoResultsState(searching: boolean) {
  return div(
    {class: 'empty-results'},
    h2(searching ? 'No local matches' : 'This view is clear'),
    p(
      searching
        ? 'Try fewer words or clear a filter. Your library has not been changed.'
        : 'No starred repository currently belongs to this view.'
    )
  )
}

function EmptyLibraryState() {
  return section(
    {class: 'state-panel'},
    p({class: 'eyebrow'}, 'Empty library'),
    h2('No public stars found'),
    p('Star a public repository on GitHub, then refresh this dashboard.')
  )
}


function LoadingState(copy: string) {
  return section(
    {class: 'state-panel', 'aria-busy': 'true'},
    p({class: 'eyebrow'}, 'Opening library'),
    h2('Preparing your dashboard'),
    p(copy),
    div({class: 'skeleton-list', 'aria-hidden': 'true'}, div({class: 'skeleton-row'}), div({class: 'skeleton-row'}))
  )
}

function FirstRunState(returningUser: boolean, error: string | null) {
  return section(
    {class: 'state-panel'},
    p({class: 'eyebrow'}, returningUser ? 'Signed out' : 'First run'),
    h2(returningUser ? 'Reconnect your GitHub library' : 'Turn stars into a working library'),
    p('Connect GitHub to import public stars and native Lists. Notes, tags, favorites, and revisit dates remain local.'),
    error ? p({class: 'inline-error', role: 'alert'}, error) : null,
    button(
      {class: 'primary-action', type: 'button', onclick: () => void sendAction({type: 'start-device-auth'})},
      'Connect GitHub',
      span('Device flow')
    )
  )
}

function AuthorizationPendingState(state: AppState) {
  const authorization = state.authorization
  if (!authorization) return LoadingState('Waiting for GitHub authorization details.')
  return section(
    {class: 'state-panel'},
    p({class: 'eyebrow'}, 'GitHub authorization'),
    h2('Approve this device'),
    p('Open GitHub, enter the code below, and approve read-only access.'),
    div({class: 'auth-code'}, authorization.userCode),
    div(
      {class: 'action-row'},
      a({class: 'primary-action', href: authorization.verificationUri, target: '_blank', rel: 'noopener noreferrer'}, 'Open GitHub'),
      button({class: 'secondary-action', type: 'button', onclick: () => void sendAction({type: 'cancel-device-auth'})}, 'Cancel')
    )
  )
}

function AuthorizationResultState(title: string, copy: string) {
  return section(
    {class: 'state-panel'},
    p({class: 'eyebrow'}, 'Sign-in incomplete'),
    h2(title),
    p(copy),
    button({class: 'primary-action', type: 'button', onclick: () => void sendAction({type: 'start-device-auth'})}, 'Try again')
  )
}

function currentQuery(): RepositoryQuery {
  const filters = defaultRepositoryFilters()
  return {
    view: activeView.val,
    search: searchText.val,
    filters: {
      ...filters,
      triageStates: triageState.val ? [triageState.val] : [],
      starState: starState.val,
      language: language.val,
      archived: hideArchived.val ? 'exclude' : 'all',
      disabled: disabled.val,
      starredAfter: toStartOfDay(starredAfter.val),
      starredBefore: toEndOfDay(starredBefore.val),
      pushedAfter: toStartOfDay(pushedAfter.val),
      pushedBefore: toEndOfDay(pushedBefore.val)
    },
    sort: sort.val,
    ascending: ascending.val
  }
}

function selectCurrentRepository(
  results: readonly LibraryRepository[]
): LibraryRepository | null {
  const selected = results.find(
    (item) => item.repository.repositoryNodeId === selectedRepositoryNodeId.val
  )
  if (selected) return selected
  return results[0] ?? null
}

function handleResultKey(
  event: KeyboardEvent,
  results: readonly LibraryRepository[]
): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const row = event.target as HTMLElement | null
  const repositoryNodeId = row?.closest<HTMLButtonElement>('.repository-row')?.dataset.repositoryNodeId
  if (!repositoryNodeId) return
  event.preventDefault()
  const currentIndex = results.findIndex(
    (item) => item.repository.repositoryNodeId === repositoryNodeId
  )
  const index = nextSelectionIndex(
    currentIndex,
    results.length,
    event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'
  )
  const nextRepositoryNodeId = results[index]?.repository.repositoryNodeId ?? null
  if (!nextRepositoryNodeId) return
  selectedRepositoryNodeId.val = nextRepositoryNodeId
  window.setTimeout(() => {
    [...document.querySelectorAll<HTMLButtonElement>('.repository-list .repository-row')]
      .find((button) => button.dataset.repositoryNodeId === nextRepositoryNodeId)
      ?.focus()
  }, 0)
}

function handleDialogKeydown(
  event: KeyboardEvent,
  cancellable: boolean,
  onCancel: () => void
): void {
  if (event.key === 'Escape') {
    if (!cancellable) return
    event.preventDefault()
    onCancel()
    return
  }
  if (event.key !== 'Tab') return

  const dialog = event.currentTarget as HTMLElement
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((control) => control.getAttribute('aria-hidden') !== 'true')
  if (controls.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }

  const first = controls[0]
  const last = controls.at(-1)
  const active = document.activeElement
  if (
    (event.shiftKey && (active === dialog || active === first)) ||
    (!event.shiftKey && active === last)
  ) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target?.focus()
  }
}

function focusInitialDialogAction(dialogSelector: string): void {
  window.setTimeout(() => {
    const dialog = document.querySelector<HTMLElement>(dialogSelector)
    const cancel = dialog?.querySelector<HTMLElement>('.dialog-cancel:not(:disabled)')
    if (cancel) cancel.focus()
    else dialog?.focus()
  }, 0)
}

function captureDialogInvoker(element: HTMLElement): DialogInvoker {
  return {element, id: element.dataset.dialogInvoker ?? null}
}

function openRepositoryInspection(repositoryNodeId: string, invoker: HTMLElement): void {
  selectedRepositoryNodeId.val = repositoryNodeId
  inspectedRepositoryNodeId.val = repositoryNodeId
  repositoryDialogInvoker = captureDialogInvoker(invoker)
  focusInitialDialogAction('.repository-inspection-dialog')
}

function closeRepositoryInspection(): void {
  restoreDialogInvoker(dismissRepositoryInspection())
}

function dismissStaleRepositoryInspection(): void {
  const invoker = repositoryDialogInvoker
  const ownerDocument = invoker?.element.ownerDocument ?? document
  const MutationObserverConstructor = ownerDocument.defaultView?.MutationObserver
  const fallbackSelector = '.repository-list .repository-row:not(:disabled)'

  if (invoker?.element.isConnected && MutationObserverConstructor && ownerDocument.body) {
    const observer = new MutationObserverConstructor(() => {
      if (invoker.element.isConnected) return
      observer.disconnect()
      focusDialogInvoker(invoker, fallbackSelector, true)
    })
    observer.observe(ownerDocument.body, {childList: true, subtree: true})
    dismissRepositoryInspection()
    return
  }

  restoreDialogInvoker(dismissRepositoryInspection(), fallbackSelector, true)
}

function dismissRepositoryInspection(): DialogInvoker | null {
  const invoker = repositoryDialogInvoker
  inspectedRepositoryNodeId.val = null
  repositoryDialogInvoker = null
  return invoker
}

function beginMembershipPreviewRequest(invoker: HTMLElement): number | null {
  if (
    activeMembershipPreviewRequestToken !== null ||
    pendingMembershipPreview.val !== null ||
    confirmingMembership.val
  ) {
    return null
  }
  const requestToken = ++nextMembershipPreviewRequestToken
  activeMembershipPreviewRequestToken = requestToken
  membershipDialogInvoker = captureDialogInvoker(invoker)
  return requestToken
}

function focusDialogInvoker(
  invoker: DialogInvoker | null,
  fallbackSelector?: string,
  preferFallback = false
): void {
  const ownerDocument = invoker?.element.ownerDocument ?? document
  const current = invoker
    ? invoker.element.isConnected
      ? invoker.element
      : [...ownerDocument.querySelectorAll<HTMLElement>('[data-dialog-invoker]')].find(
          (element) => element.dataset.dialogInvoker === invoker.id
        )
    : null
  const fallback = fallbackSelector
    ? ownerDocument.querySelector<HTMLElement>(fallbackSelector)
    : null
  const target = preferFallback
    ? fallback
    : current && !current.matches(':disabled')
      ? current
      : fallback
  if (target && !target.matches(':disabled')) target.focus()
}

function restoreDialogInvoker(
  invoker: DialogInvoker | null,
  fallbackSelector?: string,
  preferFallback = false
): void {
  const ownerDocument = invoker?.element.ownerDocument ?? document
  const ownerWindow = ownerDocument.defaultView ?? window
  ownerWindow.setTimeout(() => focusDialogInvoker(invoker, fallbackSelector, preferFallback), 0)
}

async function updateAnnotation(
  repositoryNodeId: string,
  patch: AnnotationPatch
): Promise<void> {
  await sendAction({type: 'update-annotation', repositoryNodeId, patch})
  selectedRepositoryNodeId.val = repositoryNodeId
}

function toggleNativeListSelection(listNodeId: string, selected: boolean): void {
  const next = new Set(selectedNativeListIds.val)
  if (selected) next.add(listNodeId)
  else next.delete(listNodeId)
  selectedNativeListIds.val = next
  membershipActivity.val = null
}

function selectedMembershipOperation(): MembershipOperationSelection {
  if (membershipOperation.val === 'add') {
    return {kind: 'add', listNodeIds: [...selectedNativeListIds.val]}
  }
  if (membershipOperation.val === 'remove') {
    return {kind: 'remove', listNodeIds: [...selectedNativeListIds.val]}
  }
  return {
    kind: 'move',
    sourceListNodeId: moveSourceListNodeId.val,
    destinationListNodeId: moveDestinationListNodeId.val
  }
}

async function requestMembershipPreview(
  repositoryNodeIds: readonly string[],
  operation: MembershipOperationSelection,
  invoker: HTMLElement
): Promise<void> {
  const requestToken = beginMembershipPreviewRequest(invoker)
  if (requestToken === null) return
  membershipActivity.val =
    'Observing every current native List twice to establish a stable, complete preview...'
  try {
    const response = (await sendRuntimeMessage({
      type: 'preview-native-list-membership',
      repositoryNodeIds,
      operation
    })) as RuntimeResponse<MembershipPreviewResponse>
    if (activeMembershipPreviewRequestToken !== requestToken) return
    activeMembershipPreviewRequestToken = null
    handleMembershipPreviewResponse(response)
  } finally {
    if (activeMembershipPreviewRequestToken === requestToken) {
      activeMembershipPreviewRequestToken = null
    }
  }
}

async function refreshMembershipPreview(jobId: string, invoker: HTMLElement): Promise<void> {
  const requestToken = beginMembershipPreviewRequest(invoker)
  if (requestToken === null) return
  membershipActivity.val =
    'Refreshing the original intent against two complete GitHub observations...'
  try {
    const response = (await sendRuntimeMessage({
      type: 'refresh-native-list-membership-preview',
      jobId
    })) as RuntimeResponse<MembershipPreviewResponse>
    if (activeMembershipPreviewRequestToken !== requestToken) return
    activeMembershipPreviewRequestToken = null
    handleMembershipPreviewResponse(response)
  } finally {
    if (activeMembershipPreviewRequestToken === requestToken) {
      activeMembershipPreviewRequestToken = null
    }
  }
}

function handleMembershipPreviewResponse(
  response: RuntimeResponse<MembershipPreviewResponse>
): void {
  if (!response.ok) {
    membershipActivity.val = response.error.message
    membershipDialogInvoker = null
    applyState({...appState.val, error: response.error})
    return
  }
  if (response.data.status !== 'stable') {
    membershipActivity.val = `Safety block: ${response.data.message}`
    membershipDialogInvoker = null
    return
  }
  membershipActivity.val = `Stable preview captured after ${response.data.attempts} attempts. Confirmation is required.`
  const repositoryInvoker = dismissRepositoryInspection()
  if (repositoryInvoker) membershipDialogInvoker = repositoryInvoker
  pendingMembershipPreview.val = response.data
  focusInitialDialogAction('.membership-confirmation')
}

async function confirmMembershipPreview(): Promise<void> {
  const preview = pendingMembershipPreview.val
  if (!preview || preview.repositories.every((repository) => !repository.createsJob)) {
    return
  }
  confirmingMembership.val = true
  try {
    const response = (await sendRuntimeMessage({
      type: 'confirm-native-list-membership-preview',
      previewId: preview.previewId
    })) as RuntimeResponse<AppState>
    if (!response.ok) {
      membershipActivity.val = response.error.message
      applyState({...appState.val, error: response.error})
      return
    }
    resetMembershipPreview()
    selectedNativeListIds.val = new Set()
    membershipActivity.val = 'Membership work queued for observation and remote verification.'
    applyState(response.data)
  } finally {
    confirmingMembership.val = false
  }
}

function cancelMembershipPreview(restoreFocus = false): void {
  if (confirmingMembership.val) return
  const invoker = membershipDialogInvoker
  resetMembershipPreview()
  if (restoreFocus) restoreDialogInvoker(invoker)
}

function resetMembershipPreview(): void {
  activeMembershipPreviewRequestToken = null
  pendingMembershipPreview.val = null
  membershipDialogInvoker = null
}

function membershipReadinessMessage(state: AppState): string {
  if (state.nativeListMembership?.readiness === 'capability-unproven') {
    return 'Read-only: this build has not recorded a successful disposable no-op membership mutation with independent read-back.'
  }
  return 'Native List membership changes require account-matched GitHub write authorization.'
}

function formatListIds(listNodeIds: readonly string[]): string {
  if (listNodeIds.length === 0) return 'None'
  const lists = new Map(
    (publishedLibrary.val?.nativeLists ?? []).map((list) => [list.listNodeId, list.name])
  )
  return listNodeIds.map((listNodeId) => lists.get(listNodeId) ?? listNodeId).join(', ')
}

function toggleUnstarSelection(repositoryNodeId: string, selected: boolean): void {
  const next = new Set(selectedForUnstar.val)
  if (selected) next.add(repositoryNodeId)
  else next.delete(repositoryNodeId)
  selectedForUnstar.val = next
}

function openUnstarConfirmation(
  repositories: readonly RepositoryRecord[],
  invoker: HTMLElement
): void {
  if (pendingUnstarTargets.val.length > 0 || enqueueingUnstars.val) return
  const repositoryInvoker = dismissRepositoryInspection()
  unstarDialogInvoker = repositoryInvoker ?? captureDialogInvoker(invoker)
  pendingUnstarTargets.val = repositories.map((repository) => ({
    repositoryNodeId: repository.repositoryNodeId,
    fullName: repository.fullName
  }))
  focusInitialDialogAction('.unstar-confirmation')
}

function cancelUnstarConfirmation(restoreFocus = false): void {
  if (enqueueingUnstars.val) return
  const invoker = unstarDialogInvoker
  resetUnstarConfirmation()
  if (restoreFocus) restoreDialogInvoker(invoker)
}

function resetUnstarConfirmation(): void {
  pendingUnstarTargets.val = []
  unstarDialogInvoker = null
}

async function confirmPendingUnstars(): Promise<void> {
  const repositoryNodeIds = pendingUnstarTargets.val.map(
    (target) => target.repositoryNodeId
  )
  if (
    repositoryNodeIds.length === 0 ||
    appState.val.writeAuthorization.readiness !== 'ready'
  ) {
    return
  }
  enqueueingUnstars.val = true
  try {
    const queued = await sendAction({
      type: 'enqueue-confirmed-unstars',
      repositoryNodeIds
    })
    if (queued) {
      resetUnstarConfirmation()
      selectedForUnstar.val = new Set()
    }
  } finally {
    enqueueingUnstars.val = false
  }
}

async function cancelMutationJob(jobId: string): Promise<void> {
  await sendAction({type: 'cancel-mutation-job', jobId})
}

function WriteReadinessNotice(state: AppState) {
  return div(
    {class: 'write-readiness-notice'},
    span(writeReadinessMessage(state.writeAuthorization.readiness)),
    button(
      {
        class: 'secondary-action',
        type: 'button',
        onclick: () => {
          setActiveView({kind: 'settings'})
          void sendAction({type: 'show-write-auth-preview'})
        }
      },
      'Review write authorization'
    )
  )
}

function latestRepositoryJob(repositoryNodeId: string): MutationJobRecord | null {
  return latestJobsByRepository.val.get(repositoryNodeId) ?? null
}

function hasActiveRepositoryJob(repositoryNodeId: string): boolean {
  const job = latestRepositoryJob(repositoryNodeId)
  return job !== null && isNonterminalMutationStatus(job.status)
}

async function loadAppState(): Promise<void> {
  await sendAction({type: 'get-app-state'})
}

async function sendAction(message: RuntimeMessage): Promise<boolean> {
  const authenticationAction = isAuthenticationAction(message.type)
  if (authenticationAction) applyState(emptyState)
  if (message.type === 'start-sync') syncing.val = true
  try {
    const response = (await sendRuntimeMessage(message)) as RuntimeResponse<AppState>
    applyState(
      response.ok
        ? response.data
        : {...appState.val, phase: fallbackPhase(appState.val), error: response.error}
    )
    return response.ok
  } finally {
    if (message.type === 'start-sync') syncing.val = false
  }
}

function applyState(state: AppState): void {
  const nextAccountId = state.identity?.githubUserId ?? null
  const nextFingerprints = dashboardSliceFingerprints(state)
  const phaseChanged = nextFingerprints.phase !== publishedFingerprints.phase
  const libraryChanged = nextFingerprints.library !== publishedFingerprints.library
  const position = libraryChanged ? captureDashboardPosition() : null
  if (dashboardAccountId !== nextAccountId) {
    selectedForUnstar.val = new Set()
    resetUnstarConfirmation()
    selectedRepositoryNodeId.val = null
    inspectedRepositoryNodeId.val = null
    repositoryDialogInvoker = null
    selectedNativeListIds.val = new Set()
    membershipActivity.val = null
    resetMembershipPreview()
    resetNativeListRenameEditor()
    dashboardAccountId = nextAccountId
  }
  reconcileActiveNativeList(state)
  appState.val = state
  publishStateSlices(state, nextFingerprints)
  if (phaseChanged) refreshWorkspacePhase(state.phase)
  if (position) restoreDashboardPosition(position)
  if (state.library) {
    const selectable = new Set(
      state.library.repositories
        .filter(
          (repository) =>
            repository.isStarred &&
            !hasActiveRepositoryJob(repository.repositoryNodeId)
        )
        .map((repository) => repository.repositoryNodeId)
    )
    const retained = new Set(
      [...selectedForUnstar.val].filter((repositoryNodeId) =>
        selectable.has(repositoryNodeId)
      )
    )
    if (retained.size !== selectedForUnstar.val.size) {
      selectedForUnstar.val = retained
    }
  }
  if (!state.identity) autoSyncAccountId = null
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer =
    state.phase === 'authorization-pending' ||
    state.writeAuthorization.readiness === 'pending' ||
    hasNonterminalMutationJobs(state)
      ? window.setTimeout(() => void loadAppState(), 1000)
      : null
  if (shouldStartAutoSync(state, autoSyncAccountId)) {
    autoSyncAccountId = state.identity?.githubUserId ?? null
    window.setTimeout(() => void sendAction({type: 'start-sync', force: false}), 0)
  }
}

function refreshWorkspacePhase(phase: AppPhase): void {
  for (const workspace of document.querySelectorAll<HTMLElement>('.workspace')) {
    if (phase !== 'ready') {
      workspace.replaceChildren(renderState(currentPublishedState()))
      continue
    }
    if (activeView.val.kind === 'operations') {
      workspace.replaceChildren(PersistentStatePage('operations-page', OperationsState))
    } else if (activeView.val.kind === 'settings') {
      workspace.replaceChildren(PersistentStatePage('settings-page', SettingsState))
    } else {
      workspace.replaceChildren(ReadyLibraryState())
    }
  }
}

function publishStateSlices(
  state: AppState,
  next: DashboardSliceFingerprints
): void {
  if (publishedPhase.val !== state.phase) publishedPhase.val = state.phase
  publishIfMateriallyChanged(
    publishedIdentity,
    publishedFingerprints.identity,
    next.identity,
    state.identity
  )
  publishIfMateriallyChanged(
    publishedAuthorization,
    publishedFingerprints.authorization,
    next.authorization,
    state.authorization
  )
  publishIfMateriallyChanged(
    publishedWriteAuthorization,
    publishedFingerprints.writeAuthorization,
    next.writeAuthorization,
    state.writeAuthorization
  )
  publishIfMateriallyChanged(
    publishedSync,
    publishedFingerprints.sync,
    next.sync,
    state.sync
  )
  publishIfMateriallyChanged(
    publishedNativeListSync,
    publishedFingerprints.nativeListSync,
    next.nativeListSync,
    state.nativeListSync
  )
  publishIfMateriallyChanged(
    publishedNativeListMembership,
    publishedFingerprints.nativeListMembership,
    next.nativeListMembership,
    state.nativeListMembership
  )
  publishIfMateriallyChanged(
    publishedNativeListRename,
    publishedFingerprints.nativeListRename,
    next.nativeListRename,
    state.nativeListRename
  )
  publishIfMateriallyChanged(
    publishedTriageCounts,
    publishedFingerprints.triageCounts,
    next.triageCounts,
    state.triageCounts
  )
  publishIfMateriallyChanged(
    publishedLibrary,
    publishedFingerprints.library,
    next.library,
    state.library
  )
  publishIfMateriallyChanged(
    publishedMutations,
    publishedFingerprints.mutations,
    next.mutations,
    state.mutations
  )
  publishIfMateriallyChanged(
    publishedError,
    publishedFingerprints.error,
    next.error,
    state.error
  )
  publishedFingerprints = next

  const nextJobsInputKey = `${state.identity?.githubUserId ?? ''}:${next.mutations}`
  if (nextJobsInputKey !== latestJobsInputKey) {
    latestJobsInputKey = nextJobsInputKey
    latestJobsByRepository.val = indexLatestRepositoryJobs(
      state.mutations?.jobs ?? [],
      state.identity?.githubUserId ?? null
    )
  }
}

function publishIfMateriallyChanged<T>(
  signal: {val: T},
  previousFingerprint: string,
  nextFingerprint: string,
  value: T
): string {
  if (previousFingerprint !== nextFingerprint) signal.val = value
  return nextFingerprint
}

interface DashboardPosition {
  readonly scrollTop: number
  readonly repositoryNodeId: string | null
  readonly search: {readonly start: number | null; readonly end: number | null} | null
}

function captureDashboardPosition(): DashboardPosition | null {
  const list = document.querySelector<HTMLElement>('.repository-list')
  const active = document.activeElement as HTMLElement | null
  const focusedRow = active?.closest<HTMLElement>('.repository-row') ?? null
  const searchInput = active?.id === 'library-search' ? active as HTMLInputElement : null
  if (!list && !focusedRow && !searchInput) return null
  return {
    scrollTop: list?.scrollTop ?? 0,
    repositoryNodeId: focusedRow?.dataset.repositoryNodeId ?? null,
    search: searchInput
      ? {start: searchInput.selectionStart, end: searchInput.selectionEnd}
      : null
  }
}

function restoreDashboardPosition(position: DashboardPosition): void {
  window.setTimeout(() => window.setTimeout(() => {
    const list = document.querySelector<HTMLElement>('.repository-list')
    if (list) list.scrollTop = position.scrollTop
    if (position.repositoryNodeId) {
      [...document.querySelectorAll<HTMLElement>('.repository-row')]
        .find((row) => row.dataset.repositoryNodeId === position.repositoryNodeId)
        ?.focus()
      return
    }
    if (position.search) {
      const searchInput = document.getElementById('library-search') as HTMLInputElement | null
      searchInput?.focus()
      searchInput?.setSelectionRange(position.search.start, position.search.end)
    }
  }, 0), 0)
}

function reconcileActiveNativeList(state: AppState): void {
  const view = activeView.val
  if (
    !state.library ||
    view.kind !== 'list' ||
    state.library.nativeLists.some((list) => list.listNodeId === view.listNodeId)
  ) {
    return
  }
  setActiveView({kind: 'unlist'})
  resetNativeListRenameEditor()
}

export function shouldStartAutoSync(
  state: AppState,
  startedAccountId: string | null
): boolean {
  return (
    state.phase === 'ready' &&
    state.identity !== null &&
    shouldAutoSync(state) &&
    startedAccountId !== state.identity.githubUserId
  )
}

async function confirmDisconnect(): Promise<void> {
  if (window.confirm('Disconnect GitHub? Local annotations will be retained.')) {
    await sendAction({type: 'disconnect'})
    setActiveView({kind: 'unlist'})
  }
}

async function confirmWriteDisconnect(): Promise<void> {
  if (
    window.confirm(
      'Disconnect GitHub write access? Read-only synchronization and local data will remain available.'
    )
  ) {
    await sendAction({type: 'disconnect-write-auth'})
  }
}

async function exportData(): Promise<void> {
  const response = (await sendRuntimeMessage({
    type: 'export-data'
  })) as RuntimeResponse<ExportPayload>
  if (!response.ok) {
    applyState({...appState.val, error: response.error})
    return
  }
  const url = URL.createObjectURL(
    new Blob([response.data.content], {type: 'application/json'})
  )
  const download = document.createElement('a')
  download.href = url
  download.download = response.data.filename
  download.click()
  URL.revokeObjectURL(url)
}

async function importData(event: Event): Promise<void> {
  const fileInput = event.currentTarget as HTMLInputElement
  const file = fileInput.files?.[0]
  if (!file) return
  try {
    const documentValue = JSON.parse(await file.text()) as unknown
    const replaceSettings = window.confirm(
      'Include settings replacement in the import preview? Library data is always merged non-destructively.'
    )
    const preview = (await sendRuntimeMessage({
      type: 'preview-import',
      document: documentValue,
      replaceSettings
    })) as RuntimeResponse<ImportImpact>
    if (!preview.ok) {
      applyState({...appState.val, error: preview.error})
      return
    }
    if (!window.confirm(`Apply this import? ${formatImpact(preview.data)}`)) return
    const applied = (await sendRuntimeMessage({
      type: 'apply-import',
      document: documentValue,
      replaceSettings
    })) as RuntimeResponse<ImportImpact>
    if (!applied.ok) {
      applyState({...appState.val, error: applied.error})
      return
    }
    window.alert(`Import complete. ${formatImpact(applied.data)}`)
    await loadAppState()
  } catch {
    applyState({
      ...appState.val,
      error: {
        category: 'validation',
        message: 'The selected file is not valid JSON.',
        retryable: false
      }
    })
  } finally {
    fileInput.value = ''
  }
}

async function confirmCompleteRemoval(): Promise<void> {
  if (
    !window.confirm(
      'Delete all Star List Manager data from this browser profile, including credentials, notes, tags, settings, and synchronized metadata? This cannot be undone.'
    )
  ) {
    return
  }
  const response = (await sendRuntimeMessage({
    type: 'clear-all-data'
  })) as RuntimeResponse<AppState>
  if (response.ok) {
    setActiveView({kind: 'unlist'})
    applyState(response.data)
  } else {
    applyState({...appState.val, error: response.error})
  }
}

function setActiveView(view: LibraryView): void {
  if (JSON.stringify(activeView.val) !== JSON.stringify(view)) resetNativeListRenameEditor()
  activeView.val = view
  refreshActiveViewDom(view)
}

function refreshActiveViewDom(view: LibraryView): void {
  const viewKey = JSON.stringify(view)
  for (const item of document.querySelectorAll<HTMLElement>('.nav-item')) {
    const active = item.dataset.viewKey === viewKey
    item.classList.toggle('is-active', active)
    if (active) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
  const context = document.querySelector<HTMLElement>('.library-view-context')
  context?.replaceWith(LibraryViewContext())
}

function isActiveView(view: LibraryView): boolean {
  return JSON.stringify(view) === JSON.stringify(activeView.val)
}

function isAuthenticationAction(type: RuntimeMessage['type']): boolean {
  return type === 'start-device-auth' || type === 'cancel-device-auth' || type === 'disconnect'
}

function fallbackPhase(state: AppState): AppPhase {
  return state.identity ? 'ready' : 'signed-out'
}

function shouldAutoSync(state: AppState): boolean {
  return syncNeedsRefresh(state.sync) || syncNeedsRefresh(state.nativeListSync)
}

function syncNeedsRefresh(sync: AppState['sync']): boolean {
  if (!sync) return true
  if (sync.phase === 'running' || sync.phase === 'unavailable') return false
  if (!sync.lastSuccessfulAt) return true
  return Date.now() - Date.parse(sync.lastSuccessfulAt) >= 60 * 60 * 1000
}

function syncSummary(state: AppState): string {
  if (state.sync?.phase === 'complete' && state.sync.lastSuccessfulAt) {
    return `Public stars last synchronized ${formatDate(state.sync.lastSuccessfulAt)}.`
  }
  if (state.sync?.phase === 'stale') return 'The previous star library is available but stale.'
  return 'Public-star synchronization has not completed.'
}

function nativeListSummary(state: AppState): string {
  if (state.nativeListSync?.phase === 'complete') return 'Native GitHub Lists are synchronized read-only.'
  if (state.nativeListSync?.phase === 'partial') return 'Native List coverage is partial.'
  if (state.nativeListSync?.phase === 'unavailable') return 'Native GitHub Lists are unavailable.'
  return 'Native List synchronization has not completed.'
}

function populationTitle(value: StarFilter): string {
  return {
    starred: 'Starred repositories',
    unstarred: 'Unstarred history',
    all: 'All repositories'
  }[value]
}

function hasNonterminalMutationJobs(state: AppState): boolean {
  return (state.mutations?.jobs ?? []).some((job) =>
    isNonterminalMutationStatus(job.status)
  )
}

function isNonterminalMutationStatus(status: MutationJobStatus): boolean {
  return (
    status === 'queued' ||
    status === 'checking' ||
    status === 'deleting' ||
    status === 'verifying' ||
    status === 'observing-membership' ||
    status === 'mutating-membership' ||
    status === 'verifying-membership' ||
    status === 'retry-waiting'
  )
}

function formatMutationStatus(status: MutationJobStatus): string {
  return {
    queued: 'Queued',
    checking: 'Checking',
    deleting: 'Deleting',
    verifying: 'Verifying',
    'observing-membership': 'Observing membership',
    'mutating-membership': 'Changing membership',
    'verifying-membership': 'Verifying membership',
    succeeded: 'Succeeded',
    'succeeded-external': 'Succeeded externally',
    failed: 'Failed',
    'blocked-unknown': 'Blocked unknown',
    'needs-confirmation': 'Needs confirmation',
    'unstable-observation': 'Unstable observation',
    'verification-conflict': 'Verification conflict',
    'retry-waiting': 'Retry waiting',
    cancelled: 'Cancelled'
  }[status]
}

function formatBatchStatus(status: MutationBatchRecord['status']): string {
  return status.replaceAll('-', ' ')
}

function formatVerification(record: OperationHistoryRecord): string {
  if (record.verificationResult === 'verified-absent') {
    return 'GitHub absence was verified.'
  }
  if (record.verificationResult === 'already-absent') {
    return 'The star was already absent on GitHub.'
  }
  if (record.verificationResult === 'verified-membership') {
    return 'GitHub native List membership was verified.'
  }
  if (record.verificationResult === 'membership-conflict') {
    return 'GitHub native List membership differed from the desired set.'
  }
  if (record.verificationResult === 'cancelled-before-execution') {
    return 'Cancelled before remote execution.'
  }
  return 'GitHub absence was not verified.'
}

function writeReadinessMessage(
  readiness: AppState['writeAuthorization']['readiness']
): string {
  if (readiness === 'pending') return 'GitHub write authorization is pending.'
  if (readiness === 'account-mismatch') {
    return 'Write authorization belongs to a different GitHub account.'
  }
  if (readiness === 'scope-denied') {
    return 'GitHub public_repo and user permissions were not both granted.'
  }
  if (readiness === 'credential-rejected') {
    return 'GitHub rejected the write credential.'
  }
  return 'GitHub write authorization is required.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(new Date(value))
}

function formatImpact(impact: ImportImpact): string {
  return [
    `${impact.added} added`,
    `${impact.updated} updated`,
    `${impact.unchanged} unchanged`,
    `${impact.skippedConflict} skipped conflicts`,
    `${impact.metadataFilled} metadata records filled`,
    `${impact.settingsSelected} settings record selected`
  ].join(', ')
}

function activeAdvancedFilterLabels(): readonly string[] {
  return [
    starState.val !== 'starred' ? `Star state: ${starState.val}` : null,
    disabled.val !== 'all' ? `Disabled: ${disabled.val}` : null,
    triageState.val ? `Triage: ${triageState.val}` : null,
    starredAfter.val ? `Starred after ${starredAfter.val}` : null,
    starredBefore.val ? `Starred before ${starredBefore.val}` : null,
    pushedAfter.val ? `Pushed after ${pushedAfter.val}` : null,
    pushedBefore.val ? `Pushed before ${pushedBefore.val}` : null
  ].flatMap((value) => (value ? [value] : []))
}

function clearAdvancedFilters(): void {
  starState.val = 'starred'
  disabled.val = 'all'
  triageState.val = null
  starredAfter.val = null
  starredBefore.val = null
  pushedAfter.val = null
  pushedBefore.val = null
}

function toStartOfDay(value: string | null): string | null {
  return value ? `${value}T00:00:00Z` : null
}

function toEndOfDay(value: string | null): string | null {
  return value ? `${value}T23:59:59Z` : null
}

export function mountDashboard(root: HTMLElement): void {
  van.add(root, Dashboard())
}

export function renderSettingsState(state: AppState): HTMLElement {
  return SettingsState(state) as HTMLElement
}

export function renderLibraryState(
  state: AppState,
  runQuery: RepositoryQueryRunner = queryRepositories
): HTMLElement {
  resetNativeListRenameEditor()
  setStateImmediately(activeView, {kind: 'unlist'})
  setStateImmediately(selectedRepositoryNodeId, null)
  setStateImmediately(inspectedRepositoryNodeId, null)
  repositoryDialogInvoker = null
  setStateImmediately(selectedForUnstar, new Set())
  resetUnstarConfirmation()
  setStateImmediately(selectedNativeListIds, new Set())
  setStateImmediately(membershipActivity, null)
  resetMembershipPreview()
  setStateImmediately(appState, state)
  dashboardAccountId = state.identity?.githubUserId ?? null
  autoSyncAccountId = dashboardAccountId
  publishTestStateImmediately(state)
  const host = div()
  van.add(host, ReadyLibraryState(runQuery))
  const library = host.firstElementChild
  if (library === null) throw new Error('Ready dashboard did not render.')
  return library as HTMLElement
}

function setStateImmediately<T>(signal: {val: T}, value: T): void {
  const internal = signal as unknown as {rawVal: T; _oldVal: T}
  internal.rawVal = value
  internal._oldVal = value
}

function publishTestStateImmediately(state: AppState): void {
  setStateImmediately(publishedPhase, state.phase)
  setStateImmediately(publishedIdentity, state.identity)
  setStateImmediately(publishedAuthorization, state.authorization)
  setStateImmediately(publishedWriteAuthorization, state.writeAuthorization)
  setStateImmediately(publishedSync, state.sync)
  setStateImmediately(publishedNativeListSync, state.nativeListSync)
  setStateImmediately(publishedNativeListMembership, state.nativeListMembership)
  setStateImmediately(publishedNativeListRename, state.nativeListRename)
  setStateImmediately(publishedTriageCounts, state.triageCounts)
  setStateImmediately(publishedLibrary, state.library)
  setStateImmediately(publishedMutations, state.mutations)
  setStateImmediately(publishedError, state.error)
  publishedFingerprints = dashboardSliceFingerprints(state)
  latestJobsInputKey = `${state.identity?.githubUserId ?? ''}:${publishedFingerprints.mutations}`
  setStateImmediately(
    latestJobsByRepository,
    indexLatestRepositoryJobs(
      state.mutations?.jobs ?? [],
      state.identity?.githubUserId ?? null
    )
  )
}

export function renderAppState(state: AppState): void {
  applyState(state)
}

export async function sendDashboardAction(message: RuntimeMessage): Promise<boolean> {
  return sendAction(message)
}

export function renderOperationsState(state: AppState): HTMLElement {
  return OperationsState(state) as HTMLElement
}

export function selectedUnstarRepositoryIds(): readonly string[] {
  return [...selectedForUnstar.val]
}

export function renderMembershipConfirmation(
  preview: StableMembershipPreviewResponse
): HTMLElement {
  const confirmation = MembershipConfirmation(preview, () => undefined, () => undefined) as HTMLElement
  focusInitialDialogAction('.membership-confirmation')
  return confirmation
}

const root = document.getElementById('app')
if (root) {
  mountDashboard(root)
  void loadAppState()
}
