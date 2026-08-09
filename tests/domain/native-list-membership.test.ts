import {describe, expect, test} from 'bun:test'
import {
  canonicalMembershipSet,
  membershipSetsEqual,
  planMembershipIntent,
  referencedListNodeIds,
  relevantListCatalogFingerprint,
  type NativeListMembershipIntent
} from '../../src/domain/native-list-membership'

const githubUserId = '42'
const repositoryNodeId = 'R_1'

describe('native List membership set operations', () => {
  test('canonicalizes empty, duplicate, and differently ordered membership sets', () => {
    expect(canonicalMembershipSet([])).toEqual({
      listNodeIds: [],
      fingerprint: '[]'
    })
    const left = canonicalMembershipSet(['L_c', 'L_a', 'L_b', 'L_a'])
    const right = canonicalMembershipSet(['L_b', 'L_c', 'L_a'])
    expect(left.listNodeIds).toEqual(['L_a', 'L_b', 'L_c'])
    expect(membershipSetsEqual(left, right)).toBeTrue()
  })

  test('adds a deduplicated union and reports existing destinations as no-ops', () => {
    const result = planMembershipIntent(['L_existing', 'L_unrelated'], {
      kind: 'add',
      githubUserId,
      repositoryNodeId,
      additions: ['L_new', 'L_existing', 'L_new']
    })
    expect(result.ok).toBeTrue()
    if (!result.ok) return
    expect(result.value.githubUserId).toBe(githubUserId)
    expect(result.value.repositoryNodeId).toBe(repositoryNodeId)
    expect(result.value.before.listNodeIds).toEqual(['L_existing', 'L_unrelated'])
    expect(result.value.desired.listNodeIds).toEqual([
      'L_existing',
      'L_new',
      'L_unrelated'
    ])
    expect(result.value.added).toEqual(['L_new'])
    expect(result.value.removed).toEqual([])
    expect(result.value.unchanged).toEqual(['L_existing', 'L_unrelated'])
    expect(result.value.noOpListNodeIds).toEqual(['L_existing'])
  })

  test('handles empty and entirely no-op additions', () => {
    const empty = requirePlan({
      kind: 'add',
      githubUserId,
      repositoryNodeId,
      additions: []
    }, [])
    expect(empty.desired.listNodeIds).toEqual([])

    const noOp = requirePlan({
      kind: 'add',
      githubUserId,
      repositoryNodeId,
      additions: ['L_a', 'L_a']
    }, ['L_a', 'L_a'])
    expect(noOp.added).toEqual([])
    expect(noOp.noOpListNodeIds).toEqual(['L_a'])
  })

  test('removes only explicit memberships and reports absent removals as no-ops', () => {
    const result = requirePlan(
      {
        kind: 'remove',
        githubUserId,
        repositoryNodeId,
        removals: ['L_remove', 'L_absent', 'L_remove']
      },
      ['L_keep_b', 'L_remove', 'L_keep_a', 'L_remove']
    )
    expect(result.desired.listNodeIds).toEqual(['L_keep_a', 'L_keep_b'])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual(['L_remove'])
    expect(result.unchanged).toEqual(['L_keep_a', 'L_keep_b'])
    expect(result.noOpListNodeIds).toEqual(['L_absent'])
  })

  test('handles empty and entirely absent removals', () => {
    const empty = requirePlan({
      kind: 'remove',
      githubUserId,
      repositoryNodeId,
      removals: []
    }, [])
    expect(empty.desired.listNodeIds).toEqual([])

    const absent = requirePlan({
      kind: 'remove',
      githubUserId,
      repositoryNodeId,
      removals: ['L_missing', 'L_missing']
    }, ['L_keep'])
    expect(absent.desired.listNodeIds).toEqual(['L_keep'])
    expect(absent.noOpListNodeIds).toEqual(['L_missing'])
  })

  test('moves from a present source while preserving multiple unrelated memberships', () => {
    const result = requirePlan(
      {
        kind: 'move',
        githubUserId,
        repositoryNodeId,
        sourceListNodeId: 'L_source',
        destinationListNodeId: 'L_destination'
      },
      ['L_unrelated_b', 'L_source', 'L_unrelated_a', 'L_unrelated_b']
    )
    expect(result.desired.listNodeIds).toEqual([
      'L_destination',
      'L_unrelated_a',
      'L_unrelated_b'
    ])
    expect(result.added).toEqual(['L_destination'])
    expect(result.removed).toEqual(['L_source'])
    expect(result.unchanged).toEqual(['L_unrelated_a', 'L_unrelated_b'])
  })

  test('moves by removing the source when the destination is already present', () => {
    const result = requirePlan(
      {
        kind: 'move',
        githubUserId,
        repositoryNodeId,
        sourceListNodeId: 'L_source',
        destinationListNodeId: 'L_destination'
      },
      ['L_destination', 'L_source', 'L_other']
    )
    expect(result.desired.listNodeIds).toEqual(['L_destination', 'L_other'])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual(['L_source'])
    expect(result.noOpListNodeIds).toEqual(['L_destination'])
  })

  test('rejects a move whose source is absent, including an empty live set', () => {
    const result = planMembershipIntent([], {
      kind: 'move',
      githubUserId,
      repositoryNodeId,
      sourceListNodeId: 'L_missing',
      destinationListNodeId: 'L_destination'
    })
    expect(result).toEqual({
      ok: false,
      error: {reason: 'source-absent', sourceListNodeId: 'L_missing'}
    })
  })

  test('treats a move to the same present List as a deterministic no-op', () => {
    const result = requirePlan(
      {
        kind: 'move',
        githubUserId,
        repositoryNodeId,
        sourceListNodeId: 'L_same',
        destinationListNodeId: 'L_same'
      },
      ['L_same', 'L_other']
    )
    expect(result.desired.listNodeIds).toEqual(['L_other', 'L_same'])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.noOpListNodeIds).toEqual(['L_same'])
  })

  test('fingerprints relevant List identity, existence, name, and visibility', () => {
    const left = relevantListCatalogFingerprint(
      ['L_deleted', 'L_present', 'L_present'],
      [
        {listNodeId: 'L_other', name: 'Other', visibility: 'public'},
        {listNodeId: 'L_present', name: 'Current', visibility: 'private'}
      ]
    )
    const reordered = relevantListCatalogFingerprint(
      ['L_present', 'L_deleted'],
      [
        {listNodeId: 'L_present', name: 'Current', visibility: 'private'},
        {listNodeId: 'L_other', name: 'Other', visibility: 'public'}
      ]
    )
    expect(left).toEqual(reordered)
    expect(left.entries).toEqual([
      {
        listNodeId: 'L_deleted',
        exists: false,
        name: null,
        visibility: null
      },
      {
        listNodeId: 'L_present',
        exists: true,
        name: 'Current',
        visibility: 'private'
      }
    ])
    expect(
      relevantListCatalogFingerprint(['L_present'], [
        {listNodeId: 'L_present', name: 'Renamed', visibility: 'private'}
      ]).fingerprint
    ).not.toBe(left.fingerprint)
    expect(
      relevantListCatalogFingerprint(['L_present'], [
        {listNodeId: 'L_present', name: 'Current', visibility: 'public'}
      ]).fingerprint
    ).not.toBe(left.fingerprint)
    expect(
      relevantListCatalogFingerprint(['L_present'], []).fingerprint
    ).not.toBe(left.fingerprint)
  })

  test('canonicalizes the Lists referenced by each account-bound intent', () => {
    expect(
      referencedListNodeIds({
        kind: 'add',
        githubUserId,
        repositoryNodeId,
        additions: ['L_b', 'L_a', 'L_b']
      })
    ).toEqual(['L_a', 'L_b'])
    expect(
      referencedListNodeIds({
        kind: 'move',
        githubUserId,
        repositoryNodeId,
        sourceListNodeId: 'L_b',
        destinationListNodeId: 'L_a'
      })
    ).toEqual(['L_a', 'L_b'])
  })
})

function requirePlan(
  intent: NativeListMembershipIntent,
  liveListNodeIds: readonly string[]
) {
  const result = planMembershipIntent(liveListNodeIds, intent)
  if (!result.ok) throw new Error('Expected membership intent to be valid.')
  return result.value
}
