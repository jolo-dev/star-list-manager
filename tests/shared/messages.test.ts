import {describe, expect, test} from 'bun:test'
import {decodeDashboardRequest} from '../../src/shared/messages'

describe('dashboard message decoding', () => {
  test('accepts an exact typed annotation patch', () => {
    expect(
      decodeDashboardRequest({
        type: 'update-annotation',
        repositoryNodeId: 'R_fixture',
        patch: {
          triageState: 'snoozed',
          tags: ['Research'],
          note: 'Read later',
          favorite: true,
          revisitAt: '2026-09-01T12:00:00Z'
        }
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'update-annotation',
        repositoryNodeId: 'R_fixture',
        patch: {
          triageState: 'snoozed',
          tags: ['Research'],
          note: 'Read later',
          favorite: true,
          revisitAt: '2026-09-01T12:00:00Z'
        }
      }
    })
  })

  test('rejects unknown patch fields and malformed dates', () => {
    expect(
      decodeDashboardRequest({
        type: 'update-annotation',
        repositoryNodeId: 'R_fixture',
        patch: {accessToken: 'secret'}
      }).ok
    ).toBe(false)
    expect(
      decodeDashboardRequest({
        type: 'update-annotation',
        repositoryNodeId: 'R_fixture',
        patch: {revisitAt: 'tomorrow'}
      }).ok
    ).toBe(false)
  })

  test('rejects extra top-level message fields', () => {
    expect(decodeDashboardRequest({type: 'disconnect', token: 'secret'}).ok).toBe(
      false
    )
  })

  test('accepts exact write authorization actions and rejects credential fields', () => {
    for (const type of [
      'show-write-auth-preview',
      'start-write-device-auth',
      'cancel-write-device-auth',
      'disconnect-write-auth'
    ] as const) {
      expect(decodeDashboardRequest({type})).toEqual({ok: true, value: {type}})
      expect(decodeDashboardRequest({type, accessToken: 'secret'}).ok).toBe(false)
    }
  })

  test('accepts only credential-free unstar enqueue and cancellation messages', () => {
    expect(
      decodeDashboardRequest({
        type: 'enqueue-confirmed-unstars',
        repositoryNodeIds: ['R_one', 'R_two']
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'enqueue-confirmed-unstars',
        repositoryNodeIds: ['R_one', 'R_two']
      }
    })
    expect(
      decodeDashboardRequest({type: 'cancel-mutation-job', jobId: 'job-one'})
    ).toEqual({
      ok: true,
      value: {type: 'cancel-mutation-job', jobId: 'job-one'}
    })

    for (const value of [
      {type: 'enqueue-confirmed-unstars', repositoryNodeIds: []},
      {
        type: 'enqueue-confirmed-unstars',
        repositoryNodeIds: ['R_one', 'R_one']
      },
      {
        type: 'enqueue-confirmed-unstars',
        repositoryNodeIds: ['R_one'],
        accessToken: 'secret'
      },
      {type: 'cancel-mutation-job', jobId: ''},
      {type: 'cancel-mutation-job', jobId: 'job-one', authorization: 'secret'}
    ]) {
      expect(decodeDashboardRequest(value).ok).toBe(false)
    }
  })

  test('validates import preview and apply settings selection', () => {
    expect(
      decodeDashboardRequest({
        type: 'preview-import',
        document: {format: 'star-list-manager'},
        replaceSettings: false
      }).ok
    ).toBe(true)
    expect(
      decodeDashboardRequest({
        type: 'apply-import',
        document: {},
        replaceSettings: 'yes'
      }).ok
    ).toBe(false)
  })
})
