import {describe, expect, test} from 'bun:test'
import {
  OAuthListMembershipProbeFailure,
  runOAuthListMembershipCapabilityProbe,
  type OAuthListMembershipProbeDependencies,
  type StableMembershipObservation
} from '../../scripts/oauth-list-membership-capability-probe'
import {nativeListMembershipControlsEnabled} from '../../src/github/list-membership-capability'
import {ListMembershipMutationFailure} from '../../src/github/list-membership-write-session'

const options = {
  fixture: 'fixture-owner/disposable-star',
  repositoryNodeId: 'R_fixture',
  expectedGitHubUserId: '42'
} as const

describe('OAuth native List membership capability probe', () => {
  test('submits the unchanged complete set and requires an independent read-back', async () => {
    const calls: Array<{readonly completeListIds: readonly string[]}> = []
    const observations = observationSequence([
      {completeListIds: ['L_alpha', 'L_beta'], observations: 2},
      {completeListIds: ['L_alpha', 'L_beta'], observations: 3}
    ])
    const result = await runOAuthListMembershipCapabilityProbe(options, {
      transport: {
        updateMemberships: async (request) => {
          calls.push({completeListIds: request.completeListIds})
          expect(request.expectedGitHubUserId).toBe('42')
          expect(request.repositoryNodeId).toBe('R_fixture')
          return {updatedListIds: ['L_alpha', 'L_beta']}
        }
      },
      observeStableMemberships: observations.observe
    })

    expect(calls).toEqual([{completeListIds: ['L_alpha', 'L_beta']}])
    expect(observations.calls()).toBe(2)
    expect(result).toEqual({
      fixture: 'fixture-owner/disposable-star',
      githubUserId: '42',
      listCount: 2,
      initialObservations: 2,
      readBackObservations: 3,
      proof: {
        schema: 'available',
        oauthUserScope: 'verified',
        accountOwnership: 'verified',
        unchangedSetMutation: 'verified',
        independentReadBack: 'verified'
      }
    })
    expect(nativeListMembershipControlsEnabled(result.proof)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('token')
  })

  test('does not mutate when the initial observation is not canonical', async () => {
    let mutations = 0
    const error = await expectProbeFailure(
      runOAuthListMembershipCapabilityProbe(options, {
        transport: {
          updateMemberships: async () => {
            mutations += 1
            return {updatedListIds: []}
          }
        },
        observeStableMemberships: async () => ({
          completeListIds: ['L_beta', 'L_alpha'],
          observations: 2
        })
      }),
      'observation-failed'
    )
    expect(mutations).toBe(0)
    expect(error.message).not.toContain('L_alpha')
  })

  test('does not produce proof when mutation or independent read-back fails', async () => {
    const initial = {completeListIds: ['L_alpha'], observations: 2} as const
    await expectProbeFailure(
      runOAuthListMembershipCapabilityProbe(options, {
        transport: {
          updateMemberships: () => Promise.reject(new Error('gho_secret'))
        },
        observeStableMemberships: async () => initial
      }),
      'mutation-failed'
    )

    const observations = observationSequence([
      initial,
      {completeListIds: [], observations: 2}
    ])
    const mismatch = await expectProbeFailure(
      runOAuthListMembershipCapabilityProbe(options, {
        transport: {
          updateMemberships: async () => ({updatedListIds: ['L_alpha']})
        },
        observeStableMemberships: observations.observe
      }),
      'read-back-mismatch'
    )
    expect(mismatch.message).not.toContain('L_alpha')
  })

  test('retains only allowlisted typed mutation failure diagnostics and skips read-back', async () => {
    const observations = observationSequence([
      {completeListIds: [], observations: 2}
    ])
    const error = await expectProbeFailure(
      runOAuthListMembershipCapabilityProbe(options, {
        transport: {
          updateMemberships: () => Promise.reject(
            new ListMembershipMutationFailure('permission', {
              category: 'permission',
              message: 'Bearer gho_secret raw GitHub denial',
              retryable: false,
              status: 403
            })
          )
        },
        observeStableMemberships: observations.observe
      }),
      'mutation-failed'
    )

    expect(error.mutationFailure).toEqual({
      reason: 'permission',
      category: 'permission',
      status: 403
    })
    expect(error.message).toBe(
      'The unchanged native List membership mutation failed: permission (HTTP 403).'
    )
    expect(observations.calls()).toBe(1)
    expect(JSON.stringify(error)).not.toContain('gho_secret')
    expect(JSON.stringify(error)).not.toContain('raw GitHub denial')
  })

  test('rejects forged typed diagnostics and drops invalid HTTP statuses', async () => {
    const forgedReason = new ListMembershipMutationFailure('permission', {
      category: 'permission',
      message: 'fixed',
      retryable: false,
      status: 403
    })
    Object.defineProperty(forgedReason, 'reason', {
      value: 'permission Bearer gho_secret',
      enumerable: true
    })
    const reasonError = await expectProbeFailure(
      probeWithMutationFailure(forgedReason),
      'mutation-failed'
    )
    expect(reasonError.mutationFailure).toBeNull()
    expect(reasonError.message).toBe(
      'The unchanged native List membership mutation did not succeed.'
    )
    expect(JSON.stringify(reasonError)).not.toContain('gho_secret')

    for (const category of ['network', 'credential gho_secret']) {
      const categoryError = await expectProbeFailure(
        probeWithMutationFailure(
          new ListMembershipMutationFailure('permission', {
            category: category as 'permission',
            message: 'fixed',
            retryable: false,
            status: 403
          })
        ),
        'mutation-failed'
      )
      expect(categoryError.mutationFailure).toBeNull()
      expect(categoryError.message).toBe(
        'The unchanged native List membership mutation did not succeed.'
      )
      expect(JSON.stringify(categoryError)).not.toContain('gho_secret')
    }

    for (const status of [Number.NaN, Number.POSITIVE_INFINITY, -1, 99, 403.5, 600]) {
      const statusError = await expectProbeFailure(
        probeWithMutationFailure(
          new ListMembershipMutationFailure('permission', {
            category: 'permission',
            message: 'fixed',
            retryable: false,
            status
          })
        ),
        'mutation-failed'
      )
      expect(statusError.mutationFailure).toEqual({
        reason: 'permission',
        category: 'permission',
        status: null
      })
      expect(statusError.message).toBe(
        'The unchanged native List membership mutation failed: permission.'
      )
    }
  })

  test('sanitizes observation dependency failures', async () => {
    const error = await expectProbeFailure(
      runOAuthListMembershipCapabilityProbe(options, {
        transport: {
          updateMemberships: async () => ({updatedListIds: []})
        },
        observeStableMemberships: () => Promise.reject(new Error('gho_secret'))
      }),
      'observation-failed'
    )
    expect(error.message).not.toContain('gho_secret')
  })
})

function probeWithMutationFailure(error: ListMembershipMutationFailure): Promise<unknown> {
  return runOAuthListMembershipCapabilityProbe(options, {
    transport: {
      updateMemberships: () => Promise.reject(error)
    },
    observeStableMemberships: async () => ({
      completeListIds: [],
      observations: 2
    })
  })
}

function observationSequence(values: readonly StableMembershipObservation[]): {
  readonly observe: OAuthListMembershipProbeDependencies['observeStableMemberships']
  readonly calls: () => number
} {
  let callCount = 0
  return {
    observe: async () => {
      const value = values[callCount]
      callCount += 1
      if (!value) throw new Error('Missing observation fixture.')
      return value
    },
    calls: () => callCount
  }
}

async function expectProbeFailure(
  promise: Promise<unknown>,
  code: OAuthListMembershipProbeFailure['code']
): Promise<OAuthListMembershipProbeFailure> {
  try {
    await promise
    throw new Error(`Expected ${code}`)
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(OAuthListMembershipProbeFailure)
    if (!(error instanceof OAuthListMembershipProbeFailure)) throw error
    expect(error.code).toBe(code)
    return error
  }
}
