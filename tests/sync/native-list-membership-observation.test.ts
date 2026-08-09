import {describe, expect, test} from 'bun:test'
import type {
  NativeListCapability,
  NativeListCatalogPage,
  NativeListItemsPage
} from '../../src/github/graphql-client'
import type {NativeListReader} from '../../src/sync/native-list-sync'
import {
  NativeListMembershipObservationService,
  type SelectedRepositoryObservationTarget
} from '../../src/sync/native-list-membership-observation'
import {AppFailure, validationFailure} from '../../src/shared/errors'

const githubUserId = '42'
const selectedRepository = 'R_selected'
const rateLimit = {limit: 5_000, remaining: 4_999, resetAt: null}
const target: SelectedRepositoryObservationTarget = {
  repositoryNodeId: selectedRepository,
  relevantListNodeIds: ['L_a']
}

describe('native List membership observations', () => {
  test('requires two complete matching non-atomic observations', async () => {
    const reader = new ScriptedReader([
      fixture({'L_a': [items(1, [selectedRepository])]}),
      fixture({'L_a': [items(1, [selectedRepository])]})
    ])
    const times = clock()
    const service = new NativeListMembershipObservationService({
      reader,
      now: times.now
    })

    const result = await service.observeSelected(githubUserId, [target])
    expect(result.status).toBe('stable')
    if (result.status !== 'stable') return
    expect(result.attempts).toBe(2)
    expect(result.observations).toHaveLength(2)
    expect(result.observations.every((value) => value.nonAtomic)).toBeTrue()
    expect(result.observations.every((value) => value.completeness === 'complete')).toBeTrue()
    expect(result.repositories[0]?.observed.listNodeIds).toEqual(['L_a'])
    expect(result.captureInterval).toEqual({
      startedAt: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-08T00:00:03.000Z'
    })
  })

  test('reports membership changes during item pagination as changing', async () => {
    const reader = new ScriptedReader([
      fixture({
        'L_a': [
          items(2, ['R_other'], true, 'items-a'),
          items(2, [selectedRepository])
        ]
      }),
      fixture({
        'L_a': [
          items(2, ['R_other'], true, 'items-b'),
          items(2, ['R_replacement'])
        ]
      })
    ])
    const result = await observe(reader, [target], 2)
    expect(result.status).toBe('changing')
    if (result.status !== 'changing') return
    expect(result.observations.map((value) => value.repositories[0]?.observed.listNodeIds)).toEqual([
      ['L_a'],
      []
    ])
  })

  test('reports persistent consecutive mismatches as changing', async () => {
    const result = await observe(
      new ScriptedReader([
        fixture({'L_a': [items(1, [selectedRepository])]}),
        fixture({'L_a': [items(1, ['R_other'])]}),
        fixture({'L_a': [items(1, [selectedRepository])]})
      ]),
      [target],
      3
    )
    expect(result.status).toBe('changing')
    expect(result.attempts).toBe(3)
  })

  test('accepts eventual stability only after consecutive matches', async () => {
    const result = await observe(
      new ScriptedReader([
        fixture({'L_a': [items(1, ['R_other'])]}),
        fixture({'L_a': [items(1, [selectedRepository])]}),
        fixture({'L_a': [items(1, [selectedRepository])]})
      ]),
      [target],
      3
    )
    expect(result.status).toBe('stable')
    if (result.status !== 'stable') return
    expect(result.attempts).toBe(3)
    expect(result.repositories[0]?.observed.listNodeIds).toEqual(['L_a'])
  })

  test('uses independent item cursors and observes multiple memberships', async () => {
    const captures = [multiListCapture(), multiListCapture()]
    const reader = new ScriptedReader(captures)
    const result = await observe(
      reader,
      [{repositoryNodeId: selectedRepository, relevantListNodeIds: ['L_b', 'L_a']}]
    )
    expect(result.status).toBe('stable')
    if (result.status !== 'stable') return
    expect(result.repositories[0]?.observed.listNodeIds).toEqual(['L_a', 'L_b'])
    expect(reader.itemCalls).toEqual([
      ['L_a', null],
      ['L_a', 'a-next'],
      ['L_b', null],
      ['L_b', 'b-next'],
      ['L_a', null],
      ['L_a', 'a-next'],
      ['L_b', null],
      ['L_b', 'b-next']
    ])
  })

  test('does not expose partial absence when inaccessible items are omitted', async () => {
    const result = await observe(
      new ScriptedReader([
        fixture({'L_a': [items(2, ['R_accessible'])]})
      ]),
      [target]
    )
    expect(result.status).toBe('partial')
    expect('repositories' in result).toBeFalse()
  })

  test('detects a deleted relevant List through membership and catalog fingerprints', async () => {
    const result = await observe(
      new ScriptedReader([
        fixture({'L_a': [items(1, [selectedRepository])]}),
        fixture({})
      ]),
      [target],
      2
    )
    expect(result.status).toBe('changing')
    if (result.status !== 'changing') return
    const first = result.observations[0]?.repositories[0]
    const second = result.observations[1]?.repositories[0]
    expect(first?.relevantCatalog.entries[0]?.exists).toBeTrue()
    expect(second?.relevantCatalog.entries[0]?.exists).toBeFalse()
    expect(first?.relevantCatalog.fingerprint).not.toBe(second?.relevantCatalog.fingerprint)
  })

  test('requires relevant List names and visibility to match across captures', async () => {
    for (const [name, metadata] of [
      ['rename', {name: 'Renamed List'}],
      ['visibility', {isPrivate: true}]
    ] as const) {
      const first = fixture({'L_a': [items(1, [selectedRepository])]})
      const changed = fixture({'L_a': [items(1, [selectedRepository])]})
      changed.catalog[0]?.lists.forEach((entry) => Object.assign(entry, metadata))

      const result = await observe(new ScriptedReader([first, changed]), [target], 2)

      expect(result.status, name).toBe('changing')
      if (result.status !== 'changing') continue
      const before = result.observations[0]?.repositories[0]
      const after = result.observations[1]?.repositories[0]
      expect(before?.observed.fingerprint, name).toBe(after?.observed.fingerprint)
      expect(before?.relevantCatalog.fingerprint, name).not.toBe(
        after?.relevantCatalog.fingerprint
      )
    }
  })

  test('reports interrupted scans without returning observed membership', async () => {
    const reader = new ScriptedReader([
      fixture(
        {'L_a': [items(1, [selectedRepository])]},
        {
          itemError: new AppFailure({
            category: 'network',
            message: 'Connection interrupted.',
            retryable: true
          })
        }
      )
    ])
    const result = await observe(reader, [target])
    expect(result.status).toBe('interrupted')
    expect('repositories' in result).toBeFalse()
  })

  test('reports an aborted scan as interrupted', async () => {
    const controller = new AbortController()
    controller.abort()
    const reader = new ScriptedReader([fixture({})])
    const service = new NativeListMembershipObservationService({reader})
    const result = await service.observeSelected(githubUserId, [target], controller.signal)
    expect(result.status).toBe('interrupted')
    expect(reader.probeCalls).toBe(0)
  })

  test('reports malformed pages as partial without using their absence', async () => {
    const malformedCursor = await observe(
      new ScriptedReader([
        fixture({'L_a': [items(1, [selectedRepository], true, null)]})
      ]),
      [target]
    )
    expect(malformedCursor.status).toBe('partial')
    expect('repositories' in malformedCursor).toBeFalse()

    const malformedPayload = await observe(
      new ScriptedReader([
        fixture({'L_a': [items(1, [selectedRepository])]}, {
          catalogError: validationFailure('GitHub returned a malformed catalog page.')
        })
      ]),
      [target]
    )
    expect(malformedPayload.status).toBe('partial')
  })

  test('reports catalog pagination changes as partial', async () => {
    const first = catalog([list('L_a', 0)], true, 'catalog-next', 1)
    const second = catalog([], false, null, 0)
    const result = await observe(
      new ScriptedReader([{catalog: [first, second], items: {}}]),
      [target]
    )
    expect(result.status).toBe('partial')
  })

  test('stops and reports GraphQL rate limits', async () => {
    const resetAt = '2026-08-08T01:00:00.000Z'
    const reader = new ScriptedReader([
      fixture({'L_a': [items(1, [selectedRepository])]}, {
        catalogError: new AppFailure({
          category: 'rate-limit',
          message: 'GitHub request was rate limited.',
          retryable: true,
          retryAt: resetAt,
          rateLimit: {limit: 5_000, remaining: 0, resetAt}
        })
      })
    ])
    const result = await observe(reader, [target])
    expect(result.status).toBe('rate-limited')
    if (result.status !== 'rate-limited') return
    expect(result.rateLimit).toEqual({limit: 5_000, remaining: 0, resetAt})
    expect('repositories' in result).toBeFalse()
  })

  test('reports exhausted successful page rate limits before another request', async () => {
    const exhausted = {limit: 5_000, remaining: 0, resetAt: null}
    const reader = new ScriptedReader([
      {catalog: [catalog([], false, null, 0, exhausted)], items: {}}
    ])
    const result = await observe(reader, [target])
    expect(result.status).toBe('rate-limited')
  })

  test('represents unavailable List capability', async () => {
    const result = await observe(
      new ScriptedReader([{available: false, catalog: [], items: {}}]),
      [target]
    )
    expect(result.status).toBe('unavailable')
    expect('repositories' in result).toBeFalse()
  })

  test('builds per-repository bulk previews from one stable capture pair', async () => {
    const capture = fixture({
      'L_a': [items(1, ['R_one'])],
      'L_b': [items(1, ['R_two'])]
    })
    const service = new NativeListMembershipObservationService({
      reader: new ScriptedReader([capture, capture])
    })
    const result = await service.previewBatch(githubUserId, [
      {
        kind: 'add',
        githubUserId,
        repositoryNodeId: 'R_one',
        additions: ['L_b']
      },
      {
        kind: 'remove',
        githubUserId,
        repositoryNodeId: 'R_two',
        removals: ['L_b']
      }
    ])
    expect(result.status).toBe('stable')
    if (result.status !== 'stable') return
    expect(result.previews).toHaveLength(2)
    expect(result.previews[0]?.before.listNodeIds).toEqual(['L_a'])
    expect(result.previews[0]?.desired.listNodeIds).toEqual(['L_a', 'L_b'])
    expect(result.previews[1]?.before.listNodeIds).toEqual(['L_b'])
    expect(result.previews[1]?.desired.listNodeIds).toEqual([])
  })

  test('returns an invalid bulk preview when a move source is absent', async () => {
    const capture = fixture({'L_a': [items(1, ['R_other'])]})
    const service = new NativeListMembershipObservationService({
      reader: new ScriptedReader([capture, capture])
    })
    const result = await service.previewBatch(githubUserId, [
      {
        kind: 'move',
        githubUserId,
        repositoryNodeId: selectedRepository,
        sourceListNodeId: 'L_a',
        destinationListNodeId: 'L_b'
      }
    ])
    expect(result.status).toBe('invalid-intent')
    if (result.status !== 'invalid-intent') return
    expect(result.sourceListNodeId).toBe('L_a')
  })
})

