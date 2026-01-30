/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage private builders and edge branches', () => {
  let root: string
  let inst: any

  beforeEach(() => {
    root = `pb_${Date.now()}_${Math.random().toString(36).slice(2)}`
    inst = new (InMemoryStorage as any)(root)
  })
  afterEach(() => {
    try { (InMemoryStorage as any).delete(root) } catch (_e) {}
  })

  it('private _buildWorkspaceInfoEntry covers baseSha and remoteSha preservation', () => {
    const proto: any = (InMemoryStorage as any).prototype
    const existing = { baseSha: 'B1', remoteSha: 'R1' }
    const res = proto._buildWorkspaceInfoEntry.call(inst, existing, 'file.txt', 'S1', 1234)
    expect(res.baseSha).toBe('B1')
    expect(res.remoteSha).toBe('R1')
    expect(res.workspaceSha).toBe('S1')
    expect(res.state).toBe('modified')
  })

  it('private _buildWorkspaceInfoEntry when no existing sets added', () => {
    const proto: any = (InMemoryStorage as any).prototype
    const res = proto._buildWorkspaceInfoEntry.call(inst, undefined, 'file2', 'S2', 2000)
    expect(res.baseSha).toBeUndefined()
    expect(res.state).toBe('added')
  })

  it('private _buildBaseInfoEntry preserves workspaceSha and remoteSha', () => {
    const proto: any = (InMemoryStorage as any).prototype
    const existing = { workspaceSha: 'W1', remoteSha: 'R2' }
    const res = proto._buildBaseInfoEntry.call(inst, existing, 'b.txt', 'B2', 3000)
    expect(res.workspaceSha).toBe('W1')
    expect(res.remoteSha).toBe('R2')
    expect(res.baseSha).toBe('B2')
    expect(res.state).toBe('base')
  })

  it('private _buildConflictInfoEntry preserves various sha fields', () => {
    const proto: any = (InMemoryStorage as any).prototype
    const existing = { baseSha: 'BX', workspaceSha: 'WX', remoteSha: 'RX' }
    const res = proto._buildConflictInfoEntry.call(inst, existing, 'c.txt', 4000)
    expect(res.baseSha).toBe('BX')
    expect(res.workspaceSha).toBe('WX')
    expect(res.remoteSha).toBe('RX')
    expect(res.state).toBe('conflict')
  })

  it('listFiles with prefix "/" normalizes to empty p and exercises replacement edge', async () => {
    await inst.writeBlob('a/x.txt', '1', 'workspace')
    await inst.writeBlob('b/y.txt', '2', 'workspace')
    const res = await inst.listFiles('/', 'workspace', true)
    const paths = res.map((r:any)=>r.path)
    expect(paths).toEqual(expect.arrayContaining(['a/x.txt','b/y.txt']))
  })

})
