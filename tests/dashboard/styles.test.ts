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

test('Archive.Stars provides a self-contained light archive token system and structural boundaries', () => {
  const root = declarationsFor(styles, ':root')

  for (const token of ['--archive-canvas', '--archive-ink', '--archive-muted', '--archive-line']) {
    expect(root, token).toMatch(new RegExp(`${token}:\\s*#[0-9a-f]{6};`, 'i'))
  }
  expect(styles).not.toMatch(/https?:\/\//i)

  expect(ruleFor(styles, '.archive-app-header')).toMatch(/position:\s*sticky/)
  expect(ruleFor(styles, '.archive-app-header')).toMatch(/border-bottom:\s*1px solid var\(--archive-line\)/)
  expect(ruleFor(styles, '.archive-workspace-frame')).toMatch(/grid-template-columns:/)
  expect(ruleFor(styles, '.archive-directory')).toMatch(/border-right:\s*1px solid var\(--archive-line\)/)
  expect(ruleFor(styles, '.repository-row-shell + .repository-row-shell')).toMatch(
    /border-top:\s*1px solid var\(--archive-line\)/
  )
})

test('Archive.Stars styles its shell, library, state, and dialog primitives', () => {
  const primitives = [
    '.archive-app-shell',
    '.archive-app-header',
    '.archive-brand',
    '.archive-star-mark',
    '.archive-wordmark',
    '.archive-utilities',
    '.archive-directory',
    '.archive-filter-container',
    '.library-header',
    '.library-actions',
    '.archive-results',
    '.repository-row',
    '.state-panel',
    '.operations-page',
    '.settings-page',
    '.confirmation-dialog',
    '.repository-inspection-dialog'
  ]

  for (const selector of primitives) {
    expect(ruleFor(styles, selector), selector).not.toBe('')
  }
  expect(ruleFor(styles, '.archive-wordmark')).toMatch(/font-family:\s*var\(--font-technical\)/)
  expect(ruleFor(styles, '.archive-directory-heading,')).toMatch(/text-transform:\s*uppercase/)
  expect(ruleFor(styles, '.archive-repository-reference')).toMatch(/font-family:\s*var\(--font-technical\)/)
})

test('Archive.Stars keeps controls operable across narrow, dark, reduced-motion, and forced-color modes', () => {
  const mobile = extractMedia(styles, '(max-width: 700px)')
  const dark = extractMedia(styles, '(prefers-color-scheme: dark)')
  const forced = extractMedia(styles, '(forced-colors: active)')
  const reduced = extractMedia(styles, '(prefers-reduced-motion: reduce)')

  expect(mobile).not.toBe('')
  expect(ruleFor(mobile, '.archive-workspace-frame')).toMatch(/grid-template-columns:\s*1fr/)
  expect(ruleFor(mobile, '.archive-directory')).toMatch(/border-right:\s*0/)
  expect(ruleFor(mobile, '.archive-utilities')).not.toMatch(/display:\s*none/)
  expect(ruleFor(mobile, '.nav-item')).toMatch(/min-height:\s*44px/)
  expect(ruleFor(mobile, '.selection-control')).toMatch(/min-inline-size:\s*44px/)
  expect(styles).not.toMatch(/(?:html|body)[^{}]*\{[^{}]*overflow-x:\s*hidden/)

  for (const token of ['--archive-canvas', '--archive-ink', '--archive-muted', '--archive-line']) {
    expect(declarationsFor(dark, ':root'), `dark ${token}`).toMatch(
      new RegExp(`${token}:\\s*#[0-9a-f]{6};`, 'i')
    )
  }
  expect(reduced).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
  expect(exactRuleFor(forced, ['.nav-item[aria-current="page"]', '.repository-row.is-selected']))
    .toMatch(/background:\s*Highlight\s*!important/)
  expect(exactRuleFor(forced, ['.status-banner', '.status-banner.is-success', '.status-banner.is-warning', '.status-banner.is-error']))
    .toMatch(/color:\s*CanvasText\s*!important/)
  expect(exactRuleFor(forced, ['button', 'input', 'select', 'textarea', '.file-action']))
    .toMatch(/border-color:\s*ButtonText\s*!important/)
})

const contrastPairs = [
  ...(['--canvas', '--surface', '--surface-strong'] as const).flatMap((surface) => [
    ['--text-primary', surface, 4.5] as const,
    ['--text-secondary', surface, 4.5] as const,
    ['--border-control', surface, 3] as const,
    ['--border-disabled', surface, 3] as const,
    ['--focus-ring', surface, 3] as const
  ]),
  ['--text-placeholder', '--surface', 4.5] as const,
  ['--text-placeholder', '--surface-strong', 4.5] as const,
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

test('defines composed prose and technical typography roles', () => {
  const root = declarationsFor(styles, ':root')

  expect(root).toContain(
    '--font-prose: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;'
  )
  expect(root).toContain(
    '--font-technical: "Geist Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;'
  )
  expect(root).toContain('--type-reading-size: 1rem;')
  expect(root).toContain('--measure-prose: 66ch;')
  expect(styles).toMatch(/@font-face[\s\S]*?font-family:\s*"Geist Mono"[\s\S]*?font-display:\s*swap/)

  expect(ruleFor(styles, 'body')).toMatch(/font-family:\s*var\(--font-prose\)/)
  expect(ruleFor(styles, 'button,\ninput,\nselect,\ntextarea')).toMatch(
    /font-family:\s*var\(--font-prose\)/
  )
  expect(ruleFor(styles, '.confirmation-dialog')).toMatch(/font-family:\s*var\(--font-prose\)/)
  expect(ruleFor(styles, '.state-copy,')).toMatch(/max-width:\s*var\(--measure-prose\)/)
  expect(ruleFor(styles, '.state-copy,')).toMatch(/font-size:\s*var\(--type-reading-size\)/)

  for (const selector of [
    '.brand',
    '.repository-meta',
    '.result-count',
    '.mutation-status,',
    '.auth-code'
  ]) {
    expect(ruleFor(styles, selector), selector).toMatch(/font-family:\s*var\(--font-technical\)/)
  }

  const longOperationalCopy = exactRuleFor(
    styles,
    ['.job-error', '.operation-history-list p', '.membership-job-detail']
  )
  expect(longOperationalCopy).toMatch(/font-family:\s*var\(--font-prose\)/)
  expect(longOperationalCopy).toMatch(/font-size:\s*var\(--type-reading-size\)/)
  expect(longOperationalCopy).toMatch(/line-height:\s*var\(--type-leading-reading\)/)
  expect(longOperationalCopy).toMatch(/max-width:\s*var\(--measure-prose\)/)

  const technicalOperationalData = exactRuleFor(styles, [
    '.repository-owner',
    '.repository-meta',
    '.batch-status',
    '.operation-history-list span'
  ])
  expect(technicalOperationalData).toMatch(/font-family:\s*var\(--font-technical\)/)
  expect(technicalOperationalData).toMatch(/font-size:\s*var\(--type-data-size\)/)
})

test('resolves complete contrast-safe light and dark semantic palettes', () => {
  const light = tokenMap(declarationsFor(styles, ':root'))
  const darkStyles = extractMedia(styles, '(prefers-color-scheme: dark)')
  const darkOverrides = tokenMap(declarationsFor(darkStyles, ':root'))
  const dark = new Map(light)
  for (const [name, value] of darkOverrides) dark.set(name, value)

  expect(darkStyles).not.toBe('')
  expect([...criticalRoles].filter((role) => !darkOverrides.has(role))).toEqual([])

  for (const [theme, tokens] of [
    ['light', light],
    ['dark', dark]
  ] as const) {
    for (const role of criticalRoles) {
      expect(resolveToken(tokens, role), `${theme} ${role}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
    for (const [foreground, background, threshold] of contrastPairs) {
      const ratio = contrast(resolveToken(tokens, foreground), resolveToken(tokens, background))
      expect(ratio, `${theme}: ${foreground} on ${background} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        threshold
      )
    }
  }

  expect(resolveToken(light, '--action-danger-hover')).not.toBe(
    resolveToken(light, '--text-danger')
  )
  expect(resolveToken(dark, '--action-danger-hover')).not.toBe(
    resolveToken(dark, '--text-danger')
  )

  expect(() => resolveToken(new Map(), '--missing')).toThrow('Missing token --missing')
  expect(() =>
    resolveToken(
      new Map([
        ['--first', 'var(--second)'],
        ['--second', 'var(--first)']
      ]),
      '--first'
    )
  ).toThrow('Token cycle at --first')
})

test('uses dedicated contrast-safe danger action roles for default and hover states', () => {
  const defaultDanger = exactRuleFor(styles, ['.danger-action', '.clear-filters'])
  const hoverDanger = exactRuleFor(styles, [
    '.danger-action:hover:not(:disabled)',
    '.clear-filters:hover:not(:disabled)'
  ])

  expect(defaultDanger).toMatch(/color:\s*var\(--action-danger-text\)/)
  expect(defaultDanger).toMatch(/background:\s*var\(--action-danger\)/)
  expect(hoverDanger).toMatch(/color:\s*var\(--action-danger-hover-text\)/)
  expect(hoverDanger).toMatch(/background:\s*var\(--action-danger-hover\)/)
  expect(hoverDanger).not.toMatch(/background:\s*var\(--(?:text-)?danger\)/)
})

test('uses semantic placeholder and disabled control treatments without readable opacity', () => {
  const placeholders = ruleFor(styles, '.library-actions input::placeholder,')
  const disabled = ruleFor(styles, 'button:disabled,')

  expect(placeholders).toMatch(/color:\s*var\(--text-placeholder\)/)
  expect(placeholders).not.toMatch(/color:\s*#[\da-f]{3,8}/i)
  expect(disabled).toMatch(/color:\s*var\(--text-disabled\)/)
  expect(disabled).toMatch(/background:\s*var\(--surface-disabled\)/)
  expect(disabled).toMatch(/border-color:\s*var\(--border-disabled\)/)
  expect(disabled).not.toMatch(/opacity:/)

  const componentRules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, selectors]) => selectors?.trim() !== ':root'
  )
  const readableOpacity = componentRules.filter(([, selectors, declarations]) => {
    if (selectors?.trim() === '.file-action input') return false
    return /opacity:/.test(declarations ?? '')
  })
  expect(readableOpacity.map(([, selectors]) => selectors?.trim())).toEqual([])

  const allowedColorValues = new Set([
    '0',
    'none',
    'inherit',
    'transparent',
    'Highlight',
    'HighlightText',
    'ButtonFace',
    'ButtonText',
    'Canvas',
    'CanvasText',
    'LinkText',
    '1px solid Highlight',
    '3px solid Highlight'
  ])
  const unexpectedColorValues = componentRules.flatMap(([, selectors, declarations]) =>
    [...(declarations ?? '').matchAll(
      /(?:^|;)\s*(?:color|background(?:-color)?|border(?:-(?:left|right|top|bottom))?(?:-color)?|outline|box-shadow|text-decoration-color|accent-color)\s*:\s*([^;]+)/gm
    )].flatMap(([, value]) => {
      const normalized = value?.trim() ?? ''
      const withoutImportance = normalized.replace(/\s*!important$/, '')
      return normalized.includes('var(') || allowedColorValues.has(withoutImportance)
        ? []
        : [`${selectors?.trim()}: ${normalized}`]
    })
  )
  expect(unexpectedColorValues).toEqual([])
})

test('maps forced colors with declarations that win the component cascade', () => {
  const forced = extractMedia(styles, '(forced-colors: active)')
  expect(forced).not.toBe('')

  const selectedRule = exactRuleFor(forced, [
    '.nav-item[aria-current="page"]',
    '.repository-row.is-selected'
  ])
  expect(selectedRule).toMatch(/background:\s*Highlight\s*!important;/)
  expect(selectedRule).toMatch(/color:\s*HighlightText\s*!important;/)
  expect(selectedRule).toMatch(/border-color:\s*Highlight\s*!important;/)
  expect(selectedRule).toMatch(/forced-color-adjust:\s*none;/)

  const controlRule = exactRuleFor(forced, ['button', 'input', 'select', 'textarea', '.file-action'])
  expect(controlRule).toMatch(/background:\s*ButtonFace\s*!important;/)
  expect(controlRule).toMatch(/color:\s*ButtonText\s*!important;/)
  expect(controlRule).toMatch(/border-color:\s*ButtonText\s*!important;/)

  const focusSelectors = [
    'button:focus-visible',
    'input:focus-visible',
    'select:focus-visible',
    'textarea:focus-visible',
    'summary:focus-visible',
    '.repository-row:focus-visible',
    '.selection-control:focus-within',
    '.nav-item:focus-visible',
    '.file-action:focus-within'
  ]
  const focusRule = exactRuleFor(forced, focusSelectors)
  expect(focusRule).toMatch(/outline:\s*3px solid Highlight\s*!important;/)

  const statusSelectors = [
    '.status-banner',
    '.status-banner.is-success',
    '.status-banner.is-warning',
    '.status-banner.is-error'
  ]
  const statusRule = exactRuleFor(forced, statusSelectors)
  expect(statusRule).toMatch(/background:\s*Canvas\s*!important;/)
  expect(statusRule).toMatch(/color:\s*CanvasText\s*!important;/)
  expect(statusRule).toMatch(/border-color:\s*CanvasText\s*!important;/)
  expect(statusRule).toMatch(/forced-color-adjust:\s*none;/)
  expect(exactRuleFor(forced, ['a'])).toMatch(/color:\s*LinkText\s*!important;/)

  const cascadeCases = [
    ['.primary-action', 'button', 'background'],
    ['.library-actions input', 'input', 'background'],
    ['.github-link', 'a', 'color'],
    ['.nav-item:focus-visible', '.nav-item:focus-visible', 'outline'],
    ['.file-action:focus-within', '.file-action:focus-within', 'outline'],
    ['.repository-row.is-selected', '.repository-row.is-selected', 'background'],
    ['.nav-item[aria-current="page"]', '.nav-item[aria-current="page"]', 'background'],
    ['.status-banner.is-error', '.status-banner.is-error', 'background']
  ] as const
  const base = styles.slice(0, styles.indexOf('@media (forced-colors: active)'))
  for (const [baseSelector, forcedSelector, property] of cascadeCases) {
    expect(
      cascadeWinner(base, forced, baseSelector, forcedSelector, property),
      `${forcedSelector} ${property}`
    ).toBe('forced')
  }

  const adjustedSelectors = parseRules(forced)
    .filter((rule) => /forced-color-adjust:\s*none/.test(rule.declarations))
    .flatMap((rule) => rule.selectors)
  expect(adjustedSelectors).toEqual([
    '.nav-item[aria-current="page"]',
    '.repository-row.is-selected',
    ...statusSelectors
  ])
})

test('wraps user content and preserves readable responsive reflow', () => {
  for (const selector of [
    '.nav-label',
    '.native-list-choices label > span:not(.no-op-label)',
    '.repository-row h2',
    '.inspector-heading h2',
    '.account-login'
  ]) {
    expect(ruleFor(styles, selector), selector).toMatch(/overflow-wrap:\s*anywhere/)
  }
  expect(styles).not.toMatch(/(?:html|body)[^{}]*\{[^{}]*overflow-x:\s*hidden/)

  const mobile = extractMedia(styles, '(max-width: 700px)')
  expect(ruleFor(mobile, '.selection-control')).toMatch(/min-inline-size:\s*44px/)
  expect(ruleFor(mobile, '.selection-control')).toMatch(/min-block-size:\s*44px/)
  expect(ruleFor(mobile, '.inspector-heading,')).toMatch(/flex-direction:\s*column/)
  expect(ruleFor(mobile, '.inspector-actions')).toMatch(/justify-content:\s*flex-start/)

  expect(ruleFor(styles, '.state-copy,')).toMatch(/max-width:\s*var\(--measure-prose\)/)
  expect(declarationsFor(styles, ':root')).toContain('--type-reading-size: 1rem;')
  expect(ruleFor(styles, '.repository-row-main')).toMatch(/min-width:\s*0/)
})

test('removes retired parchment and sidebar dashboard vocabulary', () => {
  expect(styles).not.toMatch(/\.(?:nav-list-primary|topbar|privacy-chip|state-index|feature-grid|sidebar)\b/)
  expect(styles).not.toMatch(/--(?:navy(?:-deep)?|sage|sand|copper(?:-hover)?)\s*:/)
  expect(styles).not.toMatch(/#(?:eee8dd|d4c8b5|c4936a)\b/i)
})

test('uses transform-only bounded skeleton shimmer with reduced-motion suppression', () => {
  expect(styles).not.toMatch(/@keyframes[^{}]*shimmer[\s\S]*?background-position/)
  expect(ruleFor(styles, '.skeleton-row')).toMatch(/overflow:\s*hidden/)
  expect(ruleFor(styles, '.skeleton-row::after')).toMatch(/animation:\s*shimmer[^;]*;/)
  expect(ruleFor(styles, '.skeleton-row::after')).toMatch(/transform:\s*translateX/)
  expect(styles).toMatch(/@keyframes\s+shimmer\s*\{\s*to\s*\{\s*transform:\s*translateX/)
  expect(extractMedia(styles, '(prefers-reduced-motion: reduce)')).toMatch(/animation-duration:\s*0\.01ms/)
})

test('keeps the modal, focus, and mobile primary controls accessible', () => {
  expect(ruleFor(styles, '.library-grid')).not.toMatch(/grid-template-columns:/)
  expect(ruleFor(styles, '.repository-inspection-dialog')).toMatch(/max-height:\s*calc\(100dvh - 48px\)/)
  expect(ruleFor(styles, '.repository-inspection-dialog')).toMatch(/overflow-y:\s*auto/)
  expect(ruleFor(styles, '.file-action:focus-within')).toMatch(/outline:\s*3px solid var\(--focus-ring\)/)

  const mobile = extractMedia(styles, '(max-width: 700px)')
  for (const selector of [
    '.nav-item',
    '.nav-group > summary',
    '.primary-action,',
    '.triage-actions button,',
    '.native-list-choices label,'
  ]) {
    expect(ruleFor(mobile, selector), selector).toMatch(/min-height:\s*44px/)
  }
  expect(ruleFor(mobile, '.library-actions input,')).toMatch(/font-size:\s*16px/)
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

function cascadeWinner(
  baseCss: string,
  forcedCss: string,
  baseSelector: string,
  forcedSelector: string,
  property: string
): 'base' | 'forced' {
  const base = lastDeclaration(baseCss, baseSelector, property)
  const forced = lastDeclaration(forcedCss, forcedSelector, property)
  if (!base || !forced) return 'base'
  if (base.important !== forced.important) return forced.important ? 'forced' : 'base'

  const specificityDifference = compareSpecificity(
    specificity(forcedSelector),
    specificity(baseSelector)
  )
  if (specificityDifference !== 0) return specificityDifference > 0 ? 'forced' : 'base'
  return 'forced'
}

function lastDeclaration(css: string, selector: string, property: string): {
  readonly important: boolean
} | null {
  const propertyPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegex(property)}\\s*:\\s*([^;]+)`,
    'm'
  )
  return parseRules(css).flatMap((rule) => {
    if (!rule.selectors.includes(selector)) return []
    const value = rule.declarations.match(propertyPattern)?.[1]
    return value ? [{important: /!important\s*$/.test(value), index: rule.index}] : []
  }).at(-1) ?? null
}

function specificity(selector: string): readonly [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0
  const withoutModifiers = selector
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, ' ')
  const elements = withoutModifiers.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi)
    ?.filter((element) => !element.trim().startsWith('*')).length ?? 0
  return [ids, classes, elements]
}

function compareSpecificity(
  first: readonly [number, number, number],
  second: readonly [number, number, number]
): number {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return (first[index] ?? 0) - (second[index] ?? 0)
  }
  return 0
}

function declarationsFor(css: string, selector: string): string {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    ([, selectors]) => selectors?.trim() === selector
  )?.[2] ?? ''
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
  return new Map(
    [...declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [
      name ?? '',
      value?.trim() ?? ''
    ])
  )
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
    const linear = channels.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    )
    return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
  }
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return ((bright ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
