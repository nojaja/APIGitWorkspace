import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import { NodeFsStorage } from '../../../src/virtualfs/persistence'

let tmpDir: string
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apigit-rn-'))
})
afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch (e) { void e }
})

describe('renameWorkspace helper', () => {
  it('renames a base file to new path producing create+delete change set', async () => {
    const vfs = new VirtualFS({ backend: new NodeFsStorage(tmpDir) })
    await vfs.init()
    // apply base snapshot
    await vfs.applyBaseSnapshot({ 'c.txt': 'content-c' }, 'h1')

    await vfs.renameWorkspace('c.txt', 'd.txt')

    const changes = await vfs.getChangeSet()
    const hasCreate = changes.find((c: any) => c.type === 'create' && c.path === 'd.txt')
    const hasDelete = changes.find((c: any) => c.type === 'delete' && c.path === 'c.txt')
    expect(hasCreate).toBeDefined()
    expect(hasDelete).toBeDefined()
  })
})
