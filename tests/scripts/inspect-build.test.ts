import {expect, test} from 'bun:test'
import {cp, mkdtemp, readdir, readFile, rename, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {extname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const chromiumBuildDirectory = join(projectRoot, 'dist', 'chromium-based')

test('inspects the requested Chromium-based build', async () => {
  const originalBuild = await artifactFingerprint(chromiumBuildDirectory)

  await withRestoredChromiumBuild(async () => {
    const build = await run([
      'bunx',
      '--no-install',
      'extension',
      'build',
      '--browser',
      'chromium-based'
    ])
    expect(build.exitCode).toBe(0)

    const font = await findGeistMonoFont(chromiumBuildDirectory)
    await rename(font, `${font}.missing`)

    const inspection = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(inspection.exitCode).toBe(1)
    expect(inspection.output).toContain(
      'chromium-based build is missing a local GeistMono-Variable font asset'
    )
  })

  expect(await artifactFingerprint(chromiumBuildDirectory)).toEqual(originalBuild)
})

test('rejects multiple inspection targets', async () => {
  const inspection = await run([
    'bun',
    'scripts/inspect-build.ts',
    'chromium-based',
    'firefox'
  ])

  expect(inspection.exitCode).toBe(1)
  expect(inspection.output).toContain('Expected at most one inspection target')
})

test('rejects unsupported inspection targets', async () => {
  const inspection = await run([
    'bun',
    'scripts/inspect-build.ts',
    'unsupported-target'
  ])

  expect(inspection.exitCode).toBe(1)
  expect(inspection.output).toContain('Unsupported inspection target unsupported-target')
})

async function run(
  command: readonly string[]
): Promise<{readonly exitCode: number; readonly output: string}> {
  const process = Bun.spawn({
    cmd: [...command],
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text()
  ])
  return {exitCode, output: `${stdout}${stderr}`}
}

async function findGeistMonoFont(directory: string): Promise<string> {
  const entries = await readdir(directory, {withFileTypes: true})
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      try {
        return await findGeistMonoFont(path)
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Geist Mono font not found') {
          throw error
        }
      }
    }
    if (
      entry.isFile() &&
      entry.name.startsWith('GeistMono-Variable') &&
      extname(entry.name) === '.woff2'
    ) {
      return path
    }
  }
  throw new Error('Geist Mono font not found')
}

async function withRestoredChromiumBuild(action: () => Promise<void>): Promise<void> {
  const snapshotDirectory = await mkdtemp(
    join(tmpdir(), 'star-list-manager-inspect-build-')
  )
  const snapshotBuildDirectory = join(snapshotDirectory, 'chromium-based')
  let originalBuildExists = false
  let snapshotCreated = false

  try {
    originalBuildExists = await pathExists(chromiumBuildDirectory)
    if (originalBuildExists) {
      await cp(chromiumBuildDirectory, snapshotBuildDirectory, {recursive: true})
      snapshotCreated = true
    }
    await action()
  } finally {
    try {
      if (snapshotCreated) {
        await rm(chromiumBuildDirectory, {recursive: true, force: true})
        await cp(snapshotBuildDirectory, chromiumBuildDirectory, {recursive: true})
      } else if (!originalBuildExists) {
        await rm(chromiumBuildDirectory, {recursive: true, force: true})
      }
    } finally {
      await rm(snapshotDirectory, {recursive: true, force: true})
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function artifactFingerprint(
  directory: string,
  root = directory
): Promise<readonly string[] | null> {
  if (!(await pathExists(directory))) return null

  const entries = await readdir(directory, {withFileTypes: true})
  const fingerprint: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    const artifactPath = relative(root, path)
    if (entry.isDirectory()) {
      fingerprint.push(`directory ${artifactPath}`)
      fingerprint.push(...(await artifactFingerprint(path, root))!)
    } else {
      const contents = await readFile(path)
      fingerprint.push(
        `file ${artifactPath} ${createHash('sha256').update(contents).digest('hex')}`
      )
    }
  }
  return fingerprint
}
