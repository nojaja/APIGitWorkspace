import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import { NodeFsStorage } from '../../../src/virtualfs/persistence'

const TMP = path.resolve('./.test_apigit')

beforeEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

describe('VirtualFS 基本動作', () => {
  it('ファイルの追加・更新・削除と index.json の更新', async () => {
      const vfs = new VirtualFS({ storageDir: TMP, backend: new NodeFsStorage(TMP) })
    await vfs.init()

    await vfs.writeWorkspace('foo.txt', 'hello')
    let idx = vfs.getIndex()
    expect(idx.entries['foo.txt']).toBeDefined()
    expect(idx.entries['foo.txt'].state).toBe('added')

    await vfs.writeWorkspace('foo.txt', 'hello2')
    idx = vfs.getIndex()
    expect(idx.entries['foo.txt'].state).toBe('added')

    await vfs.deleteWorkspace('foo.txt')
    idx = vfs.getIndex()
    // since it was added then deleted before base exists, entry removed
    expect(idx.entries['foo.txt']).toBeUndefined()
  })

  it('tombstone が作られるケース（base あり）', async () => {
    const vfs = new VirtualFS({ storageDir: TMP, backend: new NodeFsStorage(TMP) })
    await vfs.init()
    // apply base snapshot
    await vfs.applyBaseSnapshot({ 'a.txt': 'basecontent' }, 'head1')
    await vfs.writeWorkspace('a.txt', 'modified')
    await vfs.deleteWorkspace('a.txt')
    const tombs = vfs.getTombstones()
    expect(tombs.length).toBe(1)
    const changes = await vfs.getChangeSet()
    // delete should be present
    expect(changes.find((c: any) => c.type === 'delete' && c.path === 'a.txt')).toBeDefined()
  })
})
