import {expect, test} from 'bun:test'
import type {MutationJobRecord} from '../../src/domain/types'
import type {AppState} from '../../src/shared/messages'
import {
  classifyWorkspace,
  dashboardSliceFingerprints,
  deriveRepositoryResults,
  indexLatestRepositoryJobs,
  materialFingerprint,
  type RepositoryQueryRunner
} from '../../src/dashboard/derivations'
import {
  buildLibraryRepositories,
  defaultRepositoryFilters,
  queryRepositories,
  type RepositoryQuery
} from '../../src/dashboard/library'
import type {LibrarySnapshot} from '../../src/domain/types'

test('fingerprints every dashboard publication slice without mutating state', () => {
  const state: AppState = {
    phase: 'ready',
    identity: {githubUserId: '42', userNodeId: 'U_42', login: 'octocat', avatarUrl: 'https://example.test/avatar'},
    authorization: null,
    writeAuthorization: {readiness: 'ready', membershipReady: true, previewVisible: false, authorization: null, error: null},
    nativeListMembership: {readiness: 'ready'},
    nativeListRename: {readiness: 'capability-unproven'},
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: snapshot(),
    mutations: {jobs: [mutationJob('42', 'R_one', '2026-08-01T10:00:00Z', 'J_1')], batches: [], history: []},
    error: null
  }
  const original = structuredClone(state)
  const fingerprints = dashboardSliceFingerprints(state)
  const cloneFingerprints = dashboardSliceFingerprints(structuredClone(state))

  expect(cloneFingerprints).toEqual(fingerprints)
  expect(state).toEqual(original)
  expect(materialFingerprint(undefined)).toBe('undefined')

  for (const [key, replacement] of [
    ['identity', {...state.identity!, login: 'hubot'}],
    ['writeAuthorization', {...state.writeAuthorization, readiness: 'credential-rejected'}],
    ['nativeListMembership', {readiness: 'write-authorization-required'}],
    ['nativeListRename', {readiness: 'ready'}],
    ['library', {...state.library!, repositories: [{...state.library!.repositories[0]!, name: 'changed'}, ...state.library!.repositories.slice(1)]}],
    ['mutations', {...state.mutations!, jobs: [{...state.mutations!.jobs[0]!, status: 'checking'}]}]
  ] as const) {
    const changed = dashboardSliceFingerprints({...state, [key]: replacement})
    expect(Object.keys(changed).filter((slice) => changed[slice as keyof typeof changed] !== fingerprints[slice as keyof typeof fingerprints])).toEqual([key])
  }
})

test('canonicalizes JSON-compatible fingerprints without reordering arrays', () => {
  expect(materialFingerprint({z: 1, nested: {b: true, a: null}, items: ['b', 'a']})).toBe(
    materialFingerprint({items: ['b', 'a'], nested: {a: null, b: true}, z: 1})
  )
  expect(materialFingerprint({items: ['a', 'b']})).not.toBe(
    materialFingerprint({items: ['b', 'a']})
  )
  expect(materialFingerprint({optional: undefined})).not.toBe(materialFingerprint({}))
  expect(materialFingerprint(undefined)).toBe('undefined')
})

test('detects material changes across every structured dashboard slice', () => {
  const state: AppState = {
    phase: 'ready',
    identity: null,
    authorization: null,
    writeAuthorization: {readiness: 'signed-out', membershipReady: false, previewVisible: false, authorization: null, error: null},
    nativeListMembership: {readiness: 'capability-unproven'},
    nativeListRename: {readiness: 'capability-unproven'},
    sync: null,
    nativeListSync: null,
    triageCounts: null,
    library: snapshot(),
    mutations: {jobs: [], batches: [], history: []},
    error: null
  }
  const baseline = dashboardSliceFingerprints(state)
  const sync = {
    githubUserId: '42', kind: 'stars', phase: 'complete', attempt: 1,
    pagesProcessed: 1, itemsObserved: 2, skippedItems: 0, convergenceAttempt: 1,
    baselineCompletedAt: null, lastStartedAt: null, lastCompletedAt: null,
    lastSuccessfulAt: null, rateLimit: {limit: null, remaining: null, resetAt: null},
    lastError: null
  }
  const library = state.library!
  const repository = library.repositories[0]!
  const variants: readonly (readonly [keyof typeof baseline, AppState])[] = [
    ['phase', {...state, phase: 'loading'}],
    ['identity', {...state, identity: {githubUserId: '42', userNodeId: 'U_42', login: 'octocat', avatarUrl: 'https://example.test'}}],
    ['authorization', {...state, authorization: {userCode: 'ABCD', verificationUri: 'https://github.com/login/device', expiresAt: '2026-08-01T00:00:00Z', intervalSeconds: 5}}],
    ['writeAuthorization', {...state, writeAuthorization: {...state.writeAuthorization, readiness: 'authorization-required'}}],
    ['sync', {...state, sync: sync as AppState['sync']}],
    ['nativeListSync', {...state, nativeListSync: {...sync, kind: 'native-lists'} as AppState['nativeListSync']}],
    ['nativeListMembership', {...state, nativeListMembership: {readiness: 'ready'}}],
    ['nativeListRename', {...state, nativeListRename: {readiness: 'write-authorization-required'}}],
    ['triageCounts', {...state, triageCounts: {inbox: 1, backlog: 2, due: 3, organized: 4}}],
    ['library', {...state, library: {...library, repositories: [{...repository, isStarred: false}, ...library.repositories.slice(1)]}}],
    ['library', {...state, library: {...library, annotations: [{githubUserId: '42', repositoryNodeId: repository.repositoryNodeId, triageState: 'inbox', tags: [], note: 'changed', favorite: false, revisitAt: null, reviewedAt: null, localModifiedAt: '2026-08-01T00:00:00Z'}]}}],
    ['library', {...state, library: {...library, nativeLists: [{githubUserId: '42', listNodeId: 'L_1', name: 'List', description: null, visibility: 'public', slug: null, createdAt: null, updatedAt: null, lastAddedAt: null, reportedItemCount: 1, importedItemCount: 1, importStatus: 'complete', lastObservedAt: '2026-08-01T00:00:00Z'}]}}],
    ['library', {...state, library: {...library, nativeMemberships: [{githubUserId: '42', repositoryNodeId: repository.repositoryNodeId, listNodeId: 'L_1', lastObservedAt: '2026-08-01T00:00:00Z'}]}}],
    ['mutations', {...state, mutations: {jobs: [mutationJob('42', 'R_one', '2026-08-01T00:00:00Z', 'J_1')], batches: [], history: []}}],
    ['mutations', {...state, mutations: {jobs: [], batches: [{marker: 'batch'}] as unknown as NonNullable<AppState['mutations']>['batches'], history: []}}],
    ['mutations', {...state, mutations: {jobs: [], batches: [], history: [{marker: 'history'}] as unknown as NonNullable<AppState['mutations']>['history']}}],
    ['error', {...state, error: {category: 'network', message: 'Unavailable', retryable: true}}]
  ]

  for (const [expected, variant] of variants) {
    const changed = dashboardSliceFingerprints(variant)
    expect(Object.keys(changed).filter((key) => changed[key as keyof typeof changed] !== baseline[key as keyof typeof baseline])).toEqual([expected])
  }
})

