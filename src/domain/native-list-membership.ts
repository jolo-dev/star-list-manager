import type {
  GitHubUserId,
  NativeListNodeId,
  NativeListVisibility,
  RepositoryNodeId
} from './types'
import {failure, success, type Result} from '../shared/result'

interface MembershipIntentBase {
  readonly githubUserId: GitHubUserId
  readonly repositoryNodeId: RepositoryNodeId
}

export interface AddMembershipIntent extends MembershipIntentBase {
  readonly kind: 'add'
  readonly additions: readonly NativeListNodeId[]
}

export interface RemoveMembershipIntent extends MembershipIntentBase {
  readonly kind: 'remove'
  readonly removals: readonly NativeListNodeId[]
}

export interface MoveMembershipIntent extends MembershipIntentBase {
  readonly kind: 'move'
  readonly sourceListNodeId: NativeListNodeId
  readonly destinationListNodeId: NativeListNodeId
}

export type NativeListMembershipIntent =
  | AddMembershipIntent
  | RemoveMembershipIntent
  | MoveMembershipIntent

export interface CanonicalMembershipSet {
  readonly listNodeIds: readonly NativeListNodeId[]
  readonly fingerprint: string
}

export interface ExistingListCatalogIdentity {
  readonly listNodeId: NativeListNodeId
  readonly name: string
  readonly visibility: NativeListVisibility
}

export type RelevantListCatalogEntry =
  | {
      readonly listNodeId: NativeListNodeId
      readonly exists: true
      readonly name: string
      readonly visibility: NativeListVisibility
    }
  | {
      readonly listNodeId: NativeListNodeId
      readonly exists: false
      readonly name: null
      readonly visibility: null
    }

export interface CanonicalListCatalogFingerprint {
  readonly entries: readonly RelevantListCatalogEntry[]
  readonly fingerprint: string
}

export interface MembershipIntentPlan extends MembershipIntentBase {
  readonly intent: NativeListMembershipIntent
  readonly before: CanonicalMembershipSet
  readonly desired: CanonicalMembershipSet
  readonly added: readonly NativeListNodeId[]
  readonly removed: readonly NativeListNodeId[]
  readonly unchanged: readonly NativeListNodeId[]
  readonly noOpListNodeIds: readonly NativeListNodeId[]
}

export interface MembershipIntentError {
  readonly reason: 'source-absent'
  readonly sourceListNodeId: NativeListNodeId
}

export function canonicalMembershipSet(
  listNodeIds: Iterable<NativeListNodeId>
): CanonicalMembershipSet {
  const canonical = [...new Set(listNodeIds)].sort(compareStrings)
  return {listNodeIds: canonical, fingerprint: JSON.stringify(canonical)}
}

export function membershipSetsEqual(
  left: CanonicalMembershipSet,
  right: CanonicalMembershipSet
): boolean {
  return left.fingerprint === right.fingerprint
}

export function referencedListNodeIds(
  intent: NativeListMembershipIntent
): readonly NativeListNodeId[] {
  switch (intent.kind) {
    case 'add':
      return canonicalMembershipSet(intent.additions).listNodeIds
    case 'remove':
      return canonicalMembershipSet(intent.removals).listNodeIds
    case 'move':
      return canonicalMembershipSet([
        intent.sourceListNodeId,
        intent.destinationListNodeId
      ]).listNodeIds
  }
}

export function relevantListCatalogFingerprint(
  referencedIds: Iterable<NativeListNodeId>,
  catalog: Iterable<ExistingListCatalogIdentity>
): CanonicalListCatalogFingerprint {
  const byId = new Map<NativeListNodeId, ExistingListCatalogIdentity>()
  const sortedCatalog = [...catalog].sort((left, right) => {
    const byIdResult = compareStrings(left.listNodeId, right.listNodeId)
    if (byIdResult !== 0) return byIdResult
    return compareStrings(
      JSON.stringify([left.name, left.visibility]),
      JSON.stringify([right.name, right.visibility])
    )
  })
  for (const entry of sortedCatalog) {
    if (!byId.has(entry.listNodeId)) byId.set(entry.listNodeId, entry)
  }

  const entries = canonicalMembershipSet(referencedIds).listNodeIds.map(
    (listNodeId): RelevantListCatalogEntry => {
      const entry = byId.get(listNodeId)
      return entry
        ? {
            listNodeId,
            exists: true,
            name: entry.name,
            visibility: entry.visibility
          }
        : {listNodeId, exists: false, name: null, visibility: null}
    }
  )
  return {
    entries,
    fingerprint: JSON.stringify(
      entries.map((entry) => [
        entry.listNodeId,
        entry.exists,
        entry.name,
        entry.visibility
      ])
    )
  }
}

export function planMembershipIntent(
  liveListNodeIds: Iterable<NativeListNodeId>,
  intent: NativeListMembershipIntent
): Result<MembershipIntentPlan, MembershipIntentError> {
  const before = canonicalMembershipSet(liveListNodeIds)
  const live = new Set(before.listNodeIds)
  const noOps = new Set<NativeListNodeId>()

  switch (intent.kind) {
    case 'add':
      for (const listNodeId of canonicalMembershipSet(intent.additions).listNodeIds) {
        if (live.has(listNodeId)) noOps.add(listNodeId)
        live.add(listNodeId)
      }
      break
    case 'remove':
      for (const listNodeId of canonicalMembershipSet(intent.removals).listNodeIds) {
        if (!live.delete(listNodeId)) noOps.add(listNodeId)
      }
      break
    case 'move':
      if (!live.has(intent.sourceListNodeId)) {
        return failure({
          reason: 'source-absent',
          sourceListNodeId: intent.sourceListNodeId
        })
      }
      if (intent.sourceListNodeId === intent.destinationListNodeId) {
        noOps.add(intent.destinationListNodeId)
        break
      }
      live.delete(intent.sourceListNodeId)
      if (live.has(intent.destinationListNodeId)) {
        noOps.add(intent.destinationListNodeId)
      }
      live.add(intent.destinationListNodeId)
      break
  }

  const desired = canonicalMembershipSet(live)
  const desiredIds = new Set(desired.listNodeIds)
  const beforeIds = new Set(before.listNodeIds)
  return success({
    githubUserId: intent.githubUserId,
    repositoryNodeId: intent.repositoryNodeId,
    intent,
    before,
    desired,
    added: desired.listNodeIds.filter((listNodeId) => !beforeIds.has(listNodeId)),
    removed: before.listNodeIds.filter((listNodeId) => !desiredIds.has(listNodeId)),
    unchanged: before.listNodeIds.filter((listNodeId) => desiredIds.has(listNodeId)),
    noOpListNodeIds: canonicalMembershipSet(noOps).listNodeIds
  })
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
