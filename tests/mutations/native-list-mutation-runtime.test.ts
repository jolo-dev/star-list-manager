import {expect, test} from 'bun:test'
import {IDBFactory} from 'fake-indexeddb'
import {canonicalMembershipSet, planMembershipIntent, relevantListCatalogFingerprint} from '../../src/domain/native-list-membership'
import {createNativeListMutationRuntime} from '../../src/mutations/native-list-mutation-runtime'
import {openLibraryDatabase} from '../../src/storage/database'
import {putNativeListLifecycleOperation, putRepository} from '../../src/storage/library'
import {enqueueMembershipMutationBatch} from '../../src/storage/mutations'

const account = '42'
const timestamp = '2026-08-12T00:00:00.000Z'

test('production native List composition serializes concurrent lifecycle and membership remote writes', async () => {
  const database = await openLibraryDatabase({name: 'native-list-runtime-shared-lock', factory: new IDBFactory()})
  const events: string[] = []
  let releaseLifecycle!: () => void
  let lifecycleStarted!: () => void
  const started = new Promise<void>((resolve) => { lifecycleStarted = resolve })
  await putRepository(database, repository())
  const plan = planMembershipIntent([], {
    kind: 'add', githubUserId: account, repositoryNodeId: 'R_repo', additions: ['UL_member']
  })
  if (!plan.ok) throw new Error('invalid fixture')
  await enqueueMembershipMutationBatch(database, {
    githubUserId: account, batchId: 'membership', origin: 'single', createdAt: timestamp,
    repositories: [{jobId: 'membership-job', repositoryNodeId: 'R_repo', ownerLogin: 'octocat', repositoryName: 'repo', plan: plan.value, confirmedCatalog: relevantListCatalogFingerprint(['UL_member'], [{listNodeId: 'UL_member', name: 'Member', visibility: 'public'}])}]
  })
  await putNativeListLifecycleOperation(database, createOperation())
  let membershipObservation = 0
  let catalog = [] as ReturnType<typeof nativeList>[]
  const runtime = createNativeListMutationRuntime({
    queue: {
      database, authStore: activeOwner(), service: {prepare: async () => ({kind: 'ready-to-delete' as const, currentRoute: {owner: 'octocat', repositoryName: 'repo'}, observationAttempts: 1}), delete: async () => ({kind: 'delete-accepted' as const, currentRoute: {owner: 'octocat', repositoryName: 'repo'}}), observeStableState: async () => ({kind: 'confirmed-present' as const, currentRoute: {owner: 'octocat', repositoryName: 'repo'}, observationAttempts: 1})},
      membershipService: {
        observer: {observeSelected: async () => stable(++membershipObservation === 1 ? [] : ['UL_member'])},
        writer: {updateMemberships: async () => { events.push('membership-write'); return {updatedListIds: ['UL_member']} }}
      },
      scheduleWake: async () => undefined, now: () => Date.parse(timestamp), createId: (kind) => `${kind}-${membershipObservation}`
    },
    lifecycle: {
      database, owner: activeOwner(),
      writer: {createList: async () => { events.push('lifecycle-write-start'); lifecycleStarted(); await new Promise<void>((resolve) => { releaseLifecycle = resolve }); events.push('lifecycle-write-end'); return {listNodeId: 'UL_created', name: 'Ideas', visibility: 'public' as const} }, deleteList: async () => undefined},
      observeCatalog: async () => ({githubUserId: account, complete: true as const, targets: new Map([['UL_created', catalogMetadata('UL_created', 'Ideas')]]), fingerprint: 'catalog', rateLimit: {limit: 5000, remaining: 4999, resetAt: null}}),
      synchronize: async () => { catalog = [nativeList('UL_created', 'Ideas')]; return {phase: 'complete'} },
      listCatalog: async () => catalog, now: () => timestamp
    }
  })

  const lifecycle = runtime.lifecycleRunner.run(account)
  await started
  const membership = runtime.mutationQueue.check()
  await Promise.resolve()
  expect(events).toEqual(['lifecycle-write-start'])
  releaseLifecycle()
  await Promise.all([lifecycle, membership])
  expect(events).toEqual(['lifecycle-write-start', 'lifecycle-write-end', 'membership-write'])
  database.close()
})

function stable(listNodeIds: readonly string[]) {
  const observed = canonicalMembershipSet(listNodeIds)
  const relevantCatalog = relevantListCatalogFingerprint(['UL_member'], [{listNodeId: 'UL_member', name: 'Member', visibility: 'public'}])
  const repositories = [{repositoryNodeId: 'R_repo', observed, relevantCatalog}]
  const complete = {githubUserId: account, completeness: 'complete' as const, nonAtomic: true as const, captureInterval: {startedAt: timestamp, completedAt: timestamp}, repositories, fingerprint: 'observation'}
  return {status: 'stable' as const, githubUserId: account, attempts: 2, captureInterval: complete.captureInterval, observations: [complete, complete] as const, repositories, fingerprint: complete.fingerprint}
}
function activeOwner() {
  return {loadActive: async () => ({githubUserId: account, identity: {githubUserId: account, userNodeId: 'U_42', login: 'octocat', avatarUrl: 'https://example.test/avatar'}, credentials: {accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: timestamp, refreshTokenExpiresAt: timestamp, generation: 1}, authenticatedAt: timestamp, refreshedAt: timestamp})}
}
function repository() {
  return {githubUserId: account, repositoryNodeId: 'R_repo', ownerLogin: 'octocat', name: 'repo', fullName: 'octocat/repo', htmlUrl: 'https://github.com/octocat/repo', description: null, topics: [], primaryLanguage: null, starredAt: timestamp, pushedAt: null, archived: false, disabled: false, isStarred: true, firstObservedAt: timestamp, lastObservedAt: timestamp, unstarredAt: null}
}
function createOperation() {
  return {githubUserId: account, operationId: 'create', intent: {kind: 'create' as const, name: 'Ideas', visibility: 'public' as const}, phase: 'queued' as const, attemptCount: 0, candidateListNodeId: null, confirmationFingerprint: null, lastError: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null}
}
function catalogMetadata(listNodeId: string, name: string) {
  return {listNodeId, name, description: null, isPrivate: false, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount: 0}
}
function nativeList(listNodeId: string, name: string) {
  return {githubUserId: account, listNodeId, name, description: null, visibility: 'public' as const, slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount: 0, importedItemCount: 0, importStatus: 'complete' as const, lastObservedAt: timestamp}
}
