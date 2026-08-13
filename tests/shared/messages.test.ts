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

  test('accepts exact credential-free native List preview and confirmation messages', () => {
    for (const operation of [
      {kind: 'add', listNodeIds: ['L_one', 'L_two']},
      {kind: 'remove', listNodeIds: ['L_one']},
      {
        kind: 'move',
        sourceListNodeId: 'L_one',
        destinationListNodeId: 'L_two'
      }
    ] as const) {
      expect(
        decodeDashboardRequest({
          type: 'preview-native-list-membership',
          repositoryNodeIds: ['R_one', 'R_two'],
          operation
        }).ok
      ).toBe(true)
    }
    expect(
      decodeDashboardRequest({
        type: 'refresh-native-list-membership-preview',
        jobId: 'job-one'
      }).ok
    ).toBe(true)
    expect(
      decodeDashboardRequest({
        type: 'confirm-native-list-membership-preview',
        previewId: 'preview-one'
      }).ok
    ).toBe(true)
  })

  test('rejects malformed, duplicate, lifecycle, and credential-bearing membership requests', () => {
    for (const value of [
      {
        type: 'preview-native-list-membership',
        repositoryNodeIds: [],
        operation: {kind: 'add', listNodeIds: ['L_one']}
      },
      {
        type: 'preview-native-list-membership',
        repositoryNodeIds: ['R_one'],
        operation: {kind: 'add', listNodeIds: ['L_one', 'L_one']}
      },
      {
        type: 'preview-native-list-membership',
        repositoryNodeIds: ['R_one'],
        operation: {
          kind: 'move',
          sourceListNodeId: 'L_one',
          destinationListNodeId: 'L_one'
        }
      },
      {
        type: 'preview-native-list-membership',
        repositoryNodeIds: ['R_one'],
        operation: {kind: 'delete', listNodeIds: ['L_one']}
      },
      {
        type: 'confirm-native-list-membership-preview',
        previewId: 'preview-one',
        accessToken: 'secret'
      }
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

  test('accepts only an exact credential-free native List rename request', () => {
    expect(
      decodeDashboardRequest({
        type: 'rename-native-list',
        listNodeId: 'L_fixture',
        name: '  Ｔools  '
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'rename-native-list',
        listNodeId: 'L_fixture',
        name: '  Ｔools  '
      }
    })

    for (const value of [
      {type: 'rename-native-list', listNodeId: '', name: 'Tools'},
      {type: 'rename-native-list', listNodeId: '   ', name: 'Tools'},
      {type: 'rename-native-list', listNodeId: 42, name: 'Tools'},
      {type: 'rename-native-list', listNodeId: 'L_fixture', name: ''},
      {type: 'rename-native-list', listNodeId: 'L_fixture', name: ' \t '},
      {type: 'rename-native-list', listNodeId: 'L_fixture', name: ['Tools']},
      {
        type: 'rename-native-list',
        listNodeId: 'L_fixture',
        name: 'Tools',
        operation: {kind: 'add', listNodeIds: ['L_other']}
      },
      {
        type: 'rename-native-list',
        listNodeId: 'L_fixture',
        name: 'Tools',
        accessToken: 'secret'
      }
    ]) {
      expect(decodeDashboardRequest(value).ok).toBe(false)
    }
  })
})
