import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {Window} from 'happy-dom'
import type {
  MutationJobRecord,
  MutationJobStatus,
  NativeListRecord,
  RepositoryRecord,
  SyncKind,
  SyncPhase,
  SyncStateRecord
} from '../src/domain/types'
import type {AppState} from '../src/shared/messages'

const accountId = 'review-account-42'
const observedAt = '2026-08-20T12:00:00Z'
const reviewDirectory = new URL('../.impeccable/review/', import.meta.url)
const fixtureUrl = new URL('dashboard-fixture.html', reviewDirectory)

const browserWindow = new Window({
  url: 'chrome-extension://synthetic-review/dashboard/index.html'
})
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  HTMLElement: browserWindow.HTMLElement,
  Text: browserWindow.Text,
  Event: browserWindow.Event,
  KeyboardEvent: browserWindow.KeyboardEvent,
  chrome: {
    runtime: {
      sendMessage: async () => {
        throw new Error('Dashboard review fixture runtime mutations are disabled.')
      }
    }
  }
})

const repositories = [
  repository(
    'R_accessibility',
    'inclusive-components',
    'accessible-repository-library-patterns',
    'A practical collection of resilient interface patterns with keyboard, contrast, focus, and reduced-motion guidance for product teams.',
    'TypeScript',
    ['accessibility', 'design-systems']
  ),
  repository(
    'R_browser',
    'local-first-labs',
    'browser-library',
    'A local-first toolkit for durable browser data, offline workflows, and careful synchronization boundaries.',
    'Rust',
    ['local-first', 'offline']
  ),
  repository(
    'R_long',
    'boundary-test-organization',
    'repository-name-that-remains-valid-at-the-github-boundary-and-must-wrap-without-clipping-any-content',
    'This intentionally long but valid repository description exercises wrapping across narrow cards without hiding its meaning, status, language, starred date, or local triage state at responsive boundaries.',
    'JavaScript',
    ['responsive-design', 'long-content']
  ),
  repository(
    'R_queue',
    'queue-labs',
    'durable-mutation-runner',
    'Queues remote changes safely and verifies every result before local state advances.',
    'Go',
    ['queues', 'safety']
  ),
  repository(
    'R_retry',
    'octo-tools',
    'rate-limit-observer',
    'Observes API limits and schedules bounded retries without guessing about remote state.',
    'Python',
    ['rate-limits']
  ),
  repository(
    'R_blocked',
    'verification-lab',
    'remote-state-guard',
    'Preserves unknown remote outcomes for explicit review instead of reporting false success.',
    'Kotlin',
    ['verification']
  )
] as const

const nativeLists = [
  nativeList('L_current', 'Current List', 4, 4, 'complete'),
  nativeList('L_research', 'Research and reference material for resilient local-first product workflows', 3, 3, 'complete'),
  nativeList('L_partial', 'Partially imported private references', 5, 2, 'partial')
] as const

const jobs = [
  mutationJob(repositories[0], 'failed', 1),
  mutationJob(repositories[3], 'queued', 2),
  mutationJob(repositories[4], 'retry-waiting', 3),
  mutationJob(repositories[5], 'blocked-unknown', 4)
] as const

const representativeState: AppState = {
  phase: 'ready',
  identity: {
    githubUserId: accountId,
    userNodeId: 'U_review_account_42',
    login: 'review-librarian',
    avatarUrl: 'https://avatars.githubusercontent.com/u/583231'
  },
  authorization: null,
  writeAuthorization: {
    readiness: 'authorization-required',
    membershipReady: false,
    previewVisible: false,
    authorization: null,
    error: null
  },
  nativeListMembership: {readiness: 'write-authorization-required'},
  nativeListRename: {readiness: 'write-authorization-required'},
  nativeListLifecycle: {
    readiness: 'write-authorization-required',
    operation: null
  },
  sync: syncState('stars', 'stale'),
  nativeListSync: syncState('native-lists', 'partial'),
  triageCounts: {inbox: 2, backlog: 2, due: 1, organized: 4},
  library: {
    repositories,
    nativeLists,
    nativeMemberships: [
      membership('L_current', 'R_accessibility'),
      membership('L_current', 'R_browser'),
      membership('L_current', 'R_long'),
      membership('L_current', 'R_queue'),
      membership('L_current', 'R_retry'),
      membership('L_current', 'R_blocked'),
      membership('L_research', 'R_accessibility'),
      membership('L_research', 'R_retry'),
      membership('L_partial', 'R_blocked')
    ],
    annotations: repositories.map((item, index) => ({
      githubUserId: accountId,
      repositoryNodeId: item.repositoryNodeId,
      triageState: (['inbox', 'backlog', 'reviewed', 'snoozed'] as const)[index % 4] ?? 'inbox',
      tags: index === 2 ? ['responsive-design', 'long-content-boundary'] : [`review-${index + 1}`],
      note: index === 2
        ? 'A long local note remains private and is included only to keep this synthetic fixture representative.'
        : '',
      favorite: index === 0,
      revisitAt: index === 3 ? '2026-08-28T09:00:00Z' : null,
      reviewedAt: index === 2 ? '2026-08-19T09:00:00Z' : null,
      localModifiedAt: observedAt
    }))
  },
  mutations: {batches: [], jobs, history: []},
  error: null
}

