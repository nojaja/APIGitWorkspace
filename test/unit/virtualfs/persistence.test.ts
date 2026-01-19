import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { NodeFsStorage } from '../../../src/virtualfs/persistence'

let tmpDir: string
beforeEach(async () => {
  jest.clearAllMocks()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apigit-test-'))
})
afterEach(async () => {
  // cleanup
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch (e) {
    // ignore
  }
})

describe('NodeFsStorage basic flows', () => {
  it('init creates directory and write/read index', async () => {
    const storage = new NodeFsStorage(tmpDir)
    await storage.init()

    const index = { head: 'h', entries: {} }
    await storage.writeIndex(index as any)

    const read = await storage.readIndex()
    expect(read).not.toBeNull()
    expect(read!.head).toBe('h')
  })

  it('writeBlob/readBlob/deleteBlob', async () => {
    const storage = new NodeFsStorage(tmpDir)
    await storage.init()

    await storage.writeBlob('dir/a.txt', 'hello')
    const got = await storage.readBlob('dir/a.txt')
    expect(got).toBe('hello')

    await storage.deleteBlob('dir/a.txt')
    const after = await storage.readBlob('dir/a.txt')
    expect(after).toBeNull()
  })

  it('readIndex returns null when absent', async () => {
    const storage = new NodeFsStorage(tmpDir)
    await storage.init()
    const r = await storage.readIndex()
    expect(r).toBeNull()
  })
})
