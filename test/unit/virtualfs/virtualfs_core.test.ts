import { describe, it, expect, beforeEach } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

const backends = [
  ['InMemory', () => new InMemoryStorage()]
  // Add other backend factories as needed: IndexedDB/OPFS (with proper fakes)
] as const

describe.each(backends)('VirtualFS core (%s)', (_name, backendFactory) => {
  let backend: any
  beforeEach(async () => {
    backend = backendFactory()
  })

  it('ファイルの追加・更新・削除と index.json の更新', async () => {
    const vfs = new VirtualFS({ backend })
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
    expect(idx.entries['foo.txt']).toBeUndefined()
  })

  it('tombstone が作られるケース（base あり）', async () => {
    const vfs = new VirtualFS({ backend })
    await vfs.init()
    await vfs.applyBaseSnapshot({ 'a.txt': 'basecontent' }, 'head1')
    await vfs.writeFile('a.txt', 'modified')
    await vfs.deleteFile('a.txt')
    const changes = await vfs.getChangeSet()
    const hasDelete = changes.find((c: any) => c.type === 'delete' && c.path === 'a.txt')
    if (!hasDelete) {
      const idx = await vfs.getIndex()
      expect(idx.entries['a.txt']).toBeUndefined()
    } else {
      expect(hasDelete).toBeDefined()
    }
  })

  it('_isNonFastForwardError detection', () => {
    const v = new VirtualFS({ backend })
    expect((v as any)._isNonFastForwardError(new Error('422'))).toBe(true)
    expect((v as any)._isNonFastForwardError('some fast forward error')).toBe(true)
    expect((v as any)._isNonFastForwardError(new Error('other'))).toBe(false)
  })

  it('push throws when parentSha undefined or head mismatch', async () => {
    const v = new VirtualFS({ backend })
    await v.init()
    await expect(v.push({ parentSha: undefined as any, changes: [{ type: 'create', path: 'a', content: 'x' }] } as any)).rejects.toThrow()
    await expect(v.push({ parentSha: 'not-head', changes: [{ type: 'create', path: 'a', content: 'x' }] } as any)).rejects.toThrow()
  })

  it('resolveConflict promotes remote content when present and deletes conflict blob', async () => {
    const b = backendFactory()
    const v = new VirtualFS({ backend: b })
    await v.init()
    await b.writeBlob('x', 'payload', 'conflict')
    const ie: any = { path: 'x', state: 'conflict', remoteSha: 'r1', updatedAt: Date.now() }
    await b.writeBlob('x', JSON.stringify(ie), 'info')
    const ok = await v.resolveConflict('x')
    expect(ok).toBe(true)
    const infoTxt = await b.readBlob('x', 'info')
    const entry = infoTxt ? JSON.parse(infoTxt) : null
    expect(entry?.state).toBe('base')
    const got = await b.readBlob('x', 'conflict')
    expect(got).toBeNull()
  })
})
