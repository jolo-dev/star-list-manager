import {
  addRuntimeMessageListener,
  clearBrowserAlarm,
  clearLocalStorage,
  createBrowserAlarm,
  onBrowserAlarm,
  onBrowserStartup,
  onToolbarClicked,
  openOrFocusDashboard,
  setToolbarBadge
} from './platform/browser'
import {
  decodeDashboardRequest,
  failureResponse,
  successResponse
} from './shared/messages'
import {AppFailure, sanitizeError} from './shared/errors'
import {openLibraryDatabase} from './storage/database'
import {BrowserAuthStore} from './auth/store'
import {BrowserWriteAuthStore} from './auth/write-store'
import {GitHubDeviceFlow} from './auth/device-flow'
import {GitHubWriteDeviceFlow} from './auth/write-device-flow'
import {AuthController} from './auth/controller'
import {WriteAuthController} from './auth/write-controller'
import {AuthSession} from './auth/session'
import {GitHubRestClient} from './github/rest-client'
import {GitHubGraphqlClient} from './github/graphql-client'
import {StarSyncService} from './sync/star-sync'
import {NativeListSyncService} from './sync/native-list-sync'
import {
  clearAllLibraryData,
  getSyncState,
  listAnnotations,
  listNativeLists,
  listNativeMemberships,
  listRepositories
} from './storage/library'
import {
  cancelQueuedMutationJob,
  enqueueMembershipMutationBatch,
  enqueueMutationBatch,
  getMutationJob,
  listMutationBatches,
  listMutationJobs,
  listOperationHistory
} from './storage/mutations'
import type {
  AppState,
  MembershipListPreviewItem,
  MembershipOperationSelection,
  MembershipPreviewResponse,
  MembershipRepositoryPreview
} from './shared/messages'
import {TriageService} from './triage/service'
import {DataPortabilityService} from './import/service'
import {StarringWriteSession} from './github/starring-write-session'
import {SafeUnstarService} from './github/safe-unstar-service'
import {ListMembershipWriteSession} from './github/list-membership-write-session'
import {nativeListMembershipControlsEnabled} from './github/list-membership-capability'
import {MutationQueueRunner} from './mutations/runner'
import {NativeListMembershipObservationService} from './sync/native-list-membership-observation'
import {
  mutationQueueAlarmName,
  registerMutationQueueWakeEvents
} from './mutations/wake'
import {safeLogMessage} from './shared/logging'
import type {RepositoryRecord} from './domain/types'
import {
  type CanonicalListCatalogFingerprint,
  type MembershipIntentPlan,
  type NativeListMembershipIntent
} from './domain/native-list-membership'

const githubClientId = import.meta.env.EXTENSION_PUBLIC_GITHUB_CLIENT_ID
const githubWriteClientId =
  import.meta.env.EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID
const membershipWriteCapabilityProven =
  nativeListMembershipControlsEnabled(
    import.meta.env.EXTENSION_PUBLIC_GITHUB_LIST_MEMBERSHIP_WRITE_ENABLED === 'true'
      ? {
          schema: 'available',
          oauthUserScope: 'verified',
          accountOwnership: 'verified',
          unchangedSetMutation: 'verified',
          independentReadBack: 'verified'
        }
      : null
  )
const runtimeServices = createRuntimeServices()
const membershipPreviews = new Map<string, StoredMembershipPreview>()
const membershipPreviewLifetimeMs = 10 * 60 * 1000

registerMutationQueueWakeEvents(
  {onAlarm: onBrowserAlarm, onStartup: onBrowserStartup},
  wakeMutationQueue
)

onToolbarClicked(() => openOrFocusDashboard())

