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

  expect(confirmation.getAttribute('role')).toBe('presentation')
  expect(confirmation.querySelector('[role="dialog"]')).not.toBeNull()
  expect(confirmation.textContent).toContain('exactly 2 repositories')
  expect(confirmation.textContent).toContain('octocat/one')
  expect(confirmation.textContent).toContain('github/two')
  expect(confirmation.textContent).toContain('There is no Undo or re-star control')
  const cancel = [...confirmation.querySelectorAll('button')].find(
    (element) => element.textContent === 'Cancel'
  )
  cancel?.dispatchEvent(
    new browserWindow.MouseEvent('click', {bubbles: true}) as unknown as Event
  )
  expect(cancellations).toBe(1)
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
    'require a new confirmation'
  ]) {
    expect(confirmation.textContent).toContain(value)
  }
  expect(confirmation.querySelectorAll('.membership-preview-card')).toHaveLength(2)
  expect(confirmation.querySelector('.membership-confirmation.is-destructive')).not.toBeNull()
  expect(confirmation.querySelector('.danger-action')).not.toBeNull()
})

test('renders native membership observation, safety, verification, conflict, and partial batch statuses', async () => {
  const {renderOperationsState} = await import('../../src/dashboard/scripts')
  const statuses: readonly MutationJobStatus[] = [
    'queued',
    'observing-membership',
    'unstable-observation',
    'needs-confirmation',
    'verification-conflict',
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
    'Safety block: changing',
    'Review refreshed preview',
    'Desired Lists:',
    'Observed Lists:',
    'Partial batch outcome'
  ]) {
    expect(operations.textContent).toContain(value)
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
