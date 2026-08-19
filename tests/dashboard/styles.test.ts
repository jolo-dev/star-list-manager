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
      return normalized.includes('var(') || allowedColorValues.has(normalized)
        ? []
        : [`${selectors?.trim()}: ${normalized}`]
    })
  )
  expect(unexpectedColorValues).toEqual([])
})

test('maps forced-colors selectors to explicit system colors', () => {
  const forced = extractMedia(styles, '(forced-colors: active)')
  expect(forced).not.toBe('')

  for (const selector of ['.nav-item[aria-current="page"]', '.repository-row.is-selected']) {
    expect(ruleFor(forced, selector), selector).toMatch(/background:\s*Highlight;/)
    expect(ruleFor(forced, selector), selector).toMatch(/color:\s*HighlightText;/)
    expect(ruleFor(forced, selector), selector).toMatch(/border-color:\s*Highlight;/)
    expect(ruleFor(forced, selector), selector).toMatch(/forced-color-adjust:\s*none;/)
  }
  for (const selector of ['button,', 'input,', 'select,', 'textarea,', '.file-action']) {
    expect(ruleFor(forced, selector), selector).toMatch(/background:\s*ButtonFace;/)
    expect(ruleFor(forced, selector), selector).toMatch(/color:\s*ButtonText;/)
    expect(ruleFor(forced, selector), selector).toMatch(/border-color:\s*ButtonText;/)
  }
  for (const selector of [':focus-visible,', '.file-action:focus-within']) {
    expect(ruleFor(forced, selector), selector).toMatch(/outline:\s*3px solid Highlight;/)
  }
  for (const selector of ['.status-banner,', '.status-banner.is-success', '.status-banner.is-warning', '.status-banner.is-error']) {
    expect(ruleFor(forced, selector), selector).toMatch(/background:\s*Canvas;/)
    expect(ruleFor(forced, selector), selector).toMatch(/color:\s*CanvasText;/)
    expect(ruleFor(forced, selector), selector).toMatch(/border-color:\s*CanvasText;/)
    expect(ruleFor(forced, selector), selector).toMatch(/forced-color-adjust:\s*none;/)
  }
  expect(ruleFor(forced, 'a')).toMatch(/color:\s*LinkText;/)

  const adjustedSelectors = [
    ...forced.matchAll(/([^{}]+)\{([^{}]*forced-color-adjust:\s*none[^{}]*)\}/g)
  ].flatMap(([, selectors]) => (selectors ?? '').split(',').map((selector) => selector.trim()))
  expect(adjustedSelectors).toEqual([
    '.nav-item[aria-current="page"]',
    '.repository-row.is-selected',
    '.status-banner',
    '.status-banner.is-success',
    '.status-banner.is-warning',
    '.status-banner.is-error'
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

test('removes dead legacy dashboard selectors', () => {
  expect(styles).not.toMatch(/\.(?:nav-list-primary|topbar|privacy-chip|state-index|feature-grid)\b/)
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