addRuntimeMessageListener(async (message) => {
  try {
    const request = decodeDashboardRequest(message)
    if (!request.ok) return failureResponse(request.error)

    const services = await runtimeServices
    if (wakesMutationQueue(request.value.type)) {
      checkQueueOnAuthenticatedInteraction(services)
    }
    switch (request.value.type) {
      case 'get-app-state':
        return successResponse(await getDashboardState(services))
      case 'start-device-auth':
        if (!githubClientId) {
          return failureResponse({
            category: 'unsupported',
            message: 'GitHub sign-in is not configured in this build.',
            retryable: false
          })
        }
        await services.authController.startAuthorization()
        return successResponse(await getDashboardState(services))
      case 'cancel-device-auth':
        await services.authController.cancelAuthorization()
        return successResponse(await getDashboardState(services))
      case 'show-write-auth-preview':
        await services.writeAuthController.showPreview()
        return successResponse(await getDashboardState(services))
      case 'start-write-device-auth':
        if (!githubWriteClientId) {
          return failureResponse({
            category: 'unsupported',
            message: 'GitHub write authorization is not configured in this build.',
            retryable: false
          })
        }
        await services.writeAuthController.startAuthorization()
        return successResponse(await getDashboardState(services))
      case 'cancel-write-device-auth':
        await services.writeAuthController.cancelAuthorization()
        return successResponse(await getDashboardState(services))
      case 'disconnect-write-auth':
        await services.writeAuthController.disconnectCurrent()
        return successResponse(await getDashboardState(services))
      case 'disconnect':
        await services.writeAuthController.disconnectCurrent()
        await services.authController.disconnect()
        await setToolbarBadge('')
        return successResponse(await getDashboardState(services))
      case 'start-sync': {
        const active = await services.authSession.loadActive()
        if (!active) {
          return failureResponse({
            category: 'authentication',
            message: 'Connect GitHub before synchronizing stars.',
            retryable: false
          })
        }
        const [starState, nativeListState] = await Promise.all([
          services.starSync.synchronize(active.githubUserId),
          services.nativeListSync.synchronize(active.githubUserId)
        ])
        await services.triage.classifyAfterSynchronization(
          active.githubUserId,
          starState,
          nativeListState
        )
        return successResponse(await getDashboardState(services))
      }
      case 'update-annotation': {
        const active = await services.authSession.loadActive()
        if (!active) {
          return failureResponse({
            category: 'authentication',
            message: 'Connect GitHub before editing annotations.',
            retryable: false
          })
        }
        await services.triage.updateAnnotation(
          active.githubUserId,
          request.value.repositoryNodeId,
          request.value.patch
        )
        return successResponse(await getDashboardState(services))
      }
      case 'enqueue-confirmed-unstars': {
        const active = await services.authSession.loadActive()
        if (!active || active.identity.githubUserId !== active.githubUserId) {
          return failureResponse({
            category: 'authentication',
            message: 'Connect GitHub before confirming an unstar operation.',
            retryable: false
          })
        }
        const writeAuthorization = await services.writeAuthController.getState()
        if (writeAuthorization.readiness !== 'ready') {
          return failureResponse({
            category: 'authentication',
            message: 'Authorize GitHub Starring changes before confirming an unstar operation.',
            retryable: true
          })
        }
        const repositories = await listRepositories(
          services.database,
          active.githubUserId
        )
        const byNodeId = new Map(
          repositories.map((repository) => [repository.repositoryNodeId, repository])
        )
        const confirmed = request.value.repositoryNodeIds.map((repositoryNodeId) => {
          const repository = byNodeId.get(repositoryNodeId)
          if (
            !repository ||
            repository.githubUserId !== active.githubUserId ||
            !repository.isStarred
          ) {
            throw new AppFailure({
              category: 'validation',
              message: 'Refresh the library before confirming these unstar operations.',
              retryable: true
            })
          }
          return repository
        })
        const stillActive = await services.authSession.loadActive()
        if (
          stillActive?.githubUserId !== active.githubUserId ||
          stillActive.identity.githubUserId !== active.githubUserId
        ) {
          return failureResponse({
            category: 'authentication',
            message: 'The active GitHub account changed before the operation was queued.',
            retryable: true
          })
        }
        const createdAt = new Date().toISOString()
        await enqueueMutationBatch(services.database, {
          githubUserId: active.githubUserId,
          batchId: `batch-${crypto.randomUUID()}`,
          origin: confirmed.length === 1 ? 'single' : 'bulk',
          createdAt,
          repositories: confirmed.map((repository) => ({
            jobId: `job-${crypto.randomUUID()}`,
            repositoryNodeId: repository.repositoryNodeId,
            ownerLogin: repository.ownerLogin,
            repositoryName: repository.name
          }))
        })
        wakeMutationQueueNonBlocking(services)
        return successResponse(await getDashboardState(services))
      }
      case 'preview-native-list-membership': {
        const active = await requireMembershipMutationAccount(services)
        return successResponse(
          await previewMembershipOperation(
            services,
            active.githubUserId,
            request.value.repositoryNodeIds,
            request.value.operation,
            null
          )
        )
      }
      case 'refresh-native-list-membership-preview': {
        const active = await requireMembershipMutationAccount(services)
        const job = await getMutationJob(
          services.database,
          active.githubUserId,
          request.value.jobId
        )
        if (
          !job ||
          job.status !== 'needs-confirmation' ||
          job.mutationKind !== 'native-list-membership' ||
          !job.membershipDetails
        ) {
          throw new AppFailure({
            category: 'validation',
            message: 'This membership operation no longer needs confirmation.',
            retryable: true
          })
        }
        return successResponse(
          await previewMembershipIntents(
            services,
            active.githubUserId,
            [job.membershipDetails.intent],
            request.value.jobId
          )
        )
      }
      case 'confirm-native-list-membership-preview': {
        const active = await requireMembershipMutationAccount(services)
        const preview = membershipPreviews.get(request.value.previewId)
        membershipPreviews.delete(request.value.previewId)
        if (
          !preview ||
          preview.githubUserId !== active.githubUserId ||
          Date.now() - preview.createdAt > membershipPreviewLifetimeMs
        ) {
          throw new AppFailure({
            category: 'validation',
            message: 'The membership preview expired. Refresh it before confirming.',
            retryable: true
          })
        }
        const changed = preview.repositories.filter(
          (repository) =>
            repository.plan.added.length > 0 || repository.plan.removed.length > 0
        )
        if (changed.length === 0) {
          throw new AppFailure({
            category: 'validation',
            message: 'The membership selection is already satisfied. No jobs were created.',
            retryable: false
          })
        }
        const stillActive = await services.authSession.loadActive()
        if (
          stillActive?.githubUserId !== active.githubUserId ||
          stillActive.identity.githubUserId !== active.githubUserId
        ) {
          throw new AppFailure({
            category: 'authentication',
            message: 'The active GitHub account changed before the membership work was queued.',
            retryable: true
          })
        }
        const createdAt = new Date().toISOString()
        await enqueueMembershipMutationBatch(services.database, {
          githubUserId: active.githubUserId,
          batchId: `batch-${crypto.randomUUID()}`,
          origin: changed.length === 1 ? 'single' : 'bulk',
          createdAt,
          repositories: changed.map((repository) => ({
            jobId: `job-${crypto.randomUUID()}`,
            repositoryNodeId: repository.repository.repositoryNodeId,
            ownerLogin: repository.repository.ownerLogin,
            repositoryName: repository.repository.name,
            plan: repository.plan,
            confirmedCatalog: repository.confirmedCatalog
          }))
        })
        wakeMutationQueueNonBlocking(services)
        return successResponse(await getDashboardState(services))
      }
      case 'cancel-mutation-job': {
        const active = await services.authSession.loadActive()
        if (!active || active.identity.githubUserId !== active.githubUserId) {
          return failureResponse(authenticationRequired())
        }
        const job = await getMutationJob(
          services.database,
          active.githubUserId,
          request.value.jobId
        )
        if (!job || job.status !== 'queued') {
          return failureResponse({
            category: 'validation',
            message: 'Only a queued operation can be cancelled before remote execution.',
            retryable: false
          })
        }
        await cancelQueuedMutationJob(
          services.database,
          active.githubUserId,
          request.value.jobId,
          `history-${crypto.randomUUID()}`,
          new Date().toISOString()
        )
        return successResponse(await getDashboardState(services))
      }
      case 'export-data': {
        const active = await services.authSession.loadActive()
        if (!active) return failureResponse(authenticationRequired())
        return successResponse(
          await services.portability.exportNamespace(active.githubUserId)
        )
      }
      case 'preview-import': {
        const active = await services.authSession.loadActive()
        if (!active) return failureResponse(authenticationRequired())
        return successResponse(
          await services.portability.previewImport(
            active.githubUserId,
            request.value.document,
            request.value.replaceSettings
          )
        )
      }
      case 'apply-import': {
        const active = await services.authSession.loadActive()
        if (!active) return failureResponse(authenticationRequired())
        const impact = await services.portability.applyImport(
          active.githubUserId,
          request.value.document,
          request.value.replaceSettings
        )
        await services.triage.refreshBadge(active.githubUserId)
        return successResponse(impact)
      }
      case 'clear-all-data':
        await services.mutationQueue.pause()
        try {
          services.writeAuthController.resetAfterCompleteRemoval()
          await services.authController.disconnect()
          await clearAllLibraryData(services.database)
          await clearLocalStorage()
          await setToolbarBadge('')
          return successResponse(services.authController.resetAfterCompleteRemoval())
        } finally {
          services.mutationQueue.resume()
        }
      default:
        return failureResponse({
          category: 'unsupported',
          message: 'This action is not available yet.',
          retryable: false
        })
    }
  } catch (error: unknown) {
    return failureResponse(sanitizeError(error))
  }
})

