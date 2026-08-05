interface DeviceCodeResponse {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresInSeconds: number
  readonly intervalSeconds: number
}

export {}

interface TokenResponse {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresInSeconds: number
  readonly refreshTokenExpiresInSeconds: number
}

interface GitHubIdentity {
  readonly login: string
  readonly nodeId: string
}

interface RepositoryFixture {
  readonly owner: string
  readonly name: string
  readonly nodeId: string
}

interface CreatedList {
  readonly id: string
  readonly name: string
}

const apiHeaders = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2026-03-10'
} as const

const clientId = Bun.env.EXTENSION_PUBLIC_GITHUB_CLIENT_ID
if (!clientId) {
  throw new Error(
    'Set EXTENSION_PUBLIC_GITHUB_CLIENT_ID in .env.local before running the spike.'
  )
}

const mutationRepositoryArgument = Bun.argv.find((argument) =>
  argument.startsWith('--mutation-repo=')
)
const usesPrestarredFixture = Bun.argv.includes('--prestarred-fixture')
const existingListArgument = Bun.argv.find((argument) =>
  argument.startsWith('--existing-list-id=')
)
const usesEmptyMembershipProbe = Bun.argv.includes('--empty-membership-probe')

const device = await requestDeviceCode(clientId)
console.log(`Open ${device.verificationUri} and enter code ${device.userCode}`)
console.log('Waiting for GitHub authorization...')

const initialToken = await pollForToken(clientId, device)
const token = await refreshToken(clientId, initialToken.refreshToken)
const identity = await fetchIdentity(token.accessToken)
const starCount = await probeStars(token.accessToken)
const listCount = await probeLists(token.accessToken)

console.log(`Authenticated GitHub user: ${identity.login}`)
console.log(`Public star endpoint returned ${starCount} item(s) on the probe page`)
console.log(`Native List query reported ${listCount} List(s)`)
console.log('Device-flow token refresh succeeded without a client secret')

if (mutationRepositoryArgument) {
  const repositoryName = mutationRepositoryArgument.slice(
    '--mutation-repo='.length
  )
  await probeListMutation(
    token.accessToken,
    repositoryName,
    usesPrestarredFixture,
    existingListArgument?.slice('--existing-list-id='.length) ?? null,
    usesEmptyMembershipProbe
  )
  console.log('Disposable native List mutation and cleanup succeeded')
} else {
  console.log(
    'Read-only capability spike complete. Add --mutation-repo=owner/name to run the disposable write probe.'
  )
}

async function requestDeviceCode(clientIdValue: string): Promise<DeviceCodeResponse> {
  const value = await postForm('https://github.com/login/device/code', {
    client_id: clientIdValue
  })
  const record = requireRecord(value, 'device-code response')

  return {
    deviceCode: requireString(record, 'device_code'),
    userCode: requireString(record, 'user_code'),
    verificationUri: requireString(record, 'verification_uri'),
    expiresInSeconds: requireNumber(record, 'expires_in'),
    intervalSeconds: requireNumber(record, 'interval')
  }
}