interface CaptureFixture {
  readonly available?: boolean
  readonly capabilityRateLimit?: NativeListCapability['rateLimit']
  readonly catalog: readonly NativeListCatalogPage[]
  readonly items: Readonly<Record<string, readonly NativeListItemsPage[]>>
  readonly catalogError?: Error
  readonly itemError?: Error
}

class ScriptedReader implements NativeListReader {
  readonly #captures: readonly CaptureFixture[]
  #captureIndex = -1
  #catalogPages: NativeListCatalogPage[] = []
  #itemPages = new Map<string, NativeListItemsPage[]>()
  probeCalls = 0
  readonly itemCalls: [string, string | null][] = []

  constructor(captures: readonly CaptureFixture[]) {
    this.#captures = captures
  }

  probeNativeLists(): Promise<NativeListCapability> {
    this.probeCalls += 1
    this.#captureIndex += 1
    const capture = this.#requireCapture()
    this.#catalogPages = [...capture.catalog]
    this.#itemPages = new Map(
      Object.entries(capture.items).map(([listNodeId, pages]) => [
        listNodeId,
        [...pages]
      ])
    )
    return Promise.resolve({
      available: capture.available ?? true,
      rateLimit: capture.capabilityRateLimit ?? rateLimit
    })
  }

  fetchNativeListCatalogPage(): Promise<NativeListCatalogPage> {
    const capture = this.#requireCapture()
    if (capture.catalogError) return Promise.reject(capture.catalogError)
    const page = this.#catalogPages.shift()
    if (!page) return Promise.reject(new Error('Missing catalog fixture page.'))
    return Promise.resolve(page)
  }

  fetchNativeListItemsPage(
    listNodeId: string,
    after: string | null
  ): Promise<NativeListItemsPage> {
    this.itemCalls.push([listNodeId, after])
    const capture = this.#requireCapture()
    if (capture.itemError) return Promise.reject(capture.itemError)
    const page = this.#itemPages.get(listNodeId)?.shift()
    if (!page) return Promise.reject(new Error(`Missing item fixture page for ${listNodeId}.`))
    return Promise.resolve(page)
  }

  #requireCapture(): CaptureFixture {
    const capture = this.#captures[this.#captureIndex]
    if (!capture) throw new Error('Missing observation capture fixture.')
    return capture
  }
}

