import { jest } from '@jest/globals'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage behaviors', () => {
  it('throws on unknown segment', async () => {
    const s = new InMemoryStorage()
    await expect(s.writeBlob('p', 'c', 'bogus' as any)).rejects.toThrow('unknown segment')
  })

  it('readBlob falls back from workspace to base', async () => {
    const s = new InMemoryStorage()
    await s.writeBlob('p', 'B', 'base')
    const val = await s.readBlob('p')
    expect(val).toBe('B')
    const ws = await s.readBlob('p', 'workspace')
    expect(ws).toBeNull()
  })

  it('info state is modified when base existed before workspace write', async () => {
    const s = new InMemoryStorage()
    await s.writeBlob('p', 'base-content', 'base')
    await s.writeBlob('p', 'ws-content', 'workspace')
    const info = await s.readBlob('p', 'info')
    expect(info).not.toBeNull()
    const parsed = JSON.parse(info!)
    expect(parsed.state).toBe('modified')
  })

  it('info state is added when no base existed before workspace write', async () => {
    const s = new InMemoryStorage()
    await s.writeBlob('q', 'ws-content', 'workspace')
    const info = await s.readBlob('q', 'info')
    expect(info).not.toBeNull()
    const parsed = JSON.parse(info!)
    expect(parsed.state).toBe('added')
  })
})