test('classifies Unlist and native Lists as one stable library workspace', () => {
  expect(classifyWorkspace('ready', {kind: 'unlist'})).toBe('library')
  expect(classifyWorkspace('ready', {kind: 'list', listNodeId: 'L_1'})).toBe('library')
  expect(classifyWorkspace('ready', {kind: 'operations'})).toBe('operations')
  expect(classifyWorkspace('ready', {kind: 'settings'})).toBe('settings')
  expect(classifyWorkspace('loading', {kind: 'unlist'})).toBe('loading')
})

test('indexes one deterministic latest job per repository for the active account', () => {
  const jobs = [
    mutationJob('42', 'R_one', '2026-08-01T10:00:00Z', 'J_1'),
    mutationJob('42', 'R_one', '2026-08-02T10:00:00Z', 'J_2'),
    mutationJob('7', 'R_one', '2026-08-03T10:00:00Z', 'J_other'),
    mutationJob('42', 'R_two', '2026-08-02T10:00:00Z', 'J_3'),
    mutationJob('42', 'R_two', '2026-08-02T10:00:00Z', 'J_4')
  ]

  const index = indexLatestRepositoryJobs(jobs, '42')

  expect(index.get('R_one')?.jobId).toBe('J_2')
  expect(index.get('R_two')?.jobId).toBe('J_4')
  expect(index.size).toBe(2)
  expect(indexLatestRepositoryJobs(jobs, null).size).toBe(0)
})

test('derives all repository result consumers from one query call', () => {
  const repositories = buildLibraryRepositories(snapshot())
  const query: RepositoryQuery = {
    view: {kind: 'unlist'},
    search: '',
    filters: defaultRepositoryFilters(),
    sort: 'name',
    ascending: true
  }
  let calls = 0
  const runner: RepositoryQueryRunner = (...args) => {
    calls += 1
    return queryRepositories(...args)
  }

  const result = deriveRepositoryResults(repositories, query, 0, 'R_two', 1, runner)

  expect(calls).toBe(1)
  expect(result.count).toBe(2)
  expect(result.visible).toEqual(result.all.slice(0, 1))
  expect(result.inspectedRemainsVisible).toBe(true)
})

function mutationJob(
  githubUserId: string,
  repositoryNodeId: string,
  createdAt: string,
  jobId: string
): MutationJobRecord {
  return {
    githubUserId,
    jobId,
    batchId: `B_${jobId}`,
    mutationKind: 'unstar',
    repositoryNodeId,
    ownerLogin: 'octocat',
    repositoryName: repositoryNodeId,
    status: 'queued',
    recoveryStatus: 'none',
    retryEligibility: 'automatic',
    attemptCount: 0,
    nextEligibleExecutionAt: null,
    claimedAt: null,
    completedAt: null,
    lastError: null,
    membershipDetails: null,
    createdAt,
    updatedAt: createdAt
  }
}

function snapshot(): LibrarySnapshot {
  const repository = (id: string, name: string) => ({
    githubUserId: '42',
    repositoryNodeId: id,
    ownerLogin: 'octocat',
    name,
    fullName: `octocat/${name}`,
    htmlUrl: `https://github.com/octocat/${name}`,
    description: null,
    topics: [],
    primaryLanguage: null,
    starredAt: '2026-08-01T00:00:00Z',
    pushedAt: null,
    archived: false,
    disabled: false,
    isStarred: true,
    firstObservedAt: '2026-08-01T00:00:00Z',
    lastObservedAt: '2026-08-01T00:00:00Z',
    unstarredAt: null
  })
  return {
    repositories: [repository('R_one', 'alpha'), repository('R_two', 'beta')],
    annotations: [],
    nativeLists: [],
    nativeMemberships: []
  }
}
