import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS coverage targets', () => {
  it('_isNonFastForwardError detection', () => {
    const v = new VirtualFS({ backend: new InMemoryStorage() })
    expect((v as any)._isNonFastForwardError(new Error('422'))).toBe(true)
    expect((v as any)._isNonFastForwardError('some fast forward error')).toBe(true)
    expect((v as any)._isNonFastForwardError(new Error('other'))).toBe(false)
  })

  it('push throws when parentSha undefined or head mismatch', async () => {
    const v = new VirtualFS({ backend: new InMemoryStorage() })
    // missing parentSha
    await expect(v.push({ parentSha: undefined as any, changes: [{ type: 'create', path: 'a', content: 'x' }] } as any)).rejects.toThrow()

    // head mismatch
    await expect(v.push({ parentSha: 'not-head', changes: [{ type: 'create', path: 'a', content: 'x' }] } as any)).rejects.toThrow()
  })

  it('_areAllResolved and _promoteResolvedConflicts flow', async () => {
    const backend = new InMemoryStorage()
    const v = new VirtualFS({ backend })
    // prepare index entry with baseSha equal to remoteSha
    const ie: any = { path: 'f', state: 'conflict', remoteSha: 'rs', baseSha: 'rs', updatedAt: Date.now() }
    ;(await v.getIndex()).entries['f'] = ie
    const conflicts = [{ path: 'f', remoteSha: 'rs' }]
    // prepare baseSnapshot content
    const baseSnapshot: Record<string, string> = { f: 'content' }
    await (v as any)._promoteResolvedConflicts(conflicts, baseSnapshot, 'head123')
    expect((await v.getIndex()).head).toBe('head123')
    expect((await v.getIndex()).entries['f'].state).toBe('base')
  })

  it('resolveConflict promotes remote content when present and deletes conflict blob', async () => {
    const backend = new InMemoryStorage()
    const v = new VirtualFS({ backend })
    // write conflict blob
    await backend.writeBlob('x', 'payload', 'conflict')
    // create index entry with remoteSha
    ;(await v.getIndex()).entries['x'] = { path: 'x', state: 'conflict', remoteSha: 'r1', updatedAt: Date.now() }
    const ok = await v.resolveConflict('x')
    expect(ok).toBe(true)
    // after resolve, index entry should be base and conflict removed
    expect((await v.getIndex()).entries['x'].state).toBe('base')
    const got = await backend.readBlob('x', 'conflict')
    expect(got).toBeNull()
  })

  it('_handleRemoteDeletion branches', async () => {
    const backend = new InMemoryStorage()
    const v = new VirtualFS({ backend })
    // case: entry with no baseSha -> ignored
    ;(await v.getIndex()).entries['nobase'] = { path: 'nobase', state: 'added' }
    const conflicts: any[] = []
    await (v as any)._handleRemoteDeletion('nobase', (await v.getIndex()).entries['nobase'], {}, conflicts)
    expect((await v.getIndex()).entries['nobase']).toBeDefined()

    // case: entry with baseSha and no localWorkspace -> deleted
    ;(await v.getIndex()).entries['delme'] = { path: 'delme', state: 'base', baseSha: 'b', updatedAt: Date.now() }
    await backend.writeBlob('delme', 'old')
    await (v as any)._handleRemoteDeletion('delme', (await v.getIndex()).entries['delme'], {}, conflicts)
    expect((await v.getIndex()).entries['delme']).toBeUndefined()

    // case: entry with baseSha but workspace different sha -> conflict
    ;(await v.getIndex()).entries['c'] = { path: 'c', state: 'base', baseSha: 'b1', updatedAt: Date.now() }
    ;(v as any).workspace.set('c', { sha: 'different', content: 'x' })
    const conflicts2: any[] = []
    await (v as any)._handleRemoteDeletion('c', (await v.getIndex()).entries['c'], {}, conflicts2)
    expect(conflicts2.length).toBeGreaterThan(0)
  })
})
