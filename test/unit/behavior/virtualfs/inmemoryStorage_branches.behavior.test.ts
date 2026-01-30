/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { describe, it, expect } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage additional branches', () => {
  const segmentCases = [
    { name: 'workspace', key: 'w.txt', value: 'workspace-data' },
    { name: 'base', key: 'b.txt', value: 'base-data' },
    { name: 'conflict', key: 'c.txt', value: 'conflict-data' }
  ]

  it.each(segmentCases)('writeBlob stores data in %s segment', async (c) => {
    const storage = new InMemoryStorage()

    await storage.writeBlob(c.key, c.value, c.name as any)
    const read = await storage.readBlob(c.key, c.name as any)

    expect(read).toBe(c.value)
  })

  it('segments are isolated and overwrite works', async () => {
    const storage = new InMemoryStorage()

    await storage.writeBlob('file.txt', 'workspace-data', 'workspace')
    await storage.writeBlob('file.txt', 'base-data', 'base')
    await storage.writeBlob('file.txt', 'conflict-data', 'conflict')

    expect(await storage.readBlob('file.txt', 'workspace')).toBe('workspace-data')
    expect(await storage.readBlob('file.txt', 'base')).toBe('base-data')
    expect(await storage.readBlob('file.txt', 'conflict')).toBe('conflict-data')

    // overwrite
    await storage.writeBlob('file.txt', 'updated', 'workspace')
    expect(await storage.readBlob('file.txt', 'workspace')).toBe('updated')
  })

  const listCases = [
    { initial: ['a.txt', 'b.txt', 'c.txt'], delete: null, expectCount: 3 },
    { initial: ['a.txt', 'b.txt'], delete: 'a.txt', expectCount: 1 }
  ]

  it.each(listCases)('listFiles reflects additions and deletions %#', async (c) => {
    const storage = new InMemoryStorage()

    for (const p of c.initial) await storage.writeBlob(p, p, 'workspace')
    if (c.delete) await storage.deleteBlob(c.delete, 'workspace')

    const files = await storage.listFiles('', 'workspace')
    const paths = files.map(f => f.path)

    for (const p of (c.delete ? c.initial.filter(x => x !== c.delete) : c.initial)) {
      expect(paths).toContain(p)
    }
    if (c.delete) expect(paths).not.toContain(c.delete)
    expect(files.length).toBe(c.expectCount)
  })

  it('deleteBlob handles non-existent key gracefully', async () => {
    const storage = new InMemoryStorage()
    await expect(storage.deleteBlob('nonexistent.txt', 'workspace')).resolves.not.toThrow()
  })

  it('readBlob returns null for non-existent blob', async () => {
    const storage = new InMemoryStorage()
    const result = await storage.readBlob('missing.txt', 'workspace')
    expect(result).toBeNull()
  })

  it('writeIndex and readIndex work together / default structure', async () => {
    const storage = new InMemoryStorage()

    const index = { head: 'abc123', conflicts: ['conflict1.txt'], deleted: ['deleted1.txt'] }
    await storage.writeIndex(index)
    const retrieved = await storage.readIndex()

    expect(retrieved).toBeDefined()
    expect(retrieved.head).toBe('abc123')

    const storage2 = new InMemoryStorage()
    const defaultIdx = await storage2.readIndex()
    expect(defaultIdx).toBeDefined()
    expect(defaultIdx.head).toBeDefined()
  })

  it('info segment stores file metadata', async () => {
    const storage = new InMemoryStorage()

    const metadata = JSON.stringify({ path: 'file.txt', baseSha: 'sha123', state: 'modified' })
    await storage.writeBlob('file.txt', metadata, 'info')
    const retrieved = await storage.readBlob('file.txt', 'info')
    const parsed = JSON.parse(retrieved!)

    expect(parsed.path).toBe('file.txt')
    expect(parsed.baseSha).toBe('sha123')
    expect(parsed.state).toBe('modified')
  })
})
