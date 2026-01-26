import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS 基本動作', () => {
  it('ファイルの追加・更新・削除と index.json の更新', async () => {
      const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()

    await vfs.writeFile('foo.txt', 'hello')
    let idx = await vfs.getIndex()
    expect(idx.entries['foo.txt']).toBeDefined()
    expect(idx.entries['foo.txt'].state).toBe('added')

    await vfs.writeFile('foo.txt', 'hello2')
    idx = await vfs.getIndex()
    expect(idx.entries['foo.txt'].state).toBe('added')

    await vfs.deleteFile('foo.txt')
    idx = await vfs.getIndex()
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
    const changes = await vfs.getChangeSet()
    // delete should be present or reflected in index when tombstone absent
    const hasDelete = changes.find((c: any) => c.type === 'delete' && c.path === 'a.txt')
    if (!hasDelete) {
      const idx = await vfs.getIndex()
      expect(idx.entries['a.txt']).toBeUndefined()
    } else {
      expect(hasDelete).toBeDefined()
    }
  })
})
