export const starredRepositoryResponseFixture = {
  starred_at: '2026-08-01T12:00:00Z',
  repo: {
    node_id: 'R_fixture',
    owner: {login: 'jolo-dev'},
    name: 'star-list-manager',
    full_name: 'jolo-dev/star-list-manager',
    private: false,
    html_url: 'https://github.com/jolo-dev/star-list-manager',
    description: 'A fixture repository',
    language: 'TypeScript',
    topics: ['browser-extension'],
    pushed_at: '2026-08-01T10:00:00Z',
    archived: false,
    disabled: false
  }
} as const

export const nativeListResponseFixture = {
  id: 'UL_fixture',
  name: 'Browser tools',
  description: 'Useful browser projects',
  isPrivate: false,
  slug: 'browser-tools',
  createdAt: '2026-07-01T10:00:00Z',
  updatedAt: '2026-08-01T10:00:00Z',
  lastAddedAt: '2026-08-01T09:00:00Z',
  items: {
    totalCount: 1,
    nodes: [{id: 'R_fixture'}]
  }
} as const
