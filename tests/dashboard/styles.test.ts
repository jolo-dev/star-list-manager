import {expect, test} from 'bun:test'
import {readFile} from 'node:fs/promises'

const styles = await readFile(
  new URL('../../src/dashboard/styles.css', import.meta.url),
  'utf8'
)

const criticalRoles = [
  '--canvas',
  '--surface',
  '--surface-strong',
  '--surface-muted',
  '--text-primary',
  '--text-secondary',
  '--text-placeholder',
  '--text-disabled',
  '--surface-disabled',
  '--border-disabled',
  '--surface-noop',
  '--text-noop',
  '--surface-nav-active',
  '--text-nav-count-active',
  '--surface-success',
  '--text-success',
  '--surface-warning',
  '--text-warning',
  '--surface-danger',
  '--text-danger',
  '--action-primary',
  '--action-primary-text',
  '--action-danger',
  '--action-danger-text',
  '--action-danger-hover',
  '--action-danger-hover-text',
  '--border-control',
  '--focus-ring',
  '--border-selected',
  '--border-current'
] as const

const contrastPairs = [
  ...(['--canvas', '--surface', '--surface-strong'] as const).flatMap((surface) => [
    ['--text-primary', surface, 4.5] as const,
    ['--text-secondary', surface, 4.5] as const,
    ['--border-control', surface, 3] as const,
    ['--focus-ring', surface, 3] as const
  ]),
  ['--text-placeholder', '--surface', 4.5] as const,
  ['--text-disabled', '--surface-disabled', 4.5] as const,
  ['--border-disabled', '--surface-disabled', 3] as const,
  ['--text-noop', '--surface-noop', 4.5] as const,
  ['--text-nav-count-active', '--surface-nav-active', 4.5] as const,
  ['--text-success', '--surface-success', 4.5] as const,
  ['--text-warning', '--surface-warning', 4.5] as const,
  ['--text-danger', '--surface-danger', 4.5] as const,
  ['--action-primary-text', '--action-primary', 4.5] as const,
  ['--action-danger-text', '--action-danger', 4.5] as const,
  ['--action-danger-hover-text', '--action-danger-hover', 4.5] as const,
  ['--focus-ring', '--surface-nav-active', 3] as const,
  ['--border-selected', '--surface', 3] as const,
  ['--border-current', '--surface-nav-active', 3] as const
]

