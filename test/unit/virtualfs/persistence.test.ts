import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import InMemoryStorage from '../helpers/inmemoryStorage'

beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.resetAllMocks())

describe('InMemoryStorage basic flows', () => {
  it('init and write/read index', async () => {
    const storage = new InMemoryStorage()
    await storage.init()

    const index = { head: 'h', entries: {} }
    await storage.writeIndex(index as any)

    const read = await storage.readIndex()
    expect(read).not.toBeNull()
    expect(read.head).toBe('h')
  })

  it('writeBlob/readBlob/deleteBlob', async () => {
    const storage = new InMemoryStorage()
    await storage.init()

    await storage.writeBlob('dir/a.txt', 'hello')
    const got = await storage.readBlob('dir/a.txt')
    expect(got).toBe('hello')

    await storage.deleteBlob('dir/a.txt')
    const after = await storage.readBlob('dir/a.txt')
    expect(after).toBeNull()
  })

  it('readIndex returns default index when absent', async () => {
    const storage = new InMemoryStorage()
    await storage.init()
    const r = await storage.readIndex()
    expect(r).not.toBeNull()
    expect(r.head).toBe('')
  })
})
