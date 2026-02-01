/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage coverage boost tests', () => {
  let rootName: string
  let s: any

  beforeEach(() => {
    rootName = `cb_${Date.now()}_${Math.random().toString(36).slice(2)}`
    s = new (InMemoryStorage as any)(rootName)
  })

  afterEach(() => {
    try { (InMemoryStorage as any).delete(rootName) } catch (_e) {}
  })

  it('writing info segment with invalid JSON stores raw text', async () => {
    await s.writeBlob('bad.json', 'not-a-json', 'info')
    const info = await s.readBlob('bad.json', 'info')
    expect(info).toBe('not-a-json')
  })

  it('workspace write preserves existing baseSha and remoteSha and marks modified', async () => {
    const store = (InMemoryStorage as any).stores.get(rootName)
    store.infoBlobs.set('f1', JSON.stringify({ baseSha: 'BASE123', remoteSha: 'REMOTE1' }))
    await s.writeBlob('f1', 'newcontent', 'workspace')
    const raw = await s.readBlob('f1', 'info')
    const parsed = JSON.parse(raw!)
    expect(parsed.baseSha).toBe('BASE123')
    expect(parsed.remoteSha).toBe('REMOTE1')
    expect(parsed.workspaceSha).toBeDefined()
    expect(parsed.state).toBe('modified')
  })

  it('base write preserves existing workspaceSha and sets state base', async () => {
    const store = (InMemoryStorage as any).stores.get(rootName)
    store.infoBlobs.set('f2', JSON.stringify({ workspaceSha: 'WS123', remoteSha: 'R2' }))
    await s.writeBlob('f2', 'basecontent', 'base')
    const parsed = JSON.parse(await s.readBlob('f2', 'info')!)
    expect(parsed.workspaceSha).toBe('WS123')
    expect(parsed.baseSha).toBeDefined()
    expect(parsed.state).toBe('base')
    expect(parsed.remoteSha).toBe('R2')
  })

  it('conflict write preserves existing sha fields and state conflict', async () => {
    const store = (InMemoryStorage as any).stores.get(rootName)
    store.infoBlobs.set('f3', JSON.stringify({ baseSha: 'B3', workspaceSha: 'W3', remoteSha: 'R3' }))
    await s.writeBlob('f3', 'whatever', 'conflict')
    const parsed = JSON.parse(await s.readBlob('f3', 'info')!)
    expect(parsed.baseSha).toBe('B3')
    expect(parsed.workspaceSha).toBe('W3')
    expect(parsed.remoteSha).toBe('R3')
    expect(parsed.state).toBe('conflict')
  })

  it('deleteBlob with segment=info removes only info but leaves other segments', async () => {
    await s.writeBlob('d1', 'b', 'base')
    await s.writeBlob('d1', 'w', 'workspace')
    await s.writeBlob('d1', 'INFO', 'info')
    // remove only info
    await s.deleteBlob('d1', 'info')
    expect(await s.readBlob('d1', 'info')).toBeNull()
    expect(await s.readBlob('d1', 'workspace')).toBe('w')
    expect(await s.readBlob('d1', 'base')).toBe('b')
  })

  it('listFiles non-recursive with no prefix exercises p falsy branch', async () => {
    await s.writeBlob('top.txt', '1', 'workspace')
    await s.writeBlob('sub/inner.txt', '2', 'workspace')
    const res = await s.listFiles(undefined, 'workspace', false)
    const paths = res.map((r: any) => r.path)
    expect(paths).toContain('top.txt')
    expect(paths).not.toContain('sub/inner.txt')
  })

})
