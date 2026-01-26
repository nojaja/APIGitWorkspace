import { jest } from '@jest/globals'
import { VirtualFS } from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'
import { shaOf, shaOfGitBlob } from '../../../src/virtualfs/hashUtils'

describe('VirtualFS branch-focused tests', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('branch-tests')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  describe('_classifyRemotePathForPull', () => {
    const p = 'a.txt'

    it('returns false when no info entry', async () => {
      const pathsToFetch: string[] = []
      const reconciled: string[] = []
      const normalized = { headSha: 'h', shas: {}, fetchContent: async (_: string[]) => ({}) }
      const res = await (vfs as any)._classifyRemotePathForPull(p, 'deadbeef', normalized, pathsToFetch, reconciled)
      expect(res).toBe(false)
      expect(reconciled).toHaveLength(0)
    })

    it('returns true when info.baseSha matches provided sha', async () => {
      const entry = { path: p, baseSha: 'same-sha', state: 'base' }
      await backend.writeBlob(p, JSON.stringify(entry), 'info')
      const pathsToFetch: string[] = []
      const reconciled: string[] = []
      const normalized = { headSha: 'h', shas: {}, fetchContent: async (_: string[]) => ({}) }
      const res = await (vfs as any)._classifyRemotePathForPull(p, 'same-sha', normalized, pathsToFetch, reconciled)
      expect(res).toBe(true)
      expect(reconciled).toHaveLength(0)
    })

    it('reconciles from base content when git blob sha matches', async () => {
      const baseContent = 'base content'
      const gitSha = await shaOfGitBlob(baseContent)
      // info exists but baseSha different
      const entry = { path: p, baseSha: 'old', state: 'base' }
      await backend.writeBlob(p, JSON.stringify(entry), 'info')
      // write base content so reconciliation can occur
      await backend.writeBlob(p, baseContent, 'base')
      const pathsToFetch: string[] = []
      const reconciled: string[] = []
      const normalized = { headSha: 'h', shas: {}, fetchContent: async (_: string[]) => ({}) }
      const res = await (vfs as any)._classifyRemotePathForPull(p, gitSha, normalized, pathsToFetch, reconciled)
      expect(res).toBe(true)
      expect(reconciled).toContain(p)
      const infoTxt = await backend.readBlob(p, 'info')
      const ie = JSON.parse(infoTxt)
      expect(ie.baseSha).toBe(gitSha)
    })

    it('returns false when base exists but does not reconcile', async () => {
      const baseContent = 'other'
      const entry = { path: p, baseSha: 'old', state: 'base' }
      await backend.writeBlob(p, JSON.stringify(entry), 'info')
      await backend.writeBlob(p, baseContent, 'base')
      const pathsToFetch: string[] = []
      const reconciled: string[] = []
      const normalized = { headSha: 'h', shas: {}, fetchContent: async (_: string[]) => ({}) }
      const res = await (vfs as any)._classifyRemotePathForPull(p, 'unrelated-sha', normalized, pathsToFetch, reconciled)
      expect(res).toBe(false)
      expect(reconciled).toHaveLength(0)
    })
  })

  describe('_handleRemoteNewAdd and _handleRemoteNewConflict', () => {
    const p = 'new.txt'
    it('adds to base when snapshot provides content', async () => {
      const baseSnapshot: Record<string, string> = { [p]: 'hello' }
      const perFileRemoteSha = await shaOf(baseSnapshot[p])
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteNewAdd(p, perFileRemoteSha, baseSnapshot, 'remoteHead', conflicts, undefined, undefined)
      const base = await backend.readBlob(p, 'base')
      expect(base).toBe('hello')
      const infoTxt = await backend.readBlob(p, 'info')
      const ie = JSON.parse(infoTxt)
      expect(ie.baseSha).toBe(perFileRemoteSha)
      expect(conflicts).toHaveLength(0)
    })

    it('creates conflict when snapshot lacks content', async () => {
      const baseSnapshot: Record<string, string> = {}
      const perFileRemoteSha = 'irrelevant'
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteNewAdd(p, perFileRemoteSha, baseSnapshot, 'remoteHead2', conflicts, undefined, undefined)
      expect(conflicts.length).toBeGreaterThan(0)
      const infoTxt = await backend.readBlob(p, 'info')
      const ie = infoTxt ? JSON.parse(infoTxt) : null
      expect(ie).not.toBeNull()
      expect(ie.state).toBe('conflict')
    })
  })

  describe('_handleRemoteExistingUpdate', () => {
    const p = 'exist.txt'
    it('marks conflict when base content missing in snapshot', async () => {
      const indexEntry = { path: p, baseSha: 'oldsha', state: 'base' }
      await backend.writeBlob(p, JSON.stringify(indexEntry), 'info')
      const baseSnapshot: Record<string, string> = {}
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteExistingUpdate(p, indexEntry, 'newsha', baseSnapshot, conflicts, 'remoteHead')
      const infoTxt = await backend.readBlob(p, 'info')
      const ie = JSON.parse(infoTxt)
      expect(ie.state).toBe('conflict')
      expect(conflicts).toHaveLength(1)
    })

    it('updates base when snapshot provides content', async () => {
      const p2 = 'exist2.txt'
      const content = 'content-42'
      const sha = await shaOf(content)
      const indexEntry = { path: p2, baseSha: 'oldsha', state: 'base' }
      await backend.writeBlob(p2, JSON.stringify(indexEntry), 'info')
      const baseSnapshot: Record<string, string> = { [p2]: content }
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteExistingUpdate(p2, indexEntry, sha, baseSnapshot, conflicts, 'remoteHead')
      const base = await backend.readBlob(p2, 'base')
      expect(base).toBe(content)
      const infoTxt = await backend.readBlob(p2, 'info')
      const ie = JSON.parse(infoTxt)
      expect(ie.baseSha).toBe(sha)
      expect(ie.state).toBe('base')
    })
  })

  describe('_handleRemoteDeletion', () => {
    const p = 'del.txt'
    it('returns (no-op) when indexEntry missing or has no baseSha', async () => {
      // no index entry
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteDeletion(p, undefined, {}, conflicts)
      expect(conflicts).toHaveLength(0)

      // index entry without baseSha
      const ie = { path: p }
      await backend.writeBlob(p, JSON.stringify(ie), 'info')
      await (vfs as any)._handleRemoteDeletion(p, ie, {}, conflicts)
      expect(conflicts).toHaveLength(0)
    })

    it('deletes safely when no local workspace', async () => {
      const ie = { path: p, baseSha: 'b' }
      await backend.writeBlob(p, JSON.stringify(ie), 'info')
      await backend.writeBlob(p, 'base-content', 'base')
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteDeletion(p, ie, {}, conflicts)
      const infoTxt = await backend.readBlob(p, 'info')
      expect(infoTxt).toBeNull()
      const base = await backend.readBlob(p, 'base')
      expect(base).toBeNull()
    })

    it('adds conflict when workspace differs from base', async () => {
      const ie = { path: p, baseSha: 'b' }
      await backend.writeBlob(p, JSON.stringify(ie), 'info')
      await backend.writeBlob(p, 'base-content', 'base')
      // workspace exists and differs
      await backend.writeBlob(p, 'modified-workspace', 'workspace')
      const conflicts: any[] = []
      await (vfs as any)._handleRemoteDeletion(p, ie, {}, conflicts)
      expect(conflicts).toHaveLength(1)
    })
  })

  describe('_applyChangeLocally', () => {
    it('applies create/update and writes base & info', async () => {
      const ch = { type: 'create', path: 'c.txt', content: 'C' }
      await (vfs as any)._applyChangeLocally(ch)
      const base = await backend.readBlob('c.txt', 'base')
      expect(base).toBe('C')
      const infoTxt = await backend.readBlob('c.txt', 'info')
      const ie = JSON.parse(infoTxt)
      expect(ie.baseSha).toBeDefined()
      expect(ie.state).toBe('base')
    })

    it('applies delete by delegating to applier', async () => {
      const path = 'd.txt'
      await backend.writeBlob(path, JSON.stringify({ path, baseSha: 'b' }), 'info')
      await backend.writeBlob(path, 'base', 'base')
      const ch = { type: 'delete', path, baseSha: 'b' }
      await (vfs as any)._applyChangeLocally(ch)
      expect(await backend.readBlob(path, 'info')).toBeNull()
      expect(await backend.readBlob(path, 'base')).toBeNull()
    })
  })
})
