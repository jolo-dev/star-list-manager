import {afterEach, describe, expect, test} from 'bun:test'
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {findSourceViolations} from '../../scripts/check-no-any'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {recursive: true, force: true})
    )
  )
})

describe('findSourceViolations', () => {
  test('accepts typed source', async () => {
    const directory = await createFixtureDirectory()
    await writeFile(join(directory, 'valid.ts'), 'const value: unknown = 1\n')

    expect(await findSourceViolations(directory)).toEqual([])
  })

  test('reports forbidden syntax with location', async () => {
    const directory = await createFixtureDirectory()
    const token = ['a', 'n', 'y'].join('')
    await writeFile(join(directory, 'invalid.ts'), `let value: ${token}\n`)

    expect(await findSourceViolations(directory)).toEqual([
      {file: 'invalid.ts', line: 1, column: 12}
    ])
  })

  test('scans nested TypeScript files only', async () => {
    const directory = await createFixtureDirectory()
    const nestedDirectory = join(directory, 'nested')
    await mkdir(nestedDirectory)
    const token = ['a', 'n', 'y'].join('')
    await writeFile(join(nestedDirectory, 'invalid.ts'), `type Value = ${token}\n`)
    await writeFile(join(directory, 'ignored.js'), `let value = '${token}'\n`)

    expect(await findSourceViolations(directory)).toEqual([
      {file: join('nested', 'invalid.ts'), line: 1, column: 14}
    ])
  })
})

async function createFixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'star-list-manager-'))
  temporaryDirectories.push(directory)
  return directory
}
