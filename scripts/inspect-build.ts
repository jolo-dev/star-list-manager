import {readdir, readFile} from 'node:fs/promises'
import {extname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../dist', import.meta.url))
const browsers = ['chrome', 'firefox'] as const
const pathSeparator = '/'
const forbiddenManifestText = [
  '<all_urls>',
  'content_scripts',
  'side_panel',
  'notifications'
]
const forbiddenBundleText = [
  'client_secret',
  'google-analytics',
  'googletagmanager',
  'segment.io',
  'sentry.io',
  'mixpanel'
]
const forbiddenDashboardText = [
  'access_token',
  'device_code',
  'writeAuthState',
  'Bearer ',
  'EXTENSION_PUBLIC_GITHUB_WRITE_CLIENT_ID'
]
const expectedHosts = [
  'https://api.github.com/*',
  'https://github.com/login/*'
] as const

for (const browser of browsers) {
  const directory = join(root, browser)
  const manifestText = await readFile(join(directory, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as unknown
  const manifestRecord = requireRecord(manifest, `${browser} manifest`)
  const serialized = JSON.stringify(manifest)
  for (const forbidden of forbiddenManifestText) {
    if (serialized.includes(forbidden)) {
      throw new Error(`${browser} manifest contains forbidden ${forbidden}`)
    }
  }
  for (const host of collectUrls(manifest)) {
    if (
      !host.startsWith('https://api.github.com/') &&
      !host.startsWith('https://github.com/login/')
    ) {
      throw new Error(`${browser} manifest contains unexpected host ${host}`)
    }
  }
  const permissions = requireStringArray(
    manifestRecord.permissions,
    `${browser} permissions`
  )
  const hosts =
    browser === 'chrome'
      ? requireStringArray(manifestRecord.host_permissions, 'chrome host permissions')
      : permissions.filter((permission) => permission.startsWith('https://'))
  const browserPermissions = permissions.filter(
    (permission) => !permission.startsWith('https://')
  )
  assertExactValues(browserPermissions, ['alarms', 'storage'], `${browser} permissions`)
  assertExactValues(hosts, expectedHosts, `${browser} GitHub hosts`)

  const files = await collectFiles(directory)
  if (files.some((file) => file.includes('.env'))) {
    throw new Error(`${browser} build contains an environment file`)
  }
  for (const file of files.filter((path) => ['.js', '.html'].includes(extname(path)))) {
    const text = await readFile(file, 'utf8')
    for (const forbidden of forbiddenBundleText) {
      if (text.toLocaleLowerCase().includes(forbidden)) {
        throw new Error(
          `${browser}/${relative(directory, file)} contains forbidden ${forbidden}`
        )
      }
    }
    if (extname(file) === '.html' && /<script[^>]+src=["']https?:/i.test(text)) {
      throw new Error(`${browser}/${relative(directory, file)} loads remote code`)
    }
    if (relative(directory, file).startsWith(`options${pathSeparator}`)) {
      for (const forbidden of forbiddenDashboardText) {
        if (text.includes(forbidden)) {
          throw new Error(
            `${browser}/${relative(directory, file)} exposes write credential machinery in the dashboard bundle`
          )
        }
      }
    }
  }
}

console.log('Built manifest and bundle inspection passed')

function collectUrls(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.startsWith('https://') ? [value] : []
  if (Array.isArray(value)) return value.flatMap(collectUrls)
  if (typeof value !== 'object' || value === null) return []
  return Object.values(value as Readonly<Record<string, unknown>>).flatMap(collectUrls)
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true})
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(path)))
    else files.push(path)
  }
  return files
}

function requireRecord(
  value: unknown,
  label: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value as Readonly<Record<string, unknown>>
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function assertExactValues(
  actual: readonly string[],
  expected: readonly string[],
  label: string
): void {
  const normalizedActual = [...actual].sort()
  const normalizedExpected = [...expected].sort()
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${label} do not match the required minimal set`)
  }
}