test('defines the local Geist visual system and required slate foundations', () => {
  const root = declarationsFor(styles, ':root')
  expect(styles).toMatch(/@font-face[\s\S]*?font-family:\s*"Geist Sans"[\s\S]*?geist-sans\/Geist-Variable\.woff2[\s\S]*?font-display:\s*swap/)
  expect(styles).toMatch(/@font-face[\s\S]*?font-family:\s*"Geist Mono"[\s\S]*?geist-mono\/GeistMono-Variable\.woff2[\s\S]*?font-display:\s*swap/)
  expect(styles).not.toMatch(/https?:\/\//i)
  expect(root).toContain('--font-prose: "Geist Sans", ui-sans-serif, sans-serif;')
  expect(root).toContain('--font-technical: "Geist Mono", monospace;')
  expect(root).toContain('--canvas: #f8fafc;')
  expect(root).toContain('--surface: #ffffff;')
  expect(root).toContain('--text-primary: #0f172a;')
  expect(root).toContain('--radius-card: 16px;')
  expect(root).toMatch(/--shadow-card:\s*0 4px 20px/)
  expect(root).not.toMatch(/--archive-/)
  expect(ruleFor(styles, 'body')).toMatch(/font-family:\s*var\(--font-prose\)/)
  expect(declarationsFor(styles, ':root')).toContain('--measure-prose: 70ch;')
})

test('builds a sticky 64px material header with an opaque fallback', () => {
  const header = exactRuleFor(styles, ['.app-header'])
  expect(header).toMatch(/position:\s*sticky/)
  expect(header).toMatch(/min-height:\s*64px/)
  expect(header).toMatch(/border-bottom:\s*1px solid var\(--border-subtle\)/)
  expect(header).toMatch(/background:\s*var\(--surface\);[\s\S]*background:\s*var\(--header-material\);/)
  expect(header).toMatch(/backdrop-filter:\s*blur\(/)
  expect(header).toMatch(/-webkit-backdrop-filter:\s*blur\(/)
  expect(ruleFor(styles, '.app-brand')).not.toBe('')
  expect(ruleFor(styles, '.primary-navigation-list')).not.toBe('')
  expect(ruleFor(styles, '.account-indicator')).not.toBe('')

  const dark = extractMedia(styles, '(prefers-color-scheme: dark)')
  expect(declarationsFor(dark, ':root')).toMatch(/--header-material:\s*rgb\(/)
})

test('flattens the desktop toolbar into one four-control row only above 1180px', () => {
  const container = exactRuleFor(styles, ['.archive-filter-container'])
  expect(container).toMatch(/display:\s*grid/)

  const desktop = extractMedia(styles, '(min-width: 1181px)')
  const actions = exactRuleFor(desktop, ['.library-actions'])
  expect(actions).toMatch(/display:\s*grid/)
  expect(actions).toMatch(
    /grid-template-columns:\s*minmax\([^;]+\) auto auto auto/
  )
  expect(actions).toMatch(/align-items:\s*end/)
  expect(actions).not.toMatch(/flex-wrap/)
  expect(exactRuleFor(desktop, ['.archive-filter-container'])).toMatch(
    /display:\s*contents/
  )
  expect(ruleFor(desktop, '.archive-filter-heading')).toMatch(/position:\s*absolute/)
  expect(ruleFor(desktop, '.advanced-filters')).toMatch(/margin-top:\s*0/)
  for (const selector of [
    '.search-field input,',
    '.refresh-button,',
    '.view-options > summary,',
    '.advanced-filters summary'
  ]) {
    expect(ruleFor(desktop, selector), selector).toMatch(/min-height:\s*44px/)
  }

  const stacked = extractMedia(styles, '(max-width: 1180px)')
  expect(ruleFor(stacked, '.library-actions')).toMatch(/display:\s*flex/)
  expect(ruleFor(stacked, '.library-actions')).toMatch(/flex-wrap:\s*wrap/)
})

test('uses a centered desktop frame and a sticky My Lists rail', () => {
  const frame = exactRuleFor(styles, ['.app-frame'])
  const sidebar = exactRuleFor(styles, ['.list-sidebar'])
  expect(frame).toMatch(/max-width:\s*1440px/)
  expect(frame).toMatch(/margin-inline:\s*auto/)
  expect(frame).toMatch(/grid-template-columns:\s*256px minmax\(0,\s*1fr\)/)
  expect(sidebar).toMatch(/position:\s*sticky/)
  expect(sidebar).toMatch(/top:\s*64px/)
  expect(sidebar).toMatch(/align-self:\s*start/)
  expect(sidebar).toMatch(/max-height:\s*calc\(100dvh - 64px\)/)
  expect(sidebar).toMatch(/overflow-y:\s*auto/)
  expect(ruleFor(styles, '.list-sidebar-heading')).not.toMatch(/border-radius:\s*999px/)
})

test('styles list navigation with a dark current state and count pills only', () => {
  const current = exactRuleFor(styles, ['.nav-item[aria-current="page"]'])
  const count = exactRuleFor(styles, ['.list-count'])
  expect(current).toMatch(/color:\s*var\(--action-primary-text\)/)
  expect(current).toMatch(/background:\s*var\(--surface-nav-active\)/)
  expect(current).toMatch(/border-color:\s*var\(--border-current\)/)
  expect(count).toMatch(/border-radius:\s*999px/)
  expect(exactRuleFor(styles, ['.nav-item[aria-current="page"] .list-count'])).toMatch(
    /color:\s*var\(--text-nav-count-active\)/
  )
  expect(ruleFor(styles, '.list-marker')).not.toBe('')
  for (const selector of ['.list-sidebar', '.library-header', '.results-panel', '.settings-page']) {
    expect(ruleFor(styles, selector), selector).not.toMatch(/border-radius:\s*999px/)
  }
})

test('lays repository cards out three, two, then one column', () => {
  const grid = exactRuleFor(styles, ['.repository-card-grid'])
  const shell = exactRuleFor(styles, ['.repository-card-shell'])
  const card = exactRuleFor(styles, ['.repository-row.repository-card'])
  expect(grid).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  expect(shell).toMatch(/border:\s*1px solid var\(--border-subtle\)/)
  expect(shell).toMatch(/border-radius:\s*var\(--radius-card\)/)
  expect(shell).toMatch(/box-shadow:\s*var\(--shadow-card\)/)
  expect(card).toMatch(/display:\s*grid/)
  expect(card).toMatch(/grid-template-columns:\s*1fr/)
  expect(card).toMatch(/grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/)
  expect(card).not.toMatch(/grid-template-rows:[^;]*auto auto/)
  expect(card).toMatch(/min-width:\s*0/)
  expect(card).toMatch(/padding:\s*22px/)
  expect(card).toMatch(/transition:[^;]*transform/)
  expect(compareSpecificity(specificity('.repository-row.repository-card'), specificity('.repository-row'))).toBeGreaterThan(0)

  const tablet = extractMedia(styles, '(max-width: 1024px)')
  const mobile = extractMedia(styles, '(max-width: 700px)')
  expect(ruleFor(tablet, '.repository-card-grid')).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  expect(ruleFor(mobile, '.repository-card-grid')).toMatch(/grid-template-columns:\s*1fr/)
})

test('keeps the real compound card hover, focus, and selection light and intact', () => {
  const hover = exactRuleFor(styles, ['.repository-row.repository-card:hover'])
  const focus = exactRuleFor(styles, ['.repository-row.repository-card:focus-visible'])
  const selected = exactRuleFor(styles, ['.repository-row.repository-card.is-selected'])
  expect(hover).toMatch(/background:\s*var\(--surface-muted\)/)
  expect(hover).toMatch(/transform:\s*translateY\(-2px\)/)
  expect(hover).not.toMatch(/(?:surface-inverse|action-primary)/)
  expect(hover).not.toMatch(/color:/)
  expect(focus).toMatch(/outline:\s*3px solid var\(--focus-ring\)/)
  expect(selected).toMatch(/background:\s*var\(--surface-noop\)/)
  expect(selected).toMatch(/outline:\s*3px solid var\(--border-selected\)/)
  expect(styles).not.toMatch(/\.repository-card:hover[^{}]*\{[^{}]*(?:#000|surface-inverse|text-inverse)/i)
})

test('uses one bounded dashboard entry rhythm without hiding default content', () => {
  expect(styles).toMatch(/@keyframes\s+dashboard-enter\s*\{[\s\S]*opacity:[\s\S]*transform:\s*translateY/)
  const entrants = exactRuleFor(styles, [
    '.list-sidebar',
    '.library-heading',
    '.repository-card-shell'
  ])
  expect(entrants).toMatch(/animation:\s*dashboard-enter\s+[12]\d{2}ms\s+cubic-bezier\([^)]*\)\s*both/)
  expect(entrants).not.toMatch(/opacity:\s*0/)
  expect(entrants).not.toMatch(/display:|height:|width:|margin:|padding:/)
  expect(ruleFor(styles, '.repository-card-shell:nth-child')).toMatch(/--enter-delay:/)
  const reduced = extractMedia(styles, '(prefers-reduced-motion: reduce)')
  expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
  expect(reduced).toMatch(/transform:\s*none\s*!important/)
})

test('resolves complete contrast-safe light and dark semantic palettes', () => {
  const light = tokenMap(declarationsFor(styles, ':root'))
  const darkStyles = extractMedia(styles, '(prefers-color-scheme: dark)')
  const darkOverrides = tokenMap(declarationsFor(darkStyles, ':root'))
  const dark = new Map(light)
  for (const [name, value] of darkOverrides) dark.set(name, value)

  expect([...criticalRoles].filter((role) => !darkOverrides.has(role))).toEqual([])
  for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
    for (const role of criticalRoles) {
      expect(resolveToken(tokens, role), `${theme} ${role}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
    for (const [foreground, background, threshold] of contrastPairs) {
      const ratio = contrast(resolveToken(tokens, foreground), resolveToken(tokens, background))
      expect(ratio, `${theme}: ${foreground} on ${background} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(threshold)
    }
  }
  expect(resolveToken(light, '--action-danger-hover')).not.toBe(resolveToken(light, '--text-danger'))
  expect(resolveToken(dark, '--action-danger-hover')).not.toBe(resolveToken(dark, '--text-danger'))
  expect(() => resolveToken(new Map(), '--missing')).toThrow('Missing token --missing')
  expect(() => resolveToken(new Map([['--first', 'var(--second)'], ['--second', 'var(--first)']]), '--first')).toThrow('Token cycle at --first')
})

test('uses semantic control, placeholder, disabled, and danger roles', () => {
  const placeholders = exactRuleFor(styles, [
    '.library-actions input::placeholder',
    '.annotation-editor input::placeholder',
    '.annotation-editor textarea::placeholder'
  ])
  const disabled = exactRuleFor(styles, ['button:disabled', 'input:disabled', 'select:disabled', 'textarea:disabled'])
  const danger = exactRuleFor(styles, ['.danger-action', '.clear-filters'])
  const dangerHover = exactRuleFor(styles, ['.danger-action:hover:not(:disabled)', '.clear-filters:hover:not(:disabled)'])
  expect(placeholders).toMatch(/color:\s*var\(--text-placeholder\)/)
  expect(disabled).toMatch(/color:\s*var\(--text-disabled\)/)
  expect(disabled).toMatch(/background:\s*var\(--surface-disabled\)/)
  expect(disabled).toMatch(/border-color:\s*var\(--border-disabled\)/)
  expect(disabled).not.toMatch(/opacity:/)
  expect(danger).toMatch(/color:\s*var\(--action-danger-text\)/)
  expect(danger).toMatch(/background:\s*var\(--action-danger\)/)
  expect(dangerHover).toMatch(/color:\s*var\(--action-danger-hover-text\)/)
  expect(dangerHover).toMatch(/background:\s*var\(--action-danger-hover\)/)
})

test('keeps prose readable and compact metadata technical', () => {
  expect(ruleFor(styles, '.state-copy,')).toMatch(/max-width:\s*var\(--measure-prose\)/)
  expect(ruleFor(styles, '.state-copy,')).toMatch(/font-size:\s*var\(--type-reading-size\)/)
  const repositoryTitle = exactRuleFor(styles, ['.repository-row h2'])
  expect(repositoryTitle).toMatch(/font-family:\s*var\(--font-prose\)/)
  const data = exactRuleFor(styles, ['.repository-owner', '.repository-meta', '.batch-status', '.operation-history-list span'])
  expect(data).toMatch(/font-family:\s*var\(--font-technical\)/)
  expect(data).toMatch(/font-size:\s*var\(--type-data-size\)/)
  expect(ruleFor(styles, '.repository-card-facts')).toMatch(
    /font-family:\s*var\(--font-technical\)/
  )
  expect(ruleFor(styles, '.list-count')).toMatch(/font-family:\s*var\(--font-technical\)/)
  const operationalCopy = exactRuleFor(styles, ['.job-error', '.operation-history-list p', '.membership-job-detail'])
  expect(operationalCopy).toMatch(/font-family:\s*var\(--font-prose\)/)
  expect(operationalCopy).toMatch(/max-width:\s*var\(--measure-prose\)/)
})

test('styles all operational, state, settings, and safety surfaces', () => {
  for (const selector of [
    '.status-banner', '.status-banner.is-success', '.status-banner.is-warning', '.status-banner.is-error',
    '.status-failed', '.status-blocked-unknown', '.status-retry-waiting', '.status-queued', '.status-succeeded',
    '.state-panel', '.skeleton-row', '.empty-results', '.selection-bar', '.confirmation-dialog',
    '.repository-inspection-dialog', '.membership-controls', '.membership-preview-card', '.operation-history-list',
    '.operations-page', '.settings-page', '.settings-card', '.write-auth-card', '.auth-code',
    '.native-list-rename-editor', '.no-undo-note', '.file-action'
  ]) {
    expect(ruleFor(styles, selector), selector).not.toBe('')
  }
  const inspectionDialog = ruleFor(styles, '.repository-inspection-dialog')
  const confirmationDialog = ruleFor(styles, '.confirmation-dialog')
  expect(inspectionDialog).toMatch(/max-height:\s*calc\(100dvh - 48px\)/)
  expect(inspectionDialog).toMatch(/overflow-y:\s*auto/)
  expect(confirmationDialog).toMatch(/max-height:\s*min\(760px,\s*calc\(100dvh - 40px\)\)/)
  expect(confirmationDialog).toMatch(/overflow-y:\s*auto/)
})

test('wraps user content and preserves mobile controls and reflow', () => {
  for (const selector of [
    '.nav-label',
    '.native-list-name',
    '.native-list-choices label > span:not(.no-op-label)',
    '.repository-row h2',
    '.repository-owner',
    '.repository-card-facts > span',
    '.repository-meta > span',
    '.confirmation-list li',
    '.inspector-heading h2',
    '.account-login'
  ]) {
    expect(ruleFor(styles, selector), selector).toMatch(/overflow-wrap:\s*anywhere/)
    expect(ruleFor(styles, selector), selector).not.toMatch(/(?:text-overflow:\s*ellipsis|overflow:\s*(?:hidden|clip))/)
  }
  for (const selector of [
    '.repository-card-reference',
    '.repository-card-footer',
    '.repository-card-facts',
    '.repository-row-main',
    '.repository-row-summary',
    '.repository-row-facts',
    '.repository-meta',
    '.native-list-header-title'
  ]) {
    expect(ruleFor(styles, selector), selector).toMatch(/min-width:\s*0/)
  }
  expect(ruleFor(styles, '.repository-card-footer')).toMatch(/flex-wrap:\s*wrap/)
  expect(styles).not.toMatch(/(?:html|body)[^{}]*\{[^{}]*overflow-x:\s*(?:hidden|clip)/)

  const rowDescription = exactRuleFor(styles, ['.repository-row .repository-description'])
  const cardDescription = exactRuleFor(styles, ['.repository-row.repository-card .repository-description'])
  expect(rowDescription).toMatch(/display:\s*-webkit-box/)
  expect(rowDescription).toMatch(/overflow:\s*hidden/)
  expect(rowDescription).toMatch(/-webkit-box-orient:\s*vertical/)
  expect(rowDescription).toMatch(/-webkit-line-clamp:\s*2/)
  expect(cardDescription).toMatch(/-webkit-line-clamp:\s*3/)
  expect(exactRuleFor(styles, ['.repository-row p'])).not.toMatch(/(?:overflow:\s*hidden|-webkit-line-clamp)/)

  const mobile = extractMedia(styles, '(max-width: 700px)')
  expect(ruleFor(mobile, '.app-frame')).toMatch(/grid-template-columns:\s*1fr/)
  expect(ruleFor(mobile, '.list-sidebar')).toMatch(/position:\s*static/)
  expect(ruleFor(mobile, '.list-sidebar')).toMatch(/max-height:\s*none/)
  expect(ruleFor(mobile, '.selection-control')).toMatch(/min-inline-size:\s*44px/)
  expect(ruleFor(mobile, '.selection-control')).toMatch(/min-block-size:\s*44px/)
  for (const selector of ['.nav-item', '.nav-group > summary', '.primary-action,', '.triage-actions button,', '.native-list-choices label,', '.result-mode-controls button']) {
    expect(ruleFor(mobile, selector), selector).toMatch(/min-height:\s*44px/)
  }
  expect(ruleFor(mobile, '.library-actions input,')).toMatch(/font-size:\s*16px/)
  expect(ruleFor(mobile, '.inspector-heading,')).toMatch(/flex-direction:\s*column/)
  expect(ruleFor(mobile, '.inspector-actions')).toMatch(/justify-content:\s*flex-start/)
  expect(ruleFor(mobile, '.dialog-backdrop')).toMatch(/place-items:\s*end center/)
})

test('keeps retained native List management content in the existing operating rhythm', () => {
  const content = exactRuleFor(styles, ['.native-list-management-content'])
  expect(content).toMatch(/display:\s*grid/)
  expect(content).toMatch(/gap:\s*20px/)
})

test('uses transform-only bounded skeleton shimmer', () => {
  expect(styles).not.toMatch(/@keyframes[^{}]*shimmer[\s\S]*?background-position/)
  expect(ruleFor(styles, '.skeleton-row')).toMatch(/overflow:\s*hidden/)
  expect(exactRuleFor(styles, ['.skeleton-row::after'])).toMatch(/animation:\s*shimmer[^;]*;/)
  expect(exactRuleFor(styles, ['.skeleton-row::after'])).toMatch(/transform:\s*translateX/)
  expect(styles).toMatch(/@keyframes\s+shimmer\s*\{\s*to\s*\{\s*transform:\s*translateX/)
})

test('maps forced colors after components with explicit selected, focus, status, and link states', () => {
  const forced = extractMedia(styles, '(forced-colors: active)')
  const selected = exactRuleFor(forced, ['.nav-item[aria-current="page"]', '.repository-row.is-selected'])
  expect(selected).toMatch(/background:\s*Highlight\s*!important/)
  expect(selected).toMatch(/color:\s*HighlightText\s*!important/)
  expect(selected).toMatch(/border-color:\s*Highlight\s*!important/)
  expect(selected).toMatch(/forced-color-adjust:\s*none/)
  expect(exactRuleFor(forced, ['.repository-card.is-selected'])).toMatch(/background:\s*Highlight\s*!important/)
  const selectedDescendants = exactRuleFor(forced, [
    '.repository-row.is-selected *',
    '.repository-card.is-selected *'
  ])
  expect(selectedDescendants).toMatch(/color:\s*HighlightText\s*!important/)

  const controls = exactRuleFor(forced, ['button', 'input', 'select', 'textarea', '.file-action'])
  expect(controls).toMatch(/background:\s*ButtonFace\s*!important/)
  expect(controls).toMatch(/color:\s*ButtonText\s*!important/)
  expect(controls).toMatch(/border-color:\s*ButtonText\s*!important/)

  const disabledControls = exactRuleFor(forced, [
    'button:disabled',
    'input:disabled',
    'select:disabled',
    'textarea:disabled'
  ])
  expect(disabledControls).toMatch(/color:\s*GrayText\s*!important/)
  expect(disabledControls).toMatch(/background:\s*ButtonFace\s*!important/)
  expect(disabledControls).toMatch(/border-color:\s*GrayText\s*!important/)
  expect(cascadeWinner(forced, forced, 'button', 'button:disabled', 'color')).toBe('forced')
  expect(cascadeWinner(styles, forced, '.danger-action', 'button:disabled', 'color')).toBe('forced')

  const focusSelectors = [
    'button:focus-visible', 'input:focus-visible', 'select:focus-visible', 'textarea:focus-visible',
    'summary:focus-visible', '.repository-row:focus-visible', '.selection-control:focus-within',
    '.nav-item:focus-visible', '.file-action:focus-within'
  ]
  expect(exactRuleFor(forced, focusSelectors)).toMatch(/outline:\s*3px solid Highlight\s*!important/)
  const statuses = exactRuleFor(forced, ['.status-banner', '.status-banner.is-success', '.status-banner.is-warning', '.status-banner.is-error'])
  expect(statuses).toMatch(/background:\s*Canvas\s*!important/)
  expect(statuses).toMatch(/color:\s*CanvasText\s*!important/)
  expect(statuses).toMatch(/border-color:\s*CanvasText\s*!important/)
  expect(exactRuleFor(forced, ['a'])).toMatch(/color:\s*LinkText\s*!important/)

  const base = styles.slice(0, styles.indexOf('@media (forced-colors: active)'))
  for (const [baseSelector, forcedSelector, property] of [
    ['.primary-action', 'button', 'background'],
    ['.library-actions input', 'input', 'background'],
    ['.github-link', 'a', 'color'],
    ['.repository-row.is-selected', '.repository-row.is-selected', 'background'],
    ['.nav-item[aria-current="page"]', '.nav-item[aria-current="page"]', 'background'],
    ['.status-banner.is-error', '.status-banner.is-error', 'background']
  ] as const) {
    expect(cascadeWinner(base, forced, baseSelector, forcedSelector, property), `${forcedSelector} ${property}`).toBe('forced')
  }
})

type ParsedRule = {
  readonly selectors: readonly string[]
  readonly declarations: string
  readonly index: number
}

function parseRules(css: string): readonly ParsedRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '').split(',').map((selector) => selector.trim()),
    declarations: match[2] ?? '',
    index: match.index ?? 0
  }))
}

function exactRuleFor(css: string, expectedSelectors: readonly string[]): string {
  const expected = [...expectedSelectors].sort()
  return parseRules(css).find((rule) =>
    [...rule.selectors].sort().every((selector, index) => selector === expected[index]) &&
    rule.selectors.length === expected.length
  )?.declarations ?? ''
}

function cascadeWinner(baseCss: string, forcedCss: string, baseSelector: string, forcedSelector: string, property: string): 'base' | 'forced' {
  const base = lastDeclaration(baseCss, baseSelector, property)
  const forced = lastDeclaration(forcedCss, forcedSelector, property)
  if (!base || !forced) return 'base'
  if (base.important !== forced.important) return forced.important ? 'forced' : 'base'
  const specificityDifference = compareSpecificity(specificity(forcedSelector), specificity(baseSelector))
  if (specificityDifference !== 0) return specificityDifference > 0 ? 'forced' : 'base'
  return 'forced'
}

function lastDeclaration(css: string, selector: string, property: string): {readonly important: boolean} | null {
  const propertyPattern = new RegExp(`(?:^|;)\\s*${escapeRegex(property)}\\s*:\\s*([^;]+)`, 'm')
  return parseRules(css).flatMap((rule) => {
    if (!rule.selectors.includes(selector)) return []
    const value = rule.declarations.match(propertyPattern)?.[1]
    return value ? [{important: /!important\s*$/.test(value), index: rule.index}] : []
  }).at(-1) ?? null
}

function specificity(selector: string): readonly [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0
  const withoutModifiers = selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, ' ')
  const elements = withoutModifiers.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi)?.filter((element) => !element.trim().startsWith('*')).length ?? 0
  return [ids, classes, elements]
}

function compareSpecificity(first: readonly [number, number, number], second: readonly [number, number, number]): number {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return (first[index] ?? 0) - (second[index] ?? 0)
  }
  return 0
}

function declarationsFor(css: string, selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) => selectors?.trim() === selector)?.[2] ?? ''
}

function ruleFor(css: string, selectorFragment: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors?.includes(selectorFragment))
    .map(([, , declarations]) => declarations ?? '')
    .join('\n')
}

function extractMedia(css: string, query: string): string {
  const match = css.match(new RegExp(`@media\\s*\\(${escapeRegex(query.slice(1, -1))}\\)\\s*\\{`))
  if (!match || match.index === undefined) return ''
  const start = match.index + match[0].length
  let depth = 1
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(start, index)
  }
  return ''
}

function tokenMap(declarations: string): Map<string, string> {
  return new Map([...declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name ?? '', value?.trim() ?? '']))
}

function resolveToken(tokens: ReadonlyMap<string, string>, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Token cycle at ${name}`)
  const value = tokens.get(name)
  if (!value) throw new Error(`Missing token ${name}`)
  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  if (!reference) return value
  return resolveToken(tokens, reference, new Set([...seen, name]))
}

function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
  }
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return ((bright ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
