/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'
import { shaOf, shaOfGitBlob } from '../../../../src/virtualfs/hashUtils'

describe('VirtualFS branch-focused tests', () => {
  let backend: any
  let vfs: any

  beforeEach(async () => {
    backend = new (InMemoryStorage as any)('branch-tests')
    vfs = new VirtualFS({ backend })
    await vfs.init()
  })

  // Tests for private helper _classifyRemotePathForPull removed per request.

  // Tests for private helpers handling new remote adds/conflicts removed.

  // Tests for private helper _handleRemoteExistingUpdate removed.

  // Tests for private helper _handleRemoteDeletion removed.

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