async function pollForToken(
  clientIdValue: string,
  device: DeviceCodeResponse
): Promise<TokenResponse> {
  const deadline = Date.now() + device.expiresInSeconds * 1000
  let intervalSeconds = device.intervalSeconds

  while (Date.now() < deadline) {
    await Bun.sleep(intervalSeconds * 1000)
    const value = await postForm('https://github.com/login/oauth/access_token', {
      client_id: clientIdValue,
      device_code: device.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    const record = requireRecord(value, 'device token response')
    const accessToken = optionalString(record, 'access_token')

    if (accessToken) return decodeToken(record, accessToken)

    const error = requireString(record, 'error')
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      intervalSeconds += 5
      continue
    }
    throw new Error(`Device authorization failed: ${error}`)
  }

  throw new Error('Device authorization expired before approval.')
}

async function refreshToken(
  clientIdValue: string,
  refreshTokenValue: string
): Promise<TokenResponse> {
  const value = await postForm('https://github.com/login/oauth/access_token', {
    client_id: clientIdValue,
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue
  })
  const record = requireRecord(value, 'refresh response')
  const error = optionalString(record, 'error')
  if (error) throw new Error(`Token refresh failed: ${error}`)
  return decodeToken(record, requireString(record, 'access_token'))
}

async function fetchIdentity(accessToken: string): Promise<GitHubIdentity> {
  const value = await githubJson('https://api.github.com/user', accessToken)
  const record = requireRecord(value, 'user response')
  return {
    login: requireString(record, 'login'),
    nodeId: requireString(record, 'node_id')
  }
}

async function probeStars(accessToken: string): Promise<number> {
  const response = await fetch('https://api.github.com/user/starred?per_page=1', {
    headers: {
      ...apiHeaders,
      accept: 'application/vnd.github.star+json',
      authorization: `Bearer ${accessToken}`
    }
  })
  const value = await readJson(response)
  if (!response.ok) throw new Error(`Star probe failed with ${response.status}`)
  if (!Array.isArray(value)) throw new Error('Star probe returned a non-array payload.')
  return value.length
}

async function probeLists(accessToken: string): Promise<number> {
  const value = await graphql(
    accessToken,
    'query CapabilityProbe { viewer { lists(first: 1) { totalCount } } }'
  )
  const root = requireRecord(value, 'GraphQL response')
  const data = requireRecord(root.data, 'GraphQL data')
  const viewer = requireRecord(data.viewer, 'GraphQL viewer')
  const lists = requireRecord(viewer.lists, 'GraphQL lists')
  return requireNumber(lists, 'totalCount')
}

async function probeListMutation(
  accessToken: string,
  repositoryName: string,
  prestarredFixture: boolean,
  existingListId: string | null,
  emptyMembershipProbe: boolean
): Promise<void> {
  const repository = await loadDisposableRepository(accessToken, repositoryName)
  const initiallyStarred = await isStarred(
    accessToken,
    repository.owner,
    repository.name
  )
  if (initiallyStarred && !prestarredFixture) {
    throw new Error(
      `${repository.owner}/${repository.name} is already starred. Choose an unstarred disposable repository.`
    )
  }
  if (!initiallyStarred && prestarredFixture) {
    throw new Error('The pre-starred disposable fixture is not currently starred.')
  }

  let createdList: CreatedList | null = null
  let listCreatedByScript = false
  let starAdded = false

  try {
    if (!prestarredFixture) {
      await setStarred(accessToken, repository, true)
      starAdded = true
    }
    if (emptyMembershipProbe) {
      const resultingListIds = await updateMemberships(
        accessToken,
        repository.nodeId,
        []
      )
      if (resultingListIds.length !== 0) {
        throw new Error('Empty membership mutation returned unexpected Lists.')
      }
      await assertRepositoryHasNoMemberships(accessToken, repository.nodeId)
      return
    }
    if (existingListId) {
      createdList = {id: existingListId, name: 'external disposable List'}
    } else {
      createdList = await createDisposableList(accessToken)
      listCreatedByScript = true
    }

    await updateMemberships(accessToken, repository.nodeId, [createdList.id])
    await assertListContains(accessToken, createdList.id, repository.nodeId, true)

    await updateMemberships(accessToken, repository.nodeId, [])
    await assertListContains(accessToken, createdList.id, repository.nodeId, false)
  } finally {
    if (createdList && !listCreatedByScript) {
      await updateMemberships(accessToken, repository.nodeId, []).catch(
        () => undefined
      )
    }
    if (createdList && listCreatedByScript) {
      await deleteList(accessToken, createdList.id).catch(() => undefined)
    }
    if (starAdded) {
      await setStarred(accessToken, repository, false).catch(() => undefined)
    }
  }
}

async function loadDisposableRepository(
  accessToken: string,
  repositoryName: string
): Promise<RepositoryFixture> {
  const [owner, name, extra] = repositoryName.split('/')
  if (!owner || !name || extra) {
    throw new Error('Mutation repository must use owner/name format.')
  }

  const value = await githubJson(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    accessToken
  )
  const record = requireRecord(value, 'repository response')
  if (record.private !== false) {
    throw new Error('Mutation repository must be public.')
  }

  return {owner, name, nodeId: requireString(record, 'node_id')}
}

async function isStarred(
  accessToken: string,
  owner: string,
  name: string
): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {headers: {...apiHeaders, authorization: `Bearer ${accessToken}`}}
  )
  if (response.status === 204) return true
  if (response.status === 404) return false
  throw new Error(`Star status check failed with ${response.status}`)
}