interface RuntimeServices {
  readonly database: IDBDatabase
  readonly authController: AuthController
  readonly writeAuthController: WriteAuthController
  readonly authSession: AuthSession
  readonly starSync: StarSyncService
  readonly nativeListSync: NativeListSyncService
  readonly triage: TriageService
  readonly portability: DataPortabilityService
  readonly mutationQueue: MutationQueueRunner
  readonly membershipObserver: NativeListMembershipObservationService
}

async function createRuntimeServices(): Promise<RuntimeServices> {
  const database = await openLibraryDatabase()
  const store = new BrowserAuthStore(database)
  const writeStore = new BrowserWriteAuthStore(database, store)
  const deviceFlow = new GitHubDeviceFlow({clientId: githubClientId ?? ''})
  const writeDeviceFlow = new GitHubWriteDeviceFlow({
    clientId: githubWriteClientId ?? ''
  })
  const authController = new AuthController(deviceFlow, store)
  const writeAuthController = new WriteAuthController(
    writeDeviceFlow,
    store,
    writeStore
  )
  const authSession = new AuthSession({store, refresher: deviceFlow})
  const restClient = new GitHubRestClient(authSession)
  const starringWriteSession = new StarringWriteSession({
    authStore: store,
    writeStore
  })
  const safeUnstar = new SafeUnstarService({
    authStore: store,
    writeSession: starringWriteSession,
    starObserver: restClient
  })
  const graphqlClient = new GitHubGraphqlClient(authSession)
  const membershipWriter = new ListMembershipWriteSession({
    authStore: store,
    writeStore
  })
  const membershipObserver = new NativeListMembershipObservationService({
    reader: graphqlClient
  })
  const mutationQueue = new MutationQueueRunner({
    database,
    authStore: store,
    service: safeUnstar,
    membershipService: {
      observer: membershipObserver,
      writer: membershipWriter
    },
    scheduleWake: async (nextExecutionAt) => {
      if (nextExecutionAt === null) {
        await clearBrowserAlarm(mutationQueueAlarmName)
        return
      }
      await createBrowserAlarm(
        mutationQueueAlarmName,
        Math.max(Date.now(), Date.parse(nextExecutionAt))
      )
    }
  })
  const starSync = new StarSyncService({database, observer: restClient})
  const nativeListSync = new NativeListSyncService({
    database,
    reader: graphqlClient
  })
  const triage = new TriageService({database})
  const portability = new DataPortabilityService(database)
  return {
    database,
    authController,
    writeAuthController,
    authSession,
    starSync,
    nativeListSync,
    triage,
    portability,
    mutationQueue,
    membershipObserver
  }
}

