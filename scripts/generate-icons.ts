import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'

export const iconSizes = [16, 32, 48, 64, 128] as const

export async function generateIconSet(
  sourcePath: string,
  outputDirectory: string
): Promise<void> {
  await mkdir(outputDirectory, {recursive: true})
  await Promise.all(
    iconSizes.map(async (size) => {
      await sharp(sourcePath)
        .resize(size, size, {fit: 'contain'})
        .png({compressionLevel: 9})
        .toFile(join(outputDirectory, `icon-${size}.png`))
    })
  )
}

if (import.meta.main) {
  const sourcePath = fileURLToPath(new URL('../src/images/icon.png', import.meta.url))
  const outputDirectory = fileURLToPath(new URL('../src/images', import.meta.url))
  await generateIconSet(sourcePath, outputDirectory)
}
