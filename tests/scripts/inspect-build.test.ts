import {expect, test} from 'bun:test'
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {extname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const chromiumBuildDirectory = join(projectRoot, 'dist', 'chromium-based')
const firefoxBuildDirectory = join(projectRoot, 'dist', 'firefox')

test('inspects the requested Chromium-based build', async () => {
  const originalBuild = await artifactFingerprint(chromiumBuildDirectory)

  await withRestoredBuild(chromiumBuildDirectory, async () => {
    const build = await run([
      'bunx',
      '--no-install',
      'extension',
      'build',
      '--browser',
      'chromium-based'
    ])
    expect(build.exitCode).toBe(0)

    const validInspection = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(validInspection.exitCode).toBe(0)
    expect(validInspection.output).toContain(
      'Built manifest and bundle inspection passed'
    )

    const manifestPath = join(chromiumBuildDirectory, 'manifest.json')
    const originalManifest = await readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(originalManifest) as {
      readonly action: {readonly default_icon: Record<string, string>}
    }
    manifest.action.default_icon['32'] = 'images/icon-16.png'
    await writeFile(manifestPath, JSON.stringify(manifest))

    const reusedAcrossSizes = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(reusedAcrossSizes.exitCode).toBe(1)
    expect(reusedAcrossSizes.output).toContain(
      'icon path images/icon-16.png is associated with sizes 16 and 32'
    )

    await writeFile(manifestPath, originalManifest)
    const icon32Path = join(chromiumBuildDirectory, 'images', 'icon-32.png')
    const originalIcon32 = await readFile(icon32Path)
    await cp(join(chromiumBuildDirectory, 'images', 'icon-16.png'), icon32Path)

    const wrongDimensions = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(wrongDimensions.exitCode).toBe(1)
    expect(wrongDimensions.output).toContain(
      'icon images/icon-32.png must be 32x32, got 16x16'
    )

    await writeFile(icon32Path, originalIcon32)

    const missingKeyManifest = JSON.parse(originalManifest) as {
      readonly action: {readonly default_icon: Record<string, string>}
    }
    delete missingKeyManifest.action.default_icon['64']
    await writeFile(manifestPath, JSON.stringify(missingKeyManifest))
    const missingKey = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(missingKey.exitCode).toBe(1)
    expect(missingKey.output).toContain(
      'chromium-based action icons do not match the required minimal set'
    )

    const wrongNameManifest = JSON.parse(originalManifest) as {
      readonly icons: Record<string, string>
    }
    wrongNameManifest.icons['32'] = 'images/wrong-name.png'
    await writeFile(manifestPath, JSON.stringify(wrongNameManifest))
    const wrongName = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(wrongName.exitCode).toBe(1)
    expect(wrongName.output).toContain(
      'chromium-based icons 32 must map to images/icon-32.png'
    )

    const sourceManifest = JSON.parse(originalManifest) as {
      readonly icons: Record<string, string>
    }
    sourceManifest.icons['16'] = 'images/icon.png'
    await writeFile(manifestPath, JSON.stringify(sourceManifest))
    const sourceReference = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(sourceReference.exitCode).toBe(1)
    expect(sourceReference.output).toContain(
      'manifest references the high-resolution icon source'
    )

    await writeFile(manifestPath, originalManifest)
    const font = await findGeistMonoFont(chromiumBuildDirectory)
    await rename(font, `${font}.missing`)

    const missingFont = await run([
      'bun',
      'scripts/inspect-build.ts',
      'chromium-based'
    ])
    expect(missingFont.exitCode).toBe(1)
    expect(missingFont.output).toContain(
      'chromium-based build is missing a local GeistMono-Variable font asset'
    )
  })

  expect(await artifactFingerprint(chromiumBuildDirectory)).toEqual(originalBuild)
})

test('inspects Firefox browser action icon slots', async () => {
  const originalBuild = await artifactFingerprint(firefoxBuildDirectory)

  await withRestoredBuild(firefoxBuildDirectory, async () => {
    const build = await run([
      'bunx',
      '--no-install',
      'extension',
      'build',
      '--browser',
      'firefox'
    ])
    expect(build.exitCode).toBe(0)

    const inspection = await run(['bun', 'scripts/inspect-build.ts', 'firefox'])
    expect(inspection.exitCode).toBe(0)
    expect(inspection.output).toContain('Built manifest and bundle inspection passed')
  })

  expect(await artifactFingerprint(firefoxBuildDirectory)).toEqual(originalBuild)
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

async function withRestoredBuild(
  buildDirectory: string,
  action: () => Promise<void>
): Promise<void> {
  const snapshotDirectory = await mkdtemp(
    join(tmpdir(), 'star-list-manager-inspect-build-')
  )
  const snapshotBuildDirectory = join(snapshotDirectory, 'build')
  let originalBuildExists = false
  let snapshotCreated = false

  try {
    originalBuildExists = await pathExists(buildDirectory)
    if (originalBuildExists) {
      await cp(buildDirectory, snapshotBuildDirectory, {recursive: true})
      snapshotCreated = true
    }
    await action()
  } finally {
    try {
      if (snapshotCreated) {
        await rm(buildDirectory, {recursive: true, force: true})
        await cp(snapshotBuildDirectory, buildDirectory, {recursive: true})
      } else if (!originalBuildExists) {
        await rm(buildDirectory, {recursive: true, force: true})
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