async function setStarred(
  accessToken: string,
  repository: RepositoryFixture,
  starred: boolean
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/user/starred/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
    {
      method: starred ? 'PUT' : 'DELETE',
      headers: {...apiHeaders, authorization: `Bearer ${accessToken}`}
    }
  )
  if (response.status !== 204) {
    throw new Error(`Disposable star update failed with ${response.status}`)
  }
}

async function createDisposableList(accessToken: string): Promise<CreatedList> {
  const value = await graphql(
    accessToken,
    `mutation CreateCapabilityList($name: String!) {
      createUserList(input: {
        name: $name,
        description: "Temporary Star List Manager capability fixture",
        isPrivate: true
      }) {
        list { id name }
      }
    }`,
    {name: `Star List Manager capability ${Date.now()}`}
  )
  const root = requireRecord(value, 'create List response')
  const data = requireRecord(root.data, 'create List data')
  const payload = requireRecord(data.createUserList, 'create List payload')
  const list = requireRecord(payload.list, 'created List')
  return {id: requireString(list, 'id'), name: requireString(list, 'name')}
}

async function updateMemberships(
  accessToken: string,
  repositoryNodeId: string,
  listIds: readonly string[]
): Promise<readonly string[]> {
  const value = await graphql(
    accessToken,
    `mutation UpdateCapabilityMemberships($itemId: ID!, $listIds: [ID!]!) {
      updateUserListsForItem(input: {itemId: $itemId, listIds: $listIds}) {
        lists { id }
      }
    }`,
    {itemId: repositoryNodeId, listIds}
  )
  const root = requireRecord(value, 'update membership response')
  const data = requireRecord(root.data, 'update membership data')
  const payload = requireRecord(
    data.updateUserListsForItem,
    'update membership payload'
  )
  return requireArray(payload, 'lists').map((list) => {
    const record = requireRecord(list, 'updated membership List')
    return requireString(record, 'id')
  })
}

