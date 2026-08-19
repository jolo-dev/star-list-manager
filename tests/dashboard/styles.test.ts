import {expect, test} from 'bun:test'
import {readFile} from 'node:fs/promises'

const styles = await readFile(
  new URL('../../src/dashboard/styles.css', import.meta.url),
  'utf8'
)

test('defines the Geist Mono library workspace theme', () => {
  expect(styles).toMatch(/@font-face\s*\{[\s\S]*font-family:\s*['"]Geist Mono['"]/)
  expect(styles).toContain('--navy: #0f2c3d;')
  expect(styles).toContain('--sage: #a6b7a1;')
  expect(styles).toContain('--sand: #d4c8b5;')
  expect(styles).toContain('--copper: #c4936a;')
  expect(styles).toContain('font-family: "Geist Mono"')
})

test('uses a scrollable repository modal instead of a persistent inspector column', () => {
  const libraryGrid = cssRulesFor(styles, /^\s*\.library-grid\s*$/m)
  const repositoryDialog = cssRulesFor(styles, /^\s*\.repository-inspection-dialog\s*$/m)

  expect(libraryGrid.some(({declarations}) => /grid-template-columns:/.test(declarations))).toBe(false)
  expect(
    repositoryDialog.some(({declarations}) =>
      /max-height:\s*calc\(100dvh - 48px\)/.test(declarations) &&
      /overflow-y:\s*auto/.test(declarations)
    )
  ).toBe(true)
})

test('defines readable Geist Mono type roles for prose, labels, data, and warnings', () => {
  const root = cssRulesFor(styles, /^\s*:root\s*$/m)[0]?.declarations ?? ''
  const prose = cssRulesFor(
    styles,
    /\.state-copy,\s*\.state-panel > p:not\(\.eyebrow\),\s*\.operations-intro/
  )
  const labels = cssRulesFor(
    styles,
    /\.library-actions label,\s*\.annotation-editor label,\s*\.filter-panel label/
  )
  const utilityData = cssRulesFor(
    styles,
    /\.repository-owner,\s*\.repository-meta,\s*\.batch-status,\s*\.job-error/
  )
  const warnings = cssRulesFor(
    styles,
    /\.status-banner,\s*\.membership-block,\s*\.membership-activity,\s*\.replace-all-warning/
  )

  expect(root).toMatch(/--font-family:\s*"Geist Mono";/)
  expect(root).toMatch(/--type-reading-size:\s*13px;/)
  expect(root).toMatch(/--type-label-size:\s*12px;/)
  expect(root).toMatch(/--type-data-size:\s*12px;/)
  expect(root).toMatch(/--type-warning-size:\s*13px;/)
  expect(root).toMatch(/--measure-prose:\s*66ch;/)
  expect(root).toMatch(/font-family:\s*var\(--font-family\);/)
  expect(root).not.toMatch(/font-family:[^;]*ui-monospace/)
  expect(prose.some(({declarations}) => /max-width:\s*var\(--measure-prose\)/.test(declarations))).toBe(true)
  expect(prose.some(({declarations}) => /font-size:\s*var\(--type-reading-size\)/.test(declarations))).toBe(true)
  expect(labels.some(({declarations}) => /font-size:\s*var\(--type-label-size\)/.test(declarations))).toBe(true)
  expect(utilityData.some(({declarations}) => /font-size:\s*var\(--type-data-size\)/.test(declarations))).toBe(true)
  expect(warnings.some(({declarations}) => /font-size:\s*var\(--type-warning-size\)/.test(declarations))).toBe(true)
})

test('defines shared semantic border tokens for repeated state treatments', () => {
  const root = cssRulesFor(styles, /^\s*:root\s*$/m)[0]?.declarations ?? ''

  expect(root).toMatch(/--border-warning:\s*#d7bd83;/)
  expect(root).toMatch(/--border-danger:\s*#d5aaa3;/)
  expect(root).toMatch(/--border-success:\s*#aac7b2;/)
  expect(styles).toContain('border: 1px solid var(--border-warning);')
  expect(styles).toContain('border: 1px solid var(--border-danger);')
  expect(styles).toContain('border: 1px solid var(--border-success);')
})

test('keeps keyboard focus visibly distinct from nav hover state', () => {
  const navFocus = cssRulesFor(styles, /\.nav-item:focus-visible\b/)

  expect(
    navFocus.some(({declarations}) =>
      /outline:\s*3px solid var\(--copper\)/.test(declarations) &&
      /outline-offset:\s*2px/.test(declarations)
    )
  ).toBe(true)
})

test('shows visible focus around the Import JSON action', () => {
  const fileActionFocus = cssRulesFor(styles, /\.file-action:focus-within\b/)

  expect(
    fileActionFocus.some(({declarations}) =>
      /outline:\s*3px solid var\(--focus-ring\)/.test(declarations) &&
      /outline-offset:\s*2px/.test(declarations)
    )
  ).toBe(true)
})

test('keeps mobile dashboard inputs at a readable 16px', () => {
  const mobileStyles = mobileDashboardStyles()

  expect(mobileStyles).not.toBeNull()
  if (mobileStyles === null) return

  const inputs = cssRulesFor(
    mobileStyles,
    /\.library-actions input,\s*\.library-actions select,\s*\.annotation-editor input/
  )
  expect(inputs.some(({declarations}) => /font-size:\s*16px/.test(declarations))).toBe(true)
})

test('lays out an accessible responsive native List rename header editor', () => {
  const editor = cssRulesFor(styles, /^\s*\.native-list-rename-editor\s*$/m)
  const actions = cssRulesFor(styles, /^\s*\.native-list-header-actions\s*$/m)
  const mobileStyles = mobileDashboardStyles()
  const mobileEditor = mobileStyles
    ? cssRulesFor(mobileStyles, /\.native-list-rename-editor\b/)
    : []

  expect(actions.some(({declarations}) => /display:\s*flex/.test(declarations))).toBe(true)
  expect(editor.some(({declarations}) => /display:\s*(?:grid|flex)/.test(declarations))).toBe(true)
  expect(editor.some(({declarations}) => /min-width:\s*0/.test(declarations))).toBe(true)
  expect(mobileEditor.some(({declarations}) => /grid-template-columns:\s*1fr/.test(declarations))).toBe(true)
})

test('keeps triage state visibly rendered on mobile', () => {
  const mobileStyles = mobileDashboardStyles()

  expect(mobileStyles).not.toBeNull()
  if (mobileStyles === null) return

  const triageRules = mobileRulesFor(
    mobileStyles,
    /\.(?:repository-row-shell|repository-row|triage-pill)\b/
  )

  expect(triageRules.length).toBeGreaterThan(0)
  expect(triageRules.some(({declarations}) => hidesContent(declarations))).toBe(false)
})

test('keeps navigation groups and summaries reachable on mobile', () => {
  const mobileStyles = mobileDashboardStyles()

  expect(mobileStyles).not.toBeNull()
  if (mobileStyles === null) return

  const navigationRules = mobileRulesFor(
    mobileStyles,
    /(?:^|[\s,])(?:details)?\.nav-group\b(?!\s*[>+~])/
  )
  const summaryRules = mobileRulesFor(mobileStyles, /\.nav-group\s*>\s*summary\b/)
  const navigationVisibilityRules = mobileRulesFor(
    mobileStyles,
    /\.(?:sidebar|nav-group)\b|\.nav-group\s*>\s*(?:summary|\.nav-list)\b/
  )

  expect(navigationRules.length).toBeGreaterThan(0)
  expect(summaryRules.length).toBeGreaterThan(0)
  expect(navigationVisibilityRules.some(({declarations}) => hidesContent(declarations))).toBe(false)
})

test('keeps horizontal nav scrolling exclusive to the primary triage list on mobile', () => {
  const mobileStyles = mobileDashboardStyles()

  expect(mobileStyles).not.toBeNull()
  if (mobileStyles === null) return

  const primaryNavigation = cssRulesFor(mobileStyles, /\.nav-list-primary\b/)
  const groupedNavigation = cssRulesFor(
    mobileStyles,
    /\.nav-group\s*>\s*\.nav-list:not\(\.nav-list-primary\)/
  )
  const genericNavigation = cssRulesFor(mobileStyles, /^\s*\.nav-list\s*$/m)

  expect(
    primaryNavigation.some(({declarations}) =>
      /display:\s*flex/.test(declarations) && /overflow-x:\s*auto/.test(declarations)
    )
  ).toBe(true)
  expect(
    groupedNavigation.some(({declarations}) =>
      /grid-template-columns:\s*1fr/.test(declarations) && /overflow:\s*visible/.test(declarations)
    )
  ).toBe(true)
  expect(genericNavigation.some(({declarations}) => /overflow-x:\s*auto/.test(declarations))).toBe(
    false
  )
})

test('keeps triage selection persistent in a grouped control', () => {
  const triageLayout = cssRulesFor(styles, /^\s*\.triage-actions\s*$/m)
  const selectedTriage = cssRulesFor(styles, /\.triage-actions\s+button\.is-active\b/)

  expect(
    triageLayout.some(({declarations}) =>
      /display:\s*flex/.test(declarations) &&
      /flex-wrap:\s*wrap/.test(declarations) &&
      /gap:\s*\d+px/.test(declarations)
    )
  ).toBe(true)
  expect(
    selectedTriage.some(({declarations}) =>
      /color:\s*var\(--surface\)/.test(declarations) &&
      /background:\s*var\(--navy\)/.test(declarations) &&
      /border-color:\s*var\(--navy\)/.test(declarations)
    )
  ).toBe(true)
})

test('gives named navigation summaries and primary controls 44px touch targets', () => {
  const mobileStyles = mobileDashboardStyles()

  expect(mobileStyles).not.toBeNull()
  if (mobileStyles === null) return

  const missingTouchTargets = [
    ['navigation item', /\.nav-item\b/],
    ['navigation summary', /\.nav-group\s*>\s*summary\b/],
    ['View options summary', /\.view-options\s*>\s*summary\b/],
    ['Search', /\.search-field\s+input\b/],
    ['Refresh', /\.refresh-button\b/],
    ['Triage actions', /\.triage-actions\s+button\b/],
    ['Favorite', /\.favorite-button\b/],
    ['Inspector unstar', /\.github-unstar-action\s+\.danger-action\b/],
    ['Membership operation', /\.membership-operation-tabs\s+button\b/],
    ['Native List choices', /\.native-list-choices\s+label\b/],
    ['Inspector Tags input', /\.annotation-editor\s+input\[type="text"\]/],
    ['Move-list selects', /\.move-fields\s+select\b/],
    ['Filter toggles', /\.filter-toggle\b/],
    ['Advanced filters summary', /\.advanced-filters\s+summary\b/],
    ['Refreshed membership preview', /\.refresh-membership-preview\b/],
    ['Cancel queued job', /\.cancel-job\b/],
    ['Advanced filter inputs', /\.filter-panel\s+input\b/],
    ['Advanced filter selects', /\.filter-panel\s+select\b/],
    ['Advanced filter date controls', /\.filter-panel\s+input\[type="date"\]/],
    ['Clear filters', /\.clear-filters\b/],
    ['Confirmation primary action', /\.confirmation-dialog\s+\.primary-action\b/],
    ['Confirmation destructive action', /\.confirmation-dialog\s+\.danger-action\b/],
    ['Confirmation cancel action', /\.confirmation-dialog\s+\.dialog-cancel\b/]
  ].flatMap(([name, selector]) =>
    hasMinimumTouchTarget(mobileStyles, selector as RegExp) ? [] : [name as string]
  )

  expect(missingTouchTargets).toEqual([])
})

test('keeps all mobile action classes at 44px despite nested overrides', () => {
  const mobileStyles = mobileDashboardStyles()

  expect(mobileStyles).not.toBeNull()
  if (mobileStyles === null) return

  const missingTouchTargets = [
    ['Primary action', /\.primary-action\b/],
    ['Secondary action', /\.secondary-action\b/],
    ['Danger action', /\.danger-action\b/],
    ['File action', /\.file-action\b/],
    ['Selection secondary action', /\.selection-bar\s+\.secondary-action\b/],
    ['Selection danger action', /\.selection-bar\s+\.danger-action\b/],
    ['Write readiness secondary action', /\.write-readiness-notice\s+\.secondary-action\b/]
  ].flatMap(([name, selector]) =>
    hasMinimumTouchTarget(mobileStyles, selector as RegExp) ? [] : [name as string]
  )

  expect(missingTouchTargets).toEqual([])
})

function mobileDashboardStyles(): string | null {
  const mobileQuery = /@media\s*\(\s*max-width\s*:\s*700px\s*\)\s*\{/.exec(styles)
  if (mobileQuery === null || mobileQuery.index === undefined) return null

  const bodyStart = mobileQuery.index + mobileQuery[0].length
  let depth = 1
  for (let index = bodyStart; index < styles.length; index += 1) {
    if (styles[index] === '{') depth += 1
    if (styles[index] === '}') depth -= 1
    if (depth === 0) return styles.slice(bodyStart, index)
  }

  return null
}

function hasMinimumTouchTarget(mobileStyles: string, selector: RegExp): boolean {
  return cssRulesFor(mobileStyles, selector).some(({declarations}) =>
    /(?:min-height|min-block-size):\s*(?:4[4-9]|[5-9]\d|\d{3,})px/.test(declarations)
  )
}

function mobileRulesFor(mobileStyles: string, selector: RegExp): readonly {
  readonly declarations: string
}[] {
  return cssRulesFor(mobileStyles, selector)
}

function cssRulesFor(cssText: string, selector: RegExp): readonly {
  readonly declarations: string
}[] {
  return [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
    ([, selectors, declarations]) =>
      selector.test(selectors ?? '') ? [{declarations: declarations ?? ''}] : []
  )
}

function hidesContent(declarations: string): boolean {
  return /display:\s*none|visibility:\s*(?:hidden|collapse)|opacity:\s*0(?:\.0+)?\s*(?:;|$)|clip(?:-path)?:|(?:width|height|inline-size|block-size):\s*1px|position:\s*absolute|overflow:\s*hidden/.test(declarations)
}