function wakeMutationQueue(): void {
  void runtimeServices
    .then((services) => services.mutationQueue.check())
    .catch((error: unknown) => {
      console.error('Unable to resume the mutation queue', safeLogMessage(error))
    })
}

function checkQueueOnAuthenticatedInteraction(services: RuntimeServices): void {
  void services.authSession
    .loadActive()
    .then((active) => (active ? services.mutationQueue.check() : undefined))
    .catch((error: unknown) => {
      console.error('Unable to check the mutation queue', safeLogMessage(error))
    })
}

function wakeMutationQueueNonBlocking(services: RuntimeServices): void {
  void services.mutationQueue.check().catch((error: unknown) => {
    console.error('Unable to start the mutation queue', safeLogMessage(error))
  })
}

function wakesMutationQueue(type: string): boolean {
  return (
    type === 'get-app-state' ||
    type === 'show-write-auth-preview' ||
    type === 'start-write-device-auth' ||
    type === 'cancel-write-device-auth' ||
    type === 'start-sync' ||
    type === 'update-annotation' ||
    type === 'export-data' ||
    type === 'preview-import' ||
      type === 'apply-import'
  )
}

function authenticationRequired() {
  return {
    category: 'authentication' as const,
    message: 'Connect GitHub to use local data portability.',
    retryable: false
  }
}