function fixture(
  itemPages: Readonly<Record<string, readonly NativeListItemsPage[]>>,
  options: Pick<CaptureFixture, 'catalogError' | 'itemError'> = {}
): CaptureFixture {
  const lists = Object.entries(itemPages).map(([listNodeId, pages]) =>
    list(listNodeId, pages[0]?.totalCount ?? 0)
  )
  return {
    catalog: [catalog(lists, false, null, lists.length)],
    items: itemPages,
    ...options
  }
}

function multiListCapture(): CaptureFixture {
  return fixture({
    'L_a': [
      items(2, ['R_other_a'], true, 'a-next'),
      items(2, [selectedRepository])
    ],
    'L_b': [
      items(2, [selectedRepository], true, 'b-next'),
      items(2, ['R_other_b'])
    ]
  })
}

function list(listNodeId: string, reportedItemCount: number) {
  return {
    listNodeId,
    name: `List ${listNodeId}`,
    description: null,
    isPrivate: false,
    slug: null,
    createdAt: null,
    updatedAt: null,
    lastAddedAt: null,
    reportedItemCount
  }
}

function catalog(
  lists: NativeListCatalogPage['lists'],
  hasNextPage: boolean,
  endCursor: string | null,
  totalCount: number,
  pageRateLimit = rateLimit
): NativeListCatalogPage {
  return {
    lists,
    totalCount,
    pageInfo: {hasNextPage, endCursor},
    rateLimit: pageRateLimit
  }
}

function items(
  totalCount: number,
  repositoryNodeIds: readonly string[],
  hasNextPage = false,
  endCursor: string | null = null
): NativeListItemsPage {
  return {
    totalCount,
    repositoryNodeIds,
    pageInfo: {hasNextPage, endCursor},
    rateLimit
  }
}

function observe(
  reader: NativeListReader,
  targets: readonly SelectedRepositoryObservationTarget[],
  maxAttempts = 3
) {
  return new NativeListMembershipObservationService({reader, maxAttempts}).observeSelected(
    githubUserId,
    targets
  )
}

function clock() {
  let value = Date.parse('2026-08-08T00:00:00.000Z')
  return {
    now: () => {
      const current = value
      value += 1_000
      return current
    }
  }
}
