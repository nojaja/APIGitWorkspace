/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import ConflictManager from '../../../../src/virtualfs/conflictManager'

describe('ConflictManager branches', () => {
  it('persistRemoteContentAsConflict handles undefined and write errors', async () => {
    const backend: any = { writeBlob: jest.fn().mockResolvedValue(undefined) }
    const indexManager: any = { getIndex: jest.fn() }
    const cm = new ConflictManager(backend, indexManager)

    await expect((cm as any).persistRemoteContentAsConflict('p', undefined)).resolves.toBeUndefined()
    backend.writeBlob.mockImplementationOnce(() => { throw new Error('fail') })
    await expect((cm as any).persistRemoteContentAsConflict('p', 'c')).resolves.toBeUndefined()
  })

  it('areAllResolved returns false for missing entry and true when matched', async () => {
    const backend: any = { readBlob: jest.fn() }
    const indexManager: any = { getIndex: jest.fn().mockResolvedValue({ entries: { 'a': { baseSha: 'x', remoteSha: 'x' } } }) }
    const cm = new ConflictManager(backend, indexManager)

    // case: info blob absent and index entry present but mismatch
    backend.readBlob.mockResolvedValueOnce(null)
    const res = await cm.areAllResolved([{ path: 'a' }])
    expect(res).toBe(true)

    // case: missing entry leads to false
    indexManager.getIndex.mockResolvedValueOnce({ entries: {} })
    backend.readBlob.mockResolvedValueOnce(null)
    const res2 = await cm.areAllResolved([{ path: 'b' }])
    expect(res2).toBe(false)
  })

  it('promoteResolvedConflicts early returns when not all resolved and promotes when all resolved', async () => {
    const backend: any = { readBlob: jest.fn(), writeBlob: jest.fn(), deleteBlob: jest.fn() }
    const indexManager: any = { getIndex: jest.fn(), setHead: jest.fn(), saveIndex: jest.fn(), loadIndex: jest.fn() }
    const cm = new ConflictManager(backend, indexManager)

    // mock areAllResolved false
    jest.spyOn(cm as any, 'areAllResolved').mockResolvedValueOnce(false)
    await cm.promoteResolvedConflicts([{ path: 'x' }], {}, 'h')
    // now true path
    jest.spyOn(cm as any, 'areAllResolved').mockResolvedValueOnce(true)
    const spy = jest.spyOn(cm as any, 'promoteResolvedConflictEntry').mockResolvedValue(undefined)
    await cm.promoteResolvedConflicts([{ path: 'x' }], {}, 'h')
    expect(spy).toHaveBeenCalled()
    expect(indexManager.setHead).toHaveBeenCalledWith('h')
  })

  it('promoteResolvedConflictEntry handles info absent and present', async () => {
    const backend: any = { readBlob: jest.fn(), writeBlob: jest.fn(), deleteBlob: jest.fn() }
    const indexManager: any = { getIndex: jest.fn() }
    const cm = new ConflictManager(backend, indexManager)

    // info absent -> return early
    backend.readBlob.mockResolvedValueOnce(null)
    await cm.promoteResolvedConflictEntry({ path: 'p' }, {})

    // info present and baseSnapshot provides content
    const ie = { remoteSha: 'r' }
    backend.readBlob.mockResolvedValueOnce(JSON.stringify(ie)) // info
    await cm.promoteResolvedConflictEntry({ path: 'p' }, { p: 'content' })
    expect(backend.writeBlob).toHaveBeenCalled()
    expect(backend.deleteBlob).toHaveBeenCalled()
  })
})
