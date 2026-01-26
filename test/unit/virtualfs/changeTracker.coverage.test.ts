import { jest } from '@jest/globals'
import { ChangeTracker } from '../../../src/virtualfs/changeTracker'

describe('ChangeTracker branch coverage', () => {
  it('detects delete from index entry with remove state', async () => {
    const backend: any = {
      readBlob: jest.fn(),
      listFiles: jest.fn().mockResolvedValue([])
    }

    const indexManager: any = {
      getIndex: jest.fn().mockResolvedValue({ entries: { 'del.txt': { baseSha: 'b', state: 'remove' } } })
    }

    const ct = new ChangeTracker(backend, indexManager)
    const cs = await ct.getChangeSet()
    expect(cs.some((c: any) => c.type === 'delete' && c.path === 'del.txt')).toBe(true)
  })

  it('considers entry deleted when workspace blob missing', async () => {
    const backend: any = {
      readBlob: jest.fn().mockResolvedValue(null),
      listFiles: jest.fn().mockResolvedValue([])
    }

    const indexManager: any = {
      getIndex: jest.fn().mockResolvedValue({ entries: { 'del2.txt': { baseSha: 'b2', workspaceSha: 'ws', state: 'modified' } } })
    }

    const ct = new ChangeTracker(backend, indexManager)
    const cs = await ct.getChangeSet()
    expect(cs.find((c: any) => c.path === 'del2.txt' && c.type === 'delete')).toBeDefined()
  })

  it('produces create and update changes from workspace index files', async () => {
    const backend: any = {
      readBlob: jest.fn().mockImplementation((p: string) => Promise.resolve(p === 'new.txt' ? 'newcontent' : 'updcontent')),
      listFiles: jest.fn().mockResolvedValue([
        { path: 'new.txt', info: JSON.stringify({ state: 'added' }) },
        { path: 'upd.txt', info: JSON.stringify({ state: 'modified', baseSha: 'old' }) }
      ])
    }

    const indexManager: any = {
      getIndex: jest.fn().mockResolvedValue({ entries: {} })
    }

    const ct = new ChangeTracker(backend, indexManager)
    const cs = await ct.getChangeSet()
    expect(cs.some((c: any) => c.type === 'create' && c.path === 'new.txt')).toBe(true)
    expect(cs.some((c: any) => c.type === 'update' && c.path === 'upd.txt')).toBe(true)
  })
})