const {mountDashboard} = await import('../src/dashboard/scripts')
const host = browserWindow.document.createElement('div')
host.id = 'app'
browserWindow.document.body.append(host)
mountDashboard(host as unknown as HTMLElement, representativeState)
const currentList = [...host.querySelectorAll('button')].find(
  (element) => element.textContent?.includes('Current List')
)
if (currentList === undefined) {
  throw new Error('Dashboard review fixture is missing the representative Current List.')
}
currentList.click()
await browserWindow.happyDOM.whenAsyncComplete()

for (const selector of ['.app-shell', '.app-header', '.list-sidebar']) {
  if (host.querySelector(selector) === null) {
    throw new Error(`Dashboard review fixture is missing required shell element: ${selector}`)
  }
}
if (!host.textContent?.includes('Star List Manager')) {
  throw new Error('Dashboard review fixture is missing the Star List Manager wordmark.')
}

const styles = await readFile(new URL('../src/dashboard/styles.css', import.meta.url), 'utf8')
if (/https?:\/\//i.test(styles)) {
  throw new Error('Dashboard review fixture CSS must not contain remote resource URLs.')
}

const staticDocument = `<!doctype html>
<!-- Synthetic review data; this fixture is never shipped. -->
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>Star List Manager — synthetic visual review</title>
    <style>${styles}</style>
  </head>
  <body>${browserWindow.document.body.innerHTML}</body>
</html>
`

if (/<(?:script|img|link|iframe|source|video|audio)\b[^>]*(?:src|href)=["']https?:\/\//i.test(staticDocument)) {
  throw new Error('Dashboard review fixture must not load remote resources.')
}

await mkdir(reviewDirectory, {recursive: true})
await writeFile(fixtureUrl, staticDocument)
console.log(`Generated ${fixtureUrl.pathname}`)

function repository(
  repositoryNodeId: string,
  ownerLogin: string,
  name: string,
  description: string,
  primaryLanguage: string,
  topics: readonly string[]
): RepositoryRecord {
  return {
    githubUserId: accountId,
    repositoryNodeId,
    ownerLogin,
    name,
    fullName: `${ownerLogin}/${name}`,
    htmlUrl: `https://github.com/${ownerLogin}/${name}`,
    description,
    topics,
    primaryLanguage,
    starredAt: '2026-07-14T09:30:00Z',
    pushedAt: '2026-08-18T16:45:00Z',
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: '2026-07-14T09:30:00Z',
    lastObservedAt: observedAt,
    unstarredAt: null
  }
}

function nativeList(
  listNodeId: string,
  name: string,
  reportedItemCount: number,
  importedItemCount: number,
  importStatus: NativeListRecord['importStatus']
): NativeListRecord {
  return {
    githubUserId: accountId,
    listNodeId,
    name,
    description: null,
    visibility: listNodeId === 'L_partial' ? 'private' : 'public',
    slug: null,
    createdAt: '2026-01-12T10:00:00Z',
    updatedAt: observedAt,
    lastAddedAt: '2026-08-18T16:45:00Z',
    reportedItemCount,
    importedItemCount,
    importStatus,
    lastObservedAt: observedAt
  }
}

function membership(listNodeId: string, repositoryNodeId: string) {
  return {
    githubUserId: accountId,
    listNodeId,
    repositoryNodeId,
    lastObservedAt: observedAt
  }
}

function mutationJob(
  item: RepositoryRecord,
  status: MutationJobStatus,
  sequence: number
): MutationJobRecord {
  const terminal = status === 'failed' || status === 'blocked-unknown'
  return {
    githubUserId: accountId,
    jobId: `J_review_${sequence}`,
    batchId: `B_review_${sequence}`,
    mutationKind: 'unstar',
    repositoryNodeId: item.repositoryNodeId,
    ownerLogin: item.ownerLogin,
    repositoryName: item.name,
    status,
    recoveryStatus: 'none',
    retryEligibility: status === 'blocked-unknown' ? 'after-refresh' : status === 'failed' ? 'manual' : 'automatic',
    attemptCount: status === 'queued' ? 0 : sequence,
    nextEligibleExecutionAt: status === 'retry-waiting' ? '2026-08-20T12:30:00Z' : null,
    claimedAt: status === 'queued' ? null : '2026-08-20T11:55:00Z',
    completedAt: terminal ? observedAt : null,
    lastError: status === 'failed'
      ? {
          category: 'permission',
          message: 'GitHub denied the requested change; no local starred state was changed.',
          statusCode: 403,
          occurredAt: observedAt
        }
      : status === 'blocked-unknown'
        ? {
            category: 'unknown',
            message: 'GitHub returned an ambiguous response, so the final remote state is unknown.',
            statusCode: null,
            occurredAt: observedAt
          }
        : null,
    membershipDetails: null,
    createdAt: `2026-08-20T11:${String(40 + sequence).padStart(2, '0')}:00Z`,
    updatedAt: `2026-08-20T11:${String(50 + sequence).padStart(2, '0')}:00Z`
  }
}

function syncState(kind: SyncKind, phase: SyncPhase): SyncStateRecord {
  return {
    githubUserId: accountId,
    kind,
    phase,
    attempt: 2,
    pagesProcessed: 3,
    itemsObserved: repositories.length,
    skippedItems: phase === 'partial' ? 3 : 0,
    convergenceAttempt: 2,
    baselineCompletedAt: '2026-08-18T12:00:00Z',
    lastStartedAt: '2026-08-20T11:45:00Z',
    lastCompletedAt: '2026-08-20T11:46:00Z',
    lastSuccessfulAt: '2026-08-18T12:00:00Z',
    rateLimit: {limit: 5000, remaining: 4312, resetAt: '2026-08-20T13:00:00Z'},
    lastError: null
  }
}
