/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { LocalFileManager } from '../../../../src/virtualfs/localFileManager'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'

describe('LocalFileManager', () => {
  let backend: any
  let lfm: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('lfm-test')
    lfm = new LocalFileManager(backend)
  })

  it('writeFile stores content in workspace', async () => {
    await lfm.writeFile('a.txt', 'hello')
    expect(await backend.readBlob('a.txt', 'workspace')).toBe('hello')
  })

  it('readFile returns workspace when present', async () => {
    await backend.writeBlob('b.txt', 'ws', 'workspace')
    await backend.writeBlob('b.txt', 'base', 'base')
    expect(await lfm.readFile('b.txt')).toBe('ws')
  })

  it('readFile falls back to base when workspace missing', async () => {
    await backend.writeBlob('c.txt', 'baseonly', 'base')
    expect(await lfm.readFile('c.txt')).toBe('baseonly')
  })

  it('readFile returns null when absent', async () => {
    expect(await lfm.readFile('nope.txt')).toBeNull()
  })

  it('deleteFile removes workspace and info', async () => {
    await backend.writeBlob('d.txt', 'ws', 'workspace')
    await backend.writeBlob('d.txt', JSON.stringify({ path: 'd.txt' }), 'info')
    await lfm.deleteFile('d.txt')
    expect(await backend.readBlob('d.txt', 'workspace')).toBeNull()
    // git-scoped info is not modified; workspace-info (tombstone) should exist
    expect(await backend.readBlob('d.txt', 'info')).not.toBeNull()
    const wsInfoTxt = await backend.readBlob('d.txt', 'info-workspace')
    expect(wsInfoTxt).not.toBeNull()
  })

  it('deleteFile creates workspace-info tombstone when git base exists', async () => {
    // prepare: write git base and git-scoped info
    backend.setBranch && backend.setBranch('main')
    await backend.writeBlob('tz.txt', 'base-content', 'base')
    await backend.writeBlob('tz.txt', JSON.stringify({ path: 'tz.txt', baseSha: 'sha123' }), 'info-git')

    // act
    await lfm.deleteFile('tz.txt')

    // workspace-info should be present as tombstone
    const wsInfoTxt = await backend.readBlob('tz.txt', 'info-workspace')
    expect(wsInfoTxt).not.toBeNull()
    const wsInfo = JSON.parse(wsInfoTxt!)
    expect(wsInfo.state).toBe('deleted')
    expect(wsInfo.baseSha).toBe('sha123')

    // git-scoped info must remain unchanged
    const gitInfoTxt = await backend.readBlob('tz.txt', 'info-git')
    expect(gitInfoTxt).not.toBeNull()
    const gitInfo = JSON.parse(gitInfoTxt!)
    expect(gitInfo.baseSha).toBe('sha123')
    expect(gitInfo.state === 'deleted').toBe(false)
  })

  it('renameFile copies content and deletes original', async () => {
    await backend.writeBlob('from.txt', 'data', 'workspace')
    await lfm.renameFile('from.txt', 'to.txt')
    expect(await backend.readBlob('to.txt', 'workspace')).toBe('data')
    expect(await backend.readBlob('from.txt', 'workspace')).toBeNull()
  })

  it('renameFile throws when source missing', async () => {
    await expect(lfm.renameFile('missing.txt', 'x.txt')).rejects.toThrow('Source file not found')
  })
})
import { jest } from '@jest/globals'
import { LocalFileManager } from '../../../../src/virtualfs/localFileManager'

describe('LocalFileManager', () => {
  let backend: any
  let mgr: LocalFileManager

  beforeEach(() => {
    backend = {
      readBlob: jest.fn(),
      writeBlob: jest.fn(),
      deleteBlob: jest.fn()
    }
    mgr = new LocalFileManager(backend)
  })

  it('reads workspace blob when present', async () => {
    backend.readBlob.mockImplementation((path: string, area: string) => {
      return area === 'workspace' ? 'ws-content' : null
    })
    const res = await mgr.readFile('foo.txt')
    expect(res).toBe('ws-content')
    expect(backend.readBlob).toHaveBeenCalledWith('foo.txt', 'workspace')
  })

  it('falls back to base blob when workspace missing', async () => {
    backend.readBlob.mockImplementation((path: string, area: string) => {
      if (area === 'workspace') return null
      if (area === 'base') return 'base-content'
      return null
    })
    const res = await mgr.readFile('bar.txt')
    expect(res).toBe('base-content')
  })

  it('returns null when neither workspace nor base present', async () => {
    backend.readBlob.mockResolvedValue(null)
    const res = await mgr.readFile('none.txt')
    expect(res).toBeNull()
  })

  it('renameFile copies content and deletes source', async () => {
    backend.readBlob.mockImplementation((path: string, area: string) => {
      return area === 'workspace' ? 'content-of-src' : null
    })
    await mgr.renameFile('a.txt', 'b.txt')
    expect(backend.writeBlob).toHaveBeenCalledWith('b.txt', 'content-of-src', 'workspace')
    // deleteFile deletes both workspace and info
    expect(backend.deleteBlob).toHaveBeenCalledWith('a.txt', 'workspace')
    // New behavior: write tombstone into workspace-info instead of deleting git-scoped info
    expect(backend.writeBlob).toHaveBeenCalled()
    const writeCalls = (backend.writeBlob as jest.Mock).mock.calls
    const wroteTombstone = writeCalls.some((c: any[]) => c[0] === 'a.txt' && c[2] === 'info-workspace')
    expect(wroteTombstone).toBe(true)
  })

  it('renameFile throws when source missing', async () => {
    backend.readBlob.mockResolvedValue(null)
    await expect(mgr.renameFile('x.txt', 'y.txt')).rejects.toThrow('Source file not found')
  })
})
