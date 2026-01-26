import { ChangeTracker } from '../../../src/virtualfs/changeTracker'

describe('ChangeTracker - table-driven branch tests', () => {
  const makeIndexManager = (entries: Record<string, any>) => ({
    getIndex: async () => ({ head: 'h', entries })
  })

  const makeBackend = (readMap: Record<string, string | null>, listFiles: Array<{ path: string; info: string | null }> = []) => ({
    readBlob: async (p: string) => (p in readMap ? readMap[p] : null),
    listFiles: async (_prefix?: string, _segment?: any) => listFiles
  })

  const cases = [
    {
      name: 'index-explicit-delete-state',
      indexEntries: { 'a.txt': { baseSha: 'bsha', state: 'deleted' } },
      backendReads: {},
      listFiles: [],
      expected: [{ type: 'delete', path: 'a.txt', baseSha: 'bsha' }]
    },
    {
      name: 'index-delete-workspace-missing',
      indexEntries: { 'x.txt': { baseSha: 'base-x', workspaceSha: 'w-x' } },
      backendReads: { 'x.txt': null },
      listFiles: [],
      expected: [{ type: 'delete', path: 'x.txt', baseSha: 'base-x' }]
    },
    {
      name: 'workspace-added-creates',
      indexEntries: {},
      backendReads: { 'b.txt': 'hello' },
      listFiles: [{ path: 'b.txt', info: JSON.stringify({ state: 'added' }) }],
      expected: [{ type: 'create', path: 'b.txt', content: 'hello' }]
    },
    {
      name: 'workspace-modified-updates',
      indexEntries: {},
      backendReads: { 'c.txt': 'new' },
      listFiles: [{ path: 'c.txt', info: JSON.stringify({ state: 'modified', baseSha: 'oldsha' }) }],
      expected: [{ type: 'update', path: 'c.txt', content: 'new', baseSha: 'oldsha' }]
    }
  ]

  test.each(cases)('$name', async (tc) => {
    const idx = makeIndexManager(tc.indexEntries)
    const backend = makeBackend(tc.backendReads, tc.listFiles)
    const tracker = new ChangeTracker(backend as any, idx as any)

    const changes = await tracker.getChangeSet()

    for (const exp of tc.expected) {
      expect(changes).toEqual(expect.arrayContaining([expect.objectContaining(exp)]))
    }
    expect(changes.length).toBeGreaterThanOrEqual(tc.expected.length)
  })
})
import { jest } from '@jest/globals'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'
import { ChangeTracker } from '../../../src/virtualfs/changeTracker'

describe('ChangeTracker - table-driven getChangeSet', () => {
  beforeEach(() => {
    try { InMemoryStorage.delete('ct-root') } catch (_) {}
  })

  const cases: Array<any> = [
    {
      name: 'delete via explicit remove state',
      index: { head: '', entries: { 'a.txt': { baseSha: 'b1', state: 'remove' } } },
      workspace: {},
      expect: [{ type: 'delete', path: 'a.txt', baseSha: 'b1' }]
    },
    {
      name: 'update when baseSha present and workspace blob exists',
      index: { head: '', entries: { 'b.txt': { baseSha: 'b2', state: 'modified', workspaceSha: 'w2' } } },
      workspace: { 'b.txt': 'content-b' },
      expect: [{ type: 'update', path: 'b.txt', content: 'content-b', baseSha: 'b2' }]
    },
    {
      name: 'create when state added and workspace blob present',
      index: { head: '', entries: { 'c.txt': { state: 'added', workspaceSha: 'w3' } } },
      workspace: { 'c.txt': 'content-c' },
      expect: [{ type: 'create', path: 'c.txt', content: 'content-c' }]
    },
    {
      name: 'delete when workspaceSha existed but workspace blob missing',
      index: { head: '', entries: { 'd.txt': { baseSha: 'b4', workspaceSha: 'w4', state: 'modified' } } },
      workspace: {},
      expect: [{ type: 'delete', path: 'd.txt', baseSha: 'b4' }]
    }
  ]

  it.each(cases)('$name', async (tc) => {
    const storage = new InMemoryStorage('ct-root')
    // write index entries via storage.writeIndex so infoBlobs are populated
    await storage.writeIndex(tc.index)
    // write workspace blobs as specified
    for (const [k, v] of Object.entries(tc.workspace)) {
      await storage.writeBlob(k, v as string, 'workspace')
    }

    const fakeIndexManager = { getIndex: async () => tc.index }
    const ct = new ChangeTracker(storage as any, fakeIndexManager as any)
    const changes = await ct.getChangeSet()
    // normalize: sort by path for deterministic compare
    const sorted = changes.map((c: any) => ({ ...c })).sort((a: any, b: any) => a.path.localeCompare(b.path))
    const expected = tc.expect.map((c: any) => ({ ...c })).sort((a: any, b: any) => a.path.localeCompare(b.path))
    expect(sorted).toEqual(expected)
  })
})