async function assertRepositoryHasNoMemberships(
  accessToken: string,
  repositoryNodeId: string
): Promise<void> {
  const value = await graphql(
    accessToken,
    'query CapabilityLists { viewer { lists(first: 100) { nodes { id } } } }'
  )
  const root = requireRecord(value, 'List catalog response')
  const data = requireRecord(root.data, 'List catalog data')
  const viewer = requireRecord(data.viewer, 'List catalog viewer')
  const lists = requireRecord(viewer.lists, 'List catalog')
  const listIds = requireArray(lists, 'nodes').map((list) => {
    const record = requireRecord(list, 'List catalog item')
    return requireString(record, 'id')
  })

  for (const listId of listIds) {
    let cursor: string | null = null
    do {
      const page = await graphql(
        accessToken,
        `query CapabilityListItems($listId: ID!, $after: String) {
          node(id: $listId) {
            ... on UserList {
              items(first: 100, after: $after) {
                nodes { ... on Repository { id } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        {listId, after: cursor}
      )
      const pageRoot = requireRecord(page, 'List item response')
      const pageData = requireRecord(pageRoot.data, 'List item data')
      const node = requireRecord(pageData.node, 'List item node')
      const items = requireRecord(node.items, 'List item connection')
      const containsRepository = requireArray(items, 'nodes').some((item) => {
        const record = requireRecord(item, 'List repository')
        return record.id === repositoryNodeId
      })
      if (containsRepository) {
        throw new Error('Disposable repository unexpectedly belongs to a List.')
      }
      const pageInfo = requireRecord(items.pageInfo, 'List item page info')
      const hasNextPage = pageInfo.hasNextPage === true
      cursor = hasNextPage ? requireString(pageInfo, 'endCursor') : null
    } while (cursor)
  }
}

async function assertListContains(
  accessToken: string,
  listId: string,
  repositoryNodeId: string,
  expected: boolean
): Promise<void> {
  const value = await graphql(
    accessToken,
    `query VerifyCapabilityMembership($listId: ID!) {
      node(id: $listId) {
        ... on UserList {
          items(first: 100) {
            nodes { ... on Repository { id } }
          }
        }
      }
    }`,
    {listId}
  )
  const root = requireRecord(value, 'membership verification response')
  const data = requireRecord(root.data, 'membership verification data')
  const node = requireRecord(data.node, 'membership verification List')
  const items = requireRecord(node.items, 'membership verification items')
  const nodes = requireArray(items, 'nodes')
  const contains = nodes.some((item) => {
    const record = requireRecord(item, 'membership repository')
    return record.id === repositoryNodeId
  })
  if (contains !== expected) {
    throw new Error('Native List membership read-back did not match the mutation.')
  }
}

async function deleteList(accessToken: string, listId: string): Promise<void> {
  const value = await graphql(
    accessToken,
    `mutation DeleteCapabilityList($listId: ID!) {
      deleteUserList(input: {listId: $listId}) { clientMutationId }
    }`,
    {listId}
  )
  const root = requireRecord(value, 'delete List response')
  if ('errors' in root) throw new Error('Failed to delete the disposable List.')
}

async function graphql(
  accessToken: string,
  query: string,
  variables: Readonly<Record<string, unknown>> = {}
): Promise<unknown> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      ...apiHeaders,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({query, variables})
  })
  const value = await readJson(response)
  if (!response.ok) throw new Error(`GraphQL request failed with ${response.status}`)
  const root = requireRecord(value, 'GraphQL response')
  if (Array.isArray(root.errors)) {
    const messages = root.errors.map((error) => {
      const record = requireRecord(error, 'GraphQL error')
      return optionalString(record, 'message') ?? 'Unknown GraphQL error'
    })
    throw new Error(`GraphQL rejected the request: ${messages.join('; ')}`)
  }
  return value
}

async function githubJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {...apiHeaders, authorization: `Bearer ${accessToken}`}
  })
  const value = await readJson(response)
  if (!response.ok) throw new Error(`GitHub request failed with ${response.status}`)
  return value
}

async function postForm(
  url: string,
  values: Readonly<Record<string, string>>
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(values)
  })
  const value = await readJson(response)
  if (!response.ok) throw new Error(`GitHub login request failed with ${response.status}`)
  return value
}

async function readJson(response: Response): Promise<unknown> {
  return (await response.json()) as unknown
}

function decodeToken(
  record: Readonly<Record<string, unknown>>,
  accessToken: string
): TokenResponse {
  return {
    accessToken,
    refreshToken: requireString(record, 'refresh_token'),
    expiresInSeconds: requireNumber(record, 'expires_in'),
    refreshTokenExpiresInSeconds: requireNumber(
      record,
      'refresh_token_expires_in'
    )
  }
}

function requireRecord(
  value: unknown,
  label: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`)
  }
  return value as Readonly<Record<string, unknown>>
}

function requireArray(
  record: Readonly<Record<string, unknown>>,
  key: string
): readonly unknown[] {
  const value = record[key]
  if (!Array.isArray(value)) throw new Error(`Missing array field ${key}.`)
  return value
}


function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing string field ${key}.`)
  }
  return value
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireNumber(
  record: Readonly<Record<string, unknown>>,
  key: string
): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing number field ${key}.`)
  }
  return value
}
