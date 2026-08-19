import {expect, test} from 'bun:test'
import {readPngDimensions} from '../../scripts/png'

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const

function pngHeader(width = 32, height = 48, chunkType = 'IHDR'): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set(pngSignature)
  new DataView(bytes.buffer).setUint32(8, 13, false)
  bytes.set(new TextEncoder().encode(chunkType), 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width, false)
  view.setUint32(20, height, false)
  return bytes
}

test('reads positive big-endian PNG IHDR dimensions', () => {
  expect(readPngDimensions(pngHeader())).toEqual({width: 32, height: 48})
})

test('rejects a bad PNG signature', () => {
  const bytes = pngHeader()
  bytes[0] = 0
  expect(() => readPngDimensions(bytes)).toThrow('Invalid PNG signature')
})

test('rejects a truncated IHDR', () => {
  expect(() => readPngDimensions(pngHeader().subarray(0, 23))).toThrow(
    'PNG IHDR is truncated'
  )
})

test('rejects a non-IHDR first chunk', () => {
  expect(() => readPngDimensions(pngHeader(32, 48, 'IDAT'))).toThrow(
    'PNG first chunk must be IHDR'
  )
})

test('rejects zero dimensions', () => {
  expect(() => readPngDimensions(pngHeader(0, 48))).toThrow(
    'PNG dimensions must be positive'
  )
  expect(() => readPngDimensions(pngHeader(32, 0))).toThrow(
    'PNG dimensions must be positive'
  )
})