async function getDashboardState(services: RuntimeServices): Promise<AppState> {
  const authState = await services.authController.getState()
  const writeAuthorization = await services.writeAuthController.getState()
  const nativeListMembership = {
    readiness: !membershipWriteCapabilityProven
      ? 'capability-unproven' as const
      : writeAuthorization.membershipReady
        ? 'ready' as const
        : 'write-authorization-required' as const
  }
  const githubUserId = authState.identity?.githubUserId
  if (!githubUserId) {
    return {
      ...authState,
      writeAuthorization,
      nativeListMembership,
      sync: null,
      nativeListSync: null,
      triageCounts: null,
      library: null,
      mutations: null
    }
  }
  const [
    sync,
    nativeListSync,
    triageCounts,
    repositories,
    nativeLists,
    nativeMemberships,
    annotations,
    mutationBatches,
    mutationJobs,
    operationHistory
  ] = await Promise.all([
    getSyncState(services.database, githubUserId, 'stars'),
    getSyncState(services.database, githubUserId, 'native-lists'),
    services.triage.refreshBadge(githubUserId),
    listRepositories(services.database, githubUserId),
    listNativeLists(services.database, githubUserId),
    listNativeMemberships(services.database, githubUserId),
    listAnnotations(services.database, githubUserId),
    listMutationBatches(services.database, githubUserId),
    listMutationJobs(services.database, githubUserId),
    listOperationHistory(services.database, githubUserId)
  ])
  return {
    ...authState,
    writeAuthorization,
    nativeListMembership,
    sync,
    nativeListSync,
    triageCounts,
    library: {repositories, nativeLists, nativeMemberships, annotations},
    mutations: {
      batches: mutationBatches,
      jobs: mutationJobs,
      history: operationHistory
    }
  }
}

interface StoredMembershipPreviewRepository {
  readonly repository: RepositoryRecord
  readonly plan: MembershipIntentPlan
  readonly confirmedCatalog: CanonicalListCatalogFingerprint
}

