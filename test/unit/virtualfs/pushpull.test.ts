import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import { NodeFsStorage } from '../../../src/virtualfs/persistence'

const TMP = path.resolve('./.test_apigit_pp')

beforeEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})
afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

describe('VirtualFS pull/push', () => {
  it('pull updates base when workspace unchanged', async () => {
    const vfs = new VirtualFS({ storageDir: TMP, backend: new NodeFsStorage(TMP) })
    await vfs.init()
    // initial base
    await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
    // remote updated a.txt to v2
    const remote = { 'a.txt': 'v2' }
    const res = await vfs.pull('head2', remote)
    expect(res.conflicts.length).toBe(0)
    const idx = vfs.getIndex()
    expect(idx.head).toBe('head2')
    const content = await vfs.readWorkspace('a.txt')
    expect(content).toBe('v2')
  })

  it('pull reports conflict when workspace modified', async () => {
    const vfs = new VirtualFS({ storageDir: TMP, backend: new NodeFsStorage(TMP) })
    await vfs.init()
    await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
    // modify locally
    await vfs.writeWorkspace('a.txt', 'local-mod')
    // remote updated
    const remote = { 'a.txt': 'v2' }
    const res = await vfs.pull('head2', remote)
    expect(res.conflicts.length).toBeGreaterThan(0)
  })

  it('push fails when head mismatched and succeeds otherwise', async () => {
    const vfs = new VirtualFS({ storageDir: TMP, backend: new NodeFsStorage(TMP) })
    await vfs.init()
    await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
    // make workspace change
    await vfs.writeWorkspace('a.txt', 'v1-mod')
    const changes = await vfs.getChangeSet()

    // try push with wrong parent
    await expect(vfs.push({ message: 'm', parentSha: 'wrong', changes })).rejects.toThrow()

    // push with correct parent
    const result = await vfs.push({ message: 'm', parentSha: 'head1', changes })
    expect(result.commitSha).toBeDefined()
    const idx = vfs.getIndex()
    expect(idx.head).toBe(result.commitSha)
    // workspace cleaned and base updated (readWorkspace returns base blob)
    const w = await vfs.readWorkspace('a.txt')
    expect(w).toBe('v1-mod')
  })
})
