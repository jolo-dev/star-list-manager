const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const minimumHeaderLength = 24
const ihdrChunkType = 'IHDR'

export interface PngDimensions {
  readonly width: number
  readonly height: number
}

export function readPngDimensions(bytes: Uint8Array): PngDimensions {
  if (
    bytes.byteLength < pngSignature.byteLength ||
    !pngSignature.every((byte, index) => bytes[index] === byte)
  ) {
    throw new Error('Invalid PNG signature')
  }
  if (bytes.byteLength < minimumHeaderLength) {
    throw new Error('PNG IHDR is truncated')
  }

  const chunkType = new TextDecoder().decode(bytes.subarray(12, 16))
  if (chunkType !== ihdrChunkType) {
    throw new Error('PNG first chunk must be IHDR')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  if (width === 0 || height === 0) {
    throw new Error('PNG dimensions must be positive')
  }

  return {width, height}
}