interface StoredMembershipPreview {
  readonly githubUserId: string
  readonly createdAt: number
  readonly repositories: readonly StoredMembershipPreviewRepository[]
}

async function requireMembershipMutationAccount(services: RuntimeServices) {
  const active = await services.authSession.loadActive()
  if (!active || active.identity.githubUserId !== active.githubUserId) {
    throw new AppFailure({
      category: 'authentication',
      message: 'Connect GitHub before changing native List membership.',
      retryable: false
    })
  }
  if (!membershipWriteCapabilityProven) {
    throw new AppFailure({
      category: 'unsupported',
      message: 'Native List membership writes have not passed the disposable capability probe in this build.',
      retryable: false
    })
  }
  const writeAuthorization = await services.writeAuthController.getState()
  if (!writeAuthorization.membershipReady) {
    throw new AppFailure({
      category: 'authentication',
      message: 'Authorize GitHub native List membership changes before continuing.',
      retryable: true
    })
  }
  return active
}

async function previewMembershipOperation(
  services: RuntimeServices,
  githubUserId: string,
  repositoryNodeIds: readonly string[],
  operation: MembershipOperationSelection,
  refreshedFromJobId: string | null
): Promise<MembershipPreviewResponse> {
  const intents = repositoryNodeIds.map((repositoryNodeId) =>
    membershipIntent(githubUserId, repositoryNodeId, operation)
  )
  return previewMembershipIntents(
    services,
    githubUserId,
    intents,
    refreshedFromJobId
  )
}

async function previewMembershipIntents(
  services: RuntimeServices,
  githubUserId: string,
  intents: readonly NativeListMembershipIntent[],
  refreshedFromJobId: string | null
): Promise<MembershipPreviewResponse> {
  const repositories = await listRepositories(services.database, githubUserId)
  const repositoryById = new Map(
    repositories.map((repository) => [repository.repositoryNodeId, repository])
  )
  for (const intent of intents) {
    const repository = repositoryById.get(intent.repositoryNodeId)
    if (!repository?.isStarred) {
      throw new AppFailure({
        category: 'validation',
        message: 'Refresh the library before changing membership for these repositories.',
        retryable: true
      })
    }
  }

  const outcome = await services.membershipObserver.previewBatch(githubUserId, intents)
  if (outcome.status === 'invalid-intent') {
    return {
      status: 'invalid-source',
      repositoryNodeId: outcome.repositoryNodeId,
      sourceListNodeId: outcome.sourceListNodeId,
      message: 'The selected move source is not a current membership. Refresh or choose a current source List.'
    }
  }
  if (outcome.status !== 'stable') {
    return {
      status: outcome.status,
      attempts: outcome.attempts,
      message: membershipObservationMessage(outcome.status),
      retryAt: outcome.status === 'rate-limited' ? outcome.rateLimit.resetAt : null
    }
  }

  const missingListIds = outcome.observation.repositories.flatMap((repository) =>
    repository.relevantCatalog.entries.flatMap((entry) =>
      entry.exists ? [] : [entry.listNodeId]
    )
  )
  if (missingListIds.length > 0) {
    return {
      status: 'invalid-list',
      listNodeIds: [...new Set(missingListIds)].sort(),
      message: 'A referenced native List was deleted or is unavailable. Choose an existing List and preview again.'
    }
  }

  const nativeLists = await listNativeLists(services.database, githubUserId)
  const listById = new Map(nativeLists.map((list) => [list.listNodeId, list]))
  const observedByRepository = new Map(
    outcome.observation.repositories.map((repository) => [
      repository.repositoryNodeId,
      repository
    ])
  )
  const storedRepositories = outcome.previews.map((plan) => {
    const repository = repositoryById.get(plan.repositoryNodeId)
    const observed = observedByRepository.get(plan.repositoryNodeId)
    if (!repository || !observed) {
      throw new AppFailure({
        category: 'validation',
        message: 'The membership preview did not cover every selected repository.',
        retryable: true
      })
    }
    return {
      repository,
      plan,
      confirmedCatalog: observed.relevantCatalog
    }
  })
  const previewId = `membership-preview-${crypto.randomUUID()}`
  membershipPreviews.set(previewId, {
    githubUserId,
    createdAt: Date.now(),
    repositories: storedRepositories
  })
  pruneMembershipPreviews()

  return {
    status: 'stable',
    previewId,
    operation: intents[0]?.kind ?? 'add',
    nonAtomic: true,
    attempts: outcome.observation.attempts,
    captureInterval: outcome.observation.captureInterval,
    repositories: storedRepositories.map(({repository, plan, confirmedCatalog}) =>
      membershipRepositoryPreview(repository, plan, confirmedCatalog, listById)
    ),
    refreshedFromJobId
  }
}

