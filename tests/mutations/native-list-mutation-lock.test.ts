import {expect, test} from 'bun:test'
import {NativeListMutationLock} from '../../src/mutations/native-list-mutation-lock'

test('serializes native List operations in arrival order', async () => {
  const lock = new NativeListMutationLock()
  const events: string[] = []
  let releaseFirst!: () => void
  const first = lock.run(async () => {
    events.push('first-start')
    await new Promise<void>((resolve) => { releaseFirst = resolve })
    events.push('first-end')
  })
  const second = lock.run(async () => {
    events.push('second-start')
    events.push('second-end')
  })

  await Promise.resolve()
  expect(events).toEqual(['first-start'])
  releaseFirst()
  await Promise.all([first, second])
  expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end'])
})

test('releases the native List lock after an operation fails', async () => {
  const lock = new NativeListMutationLock()

  await expect(lock.run(async () => { throw new Error('expected failure') })).rejects.toThrow('expected failure')
  await lock.run(async () => undefined)
})
