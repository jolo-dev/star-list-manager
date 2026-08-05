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
  enqueueMutationBatch,
  getMutationJob,
  listMutationBatches,
  listMutationJobs,
  listOperationHistory
} from './storage/mutations'
import type {AppState} from './shared/messages'
import {TriageService} from './triage/service'
import {DataPortabilityService} from './import/service'
import {StarringWriteSession} from './github/starring-write-session'
import {SafeUnstarService} from './github/safe-unstar-service'
import {MutationQueueRunner} from './mutations/runner'
import {
  mutationQueueAlarmName,
  registerMutationQueueWakeEvents
} from './mutations/wake'
import {safeLogMessage} from './shared/logging'

const githubClientId = import.meta.env.EXTENSION_PUBLIC_GITHUB_CLIENT_ID
const githubWriteClientId =
  import.meta.env.EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID
const runtimeServices = createRuntimeServices()

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
            message: 'GitHub Starring authorization is not configured in this build.',
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
  const mutationQueue = new MutationQueueRunner({
    database,
    authStore: store,
    service: safeUnstar,
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
  const graphqlClient = new GitHubGraphqlClient(authSession)
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
    mutationQueue
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
  const githubUserId = authState.identity?.githubUserId
  if (!githubUserId) {
    return {
      ...authState,
      writeAuthorization,
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