function membershipIntent(
  githubUserId: string,
  repositoryNodeId: string,
  operation: MembershipOperationSelection
): NativeListMembershipIntent {
  if (operation.kind === 'add') {
    return {kind: operation.kind, githubUserId, repositoryNodeId, additions: operation.listNodeIds}
  }
  if (operation.kind === 'remove') {
    return {kind: operation.kind, githubUserId, repositoryNodeId, removals: operation.listNodeIds}
  }
  return {
    kind: operation.kind,
    githubUserId,
    repositoryNodeId,
    sourceListNodeId: operation.sourceListNodeId,
    destinationListNodeId: operation.destinationListNodeId
  }
}

function membershipRepositoryPreview(
  repository: RepositoryRecord,
  plan: MembershipIntentPlan,
  confirmedCatalog: CanonicalListCatalogFingerprint,
  listById: ReadonlyMap<string, Awaited<ReturnType<typeof listNativeLists>>[number]>
): MembershipRepositoryPreview {
  const relevant = new Map(
    confirmedCatalog.entries.map((entry) => [entry.listNodeId, entry])
  )
  const items = (listNodeIds: readonly string[]): readonly MembershipListPreviewItem[] =>
    listNodeIds.map((listNodeId) => {
      const catalog = listById.get(listNodeId)
      const reference = relevant.get(listNodeId)
      return {
        listNodeId,
        name: reference?.exists
          ? reference.name
          : catalog?.name ?? `List ${listNodeId}`,
        visibility: reference?.exists
          ? reference.visibility
          : catalog?.visibility ?? 'unknown',
        exists: reference?.exists ?? catalog !== undefined
      }
    })
  return {
    repositoryNodeId: repository.repositoryNodeId,
    fullName: repository.fullName,
    current: items(plan.before.listNodeIds),
    resulting: items(plan.desired.listNodeIds),
    added: items(plan.added),
    removed: items(plan.removed),
    unchanged: items(plan.unchanged),
    noOps: items(plan.noOpListNodeIds),
    createsJob: plan.added.length > 0 || plan.removed.length > 0
  }
}

function membershipObservationMessage(
  status: Exclude<MembershipPreviewResponse['status'], 'stable' | 'invalid-source' | 'invalid-list'>
): string {
  if (status === 'changing') {
    return 'GitHub membership changed between complete observations and did not stabilize.'
  }
  if (status === 'partial') {
    return 'The native List observation was incomplete, so absence cannot be inferred safely.'
  }
  if (status === 'rate-limited') {
    return 'GitHub rate-limited the membership observation. No mutation was queued.'
  }
  if (status === 'unavailable') {
    return 'GitHub native List membership is unavailable. Imported Lists remain read-only.'
  }
  return 'The membership observation was interrupted. No mutation was queued.'
}

function pruneMembershipPreviews(): void {
  const expiredBefore = Date.now() - membershipPreviewLifetimeMs
  for (const [previewId, preview] of membershipPreviews) {
    if (preview.createdAt < expiredBefore) membershipPreviews.delete(previewId)
  }
}
