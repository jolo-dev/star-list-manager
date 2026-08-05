import {readdir, readFile} from 'node:fs/promises'
import {extname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

export interface SourceViolation {
  readonly file: string
  readonly line: number
  readonly column: number
}

const forbiddenToken = ['a', 'n', 'y'].join('')
const forbiddenPattern = new RegExp(`\\b${forbiddenToken}\\b`, 'g')

export async function findSourceViolations(
  rootDirectory: string
): Promise<readonly SourceViolation[]> {
  const files = await collectTypeScriptFiles(rootDirectory)
  const violations: SourceViolation[] = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const lines = source.split('\n')

    for (const [lineIndex, line] of lines.entries()) {
      forbiddenPattern.lastIndex = 0
      for (const match of line.matchAll(forbiddenPattern)) {
        violations.push({
          file: relative(rootDirectory, file),
          line: lineIndex + 1,
          column: (match.index ?? 0) + 1
        })
      }
    }
  }

  return violations
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true})
  const files: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(path)))
    } else if (extname(entry.name) === '.ts') {
      files.push(path)
    }
  }

  return files.sort()
}

if (import.meta.main) {
  const sourceDirectory = fileURLToPath(new URL('../src', import.meta.url))
  const violations = await findSourceViolations(sourceDirectory)

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${violation.file}:${violation.line}:${violation.column} contains forbidden ${forbiddenToken} syntax`
      )
    }
    process.exit(1)
  }

  console.log('Source syntax check passed')
}
