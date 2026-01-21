import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS 基本動作', () => {
  it('ファイルの追加・更新・削除と index.json の更新', async () => {
      const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()

    await vfs.writeFile('foo.txt', 'hello')
    let idx = vfs.getIndex()
    expect(idx.entries['foo.txt']).toBeDefined()
    expect(idx.entries['foo.txt'].state).toBe('added')

    await vfs.writeFile('foo.txt', 'hello2')
    idx = vfs.getIndex()
    expect(idx.entries['foo.txt'].state).toBe('added')

    await vfs.deleteFile('foo.txt')
    idx = vfs.getIndex()
    // since it was added then deleted before base exists, entry removed
    expect(idx.entries['foo.txt']).toBeUndefined()
  })

  it('tombstone が作られるケース（base あり）', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()
    // apply base snapshot
    await vfs.applyBaseSnapshot({ 'a.txt': 'basecontent' }, 'head1')
    await vfs.writeFile('a.txt', 'modified')
    await vfs.deleteFile('a.txt')
    const tombs = vfs.getTombstones()
    expect(tombs.length).toBe(1)
    const changes = await vfs.getChangeSet()
    // delete should be present
    expect(changes.find((c: any) => c.type === 'delete' && c.path === 'a.txt')).toBeDefined()
  })
})
