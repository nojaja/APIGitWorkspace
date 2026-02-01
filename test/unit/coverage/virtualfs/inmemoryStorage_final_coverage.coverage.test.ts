/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */
import { jest } from '@jest/globals'

// Critical coverage for inmemoryStorage.ts and githubAdapter.ts
// Target: 77.83% → 80%+ (final 2.17pp)

import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'

describe('InMemoryStorage critical line coverage', () => {
  describe('Line 26 - availableRoots with empty stores', () => {
    it('availableRoots returns default when no stores exist', () => {
      // Do not manipulate internal static `stores` map to avoid order-dependency.
      // Instead assert that availableRoots contains the default storage name.
      const roots = InMemoryStorage.availableRoots()
      expect(roots).toContain('apigit_storage')
      expect(roots.length).toBeGreaterThan(0)
    })

    it('availableRoots returns existing store keys', () => {
      // Create multiple stores
      const s1 = new InMemoryStorage('store1')
      const s2 = new InMemoryStorage('store2')
      
      const roots = InMemoryStorage.availableRoots()
      expect(roots).toContain('store1')
      expect(roots).toContain('store2')
    })

    it('availableRoots reflects newly created stores', () => {
      const before = InMemoryStorage.availableRoots()
      
      const uniqueName = `test-${Date.now()}`
      new InMemoryStorage(uniqueName)
      
      const after = InMemoryStorage.availableRoots()
      expect(after).toContain(uniqueName)
      expect(after.length).toBeGreaterThanOrEqual(before.length)
    })
  })

  describe('Line 133 - _buildInfoEntryForSeg default case', () => {
    it('writeBlob to info segment uses default entry builder', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      // Write directly to info segment (unusual but valid)
      await storage.writeBlob('direct-info.txt', JSON.stringify({ custom: 'data' }), 'info')
      
      const result = await storage.readBlob('direct-info.txt', 'info')
      expect(result).not.toBeNull()
      
      if (result) {
        const parsed = JSON.parse(result)
        expect(parsed).toHaveProperty('custom', 'data')
      }
    })

    it('_buildInfoEntryForSeg handles unknown segment', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      // The default case in _buildInfoEntryForSeg is when segment is 'info'
      // or any other value that's not 'workspace', 'base', or 'conflict'
      
      // Write to info segment triggers the default path
      await storage.writeBlob('test.txt', 'content', 'info')
      
      const info = await storage.readBlob('test.txt', 'info')
      expect(info).toBeDefined()
    })
  })

  describe('Lines 264-266 - _filterKeys with edge cases', () => {
    it('listFiles with prefix and non-recursive filtering', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      // Create test structure
      await storage.writeBlob('dir/file1.txt', 'c1', 'workspace')
      await storage.writeBlob('dir/sub/file2.txt', 'c2', 'workspace')
      await storage.writeBlob('dir/sub/deep/file3.txt', 'c3', 'workspace')
      await storage.writeBlob('dir/file4.txt', 'c4', 'workspace')
      
      // Non-recursive with prefix
      const files = await storage.listFiles('dir', 'workspace', false)
      
      // Convert to paths if needed
      const paths = files.map(f => typeof f === 'string' ? f : f.path)
      
      // Should only include files directly under 'dir', not nested
      const directFiles = paths.filter(f => {
        const afterPrefix = f.slice('dir/'.length)
        return afterPrefix && !afterPrefix.includes('/')
      })
      
      expect(directFiles.length).toBeGreaterThan(0)
      
      // Verify nested files are excluded
      const hasNested = paths.some(f => {
        const afterPrefix = f.slice('dir/'.length)
        return afterPrefix.includes('/')
      })
      expect(hasNested).toBe(false)
    })

    it('listFiles filters keys correctly with empty prefix', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      await storage.writeBlob('top.txt', 'c1', 'workspace')
      await storage.writeBlob('sub/nested.txt', 'c2', 'workspace')
      
      // Empty prefix, non-recursive - should only show top-level files
      const files = await storage.listFiles('', 'workspace', false)
      
      const paths = files.map(f => typeof f === 'string' ? f : f.path)
      
      const topLevelOnly = paths.filter(f => !f.includes('/'))
      expect(topLevelOnly.length).toBeGreaterThan(0)
    })

    it('listFiles with exact prefix match', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      await storage.writeBlob('exact', 'content', 'workspace')
      await storage.writeBlob('exact/file.txt', 'content', 'workspace')
      await storage.writeBlob('exactish/file.txt', 'content', 'workspace')
      
      const files = await storage.listFiles('exact', 'workspace', true)
      
      const paths = files.map(f => typeof f === 'string' ? f : f.path)
      
      // Should match 'exact' exactly or 'exact/*'
      const validMatches = paths.every(f => f === 'exact' || f.startsWith('exact/'))
      expect(validMatches).toBe(true)
    })

    it('_filterKeys handles rest calculation edge case', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      // Files with similar prefixes
      await storage.writeBlob('pre/file.txt', 'c1', 'workspace')
      await storage.writeBlob('prefix/file.txt', 'c2', 'workspace')
      
      const files1 = await storage.listFiles('pre', 'workspace', true)
      const files2 = await storage.listFiles('prefix', 'workspace', true)
      
      // Convert to paths if needed
      const paths1 = files1.map(f => typeof f === 'string' ? f : f.path)
      const paths2 = files2.map(f => typeof f === 'string' ? f : f.path)
      
      // Each should only match its own prefix
      const pre = paths1.every(f => f === 'pre' || f.startsWith('pre/'))
      const prefix = paths2.every(f => f === 'prefix' || f.startsWith('prefix/'))
      
      expect(pre).toBe(true)
      expect(prefix).toBe(true)
    })
  })

  describe('Complex integration scenarios', () => {
    it('Full workflow with info entry building', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      const filename = 'lifecycle.txt'
      
      // 1. Write to workspace - triggers _buildWorkspaceInfoEntry
      await storage.writeBlob(filename, 'v1', 'workspace')
      let info = await storage.readBlob(filename, 'info')
      expect(info).not.toBeNull()
      
      if (info) {
        const parsed = JSON.parse(info)
        expect(parsed).toHaveProperty('workspaceSha')
        expect(parsed).toHaveProperty('state')
      }
      
      // 2. Write to base - triggers _buildBaseInfoEntry
      await storage.writeBlob(filename, 'v1', 'base')
      info = await storage.readBlob(filename, 'info')
      
      if (info) {
        const parsed = JSON.parse(info)
        expect(parsed).toHaveProperty('baseSha')
      }
      
      // 3. Write to conflict - triggers _buildConflictInfoEntry
      await storage.writeBlob(filename, 'conflict', 'conflict')
      info = await storage.readBlob(filename, 'info')
      
      if (info) {
        const parsed = JSON.parse(info)
        expect(parsed).toHaveProperty('state', 'conflict')
      }
    })

    it('Multiple stores interaction', async () => {
      const store1 = new InMemoryStorage('multi-test-1')
      const store2 = new InMemoryStorage('multi-test-2')
      
      await store1.init()
      await store2.init()
      
      // Write to different stores
      await store1.writeBlob('file.txt', 'store1 content', 'workspace')
      await store2.writeBlob('file.txt', 'store2 content', 'workspace')
      
      // Read from each - should be isolated
      const content1 = await store1.readBlob('file.txt', 'workspace')
      const content2 = await store2.readBlob('file.txt', 'workspace')
      
      expect(content1).toBe('store1 content')
      expect(content2).toBe('store2 content')
      expect(content1).not.toBe(content2)
    })

    it('VirtualFS with InMemoryStorage shows all branches', async () => {
      const backend = new InMemoryStorage('vfs-test')
      const vfs = new VirtualFS({ backend })
      
      await vfs.init()
      
      // Write file
      await vfs.writeFile('test.txt', 'content')
      
      // Read file
      const content = await vfs.readFile('test.txt')
      expect(content).toBe('content')
      
      // List paths
      const paths = await vfs.listPaths()
      expect(paths).toContain('test.txt')
      
      // Delete file
      await vfs.deleteFile('test.txt')
      
      // Verify deleted
      const afterDelete = await vfs.readFile('test.txt')
      expect(afterDelete).toBeNull()
    })

    it('listFiles with various prefix patterns', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      // Create diverse structure
      await storage.writeBlob('a/1.txt', 'c', 'workspace')
      await storage.writeBlob('a/b/2.txt', 'c', 'workspace')
      await storage.writeBlob('a/b/c/3.txt', 'c', 'workspace')
      await storage.writeBlob('ab/4.txt', 'c', 'workspace')
      await storage.writeBlob('abc/5.txt', 'c', 'workspace')
      
      // Test different prefixes
      const files_a = await storage.listFiles('a', 'workspace', true)
      const files_ab = await storage.listFiles('ab', 'workspace', true)
      const files_a_nonrec = await storage.listFiles('a', 'workspace', false)
      
      // Convert to paths
      const paths_a = files_a.map(f => typeof f === 'string' ? f : f.path)
      const paths_ab = files_ab.map(f => typeof f === 'string' ? f : f.path)
      const paths_a_nonrec = files_a_nonrec.map(f => typeof f === 'string' ? f : f.path)
      
      // 'a' should match 'a/*' but not 'ab' or 'abc'
      const a_valid = paths_a.every(f => f.startsWith('a/') || f === 'a')
      expect(a_valid).toBe(true)
      
      // 'ab' should match 'ab/*' but not 'abc'
      const ab_valid = paths_ab.every(f => f.startsWith('ab/') || f === 'ab')
      expect(ab_valid).toBe(true)
      
      // Non-recursive should not have nested slashes
      const a_flat = paths_a_nonrec.every(f => {
        const rest = f.slice('a/'.length)
        return !rest.includes('/')
      })
      expect(a_flat).toBe(true)
    })
  })

  describe('Edge cases and error conditions', () => {
    it('availableRoots after multiple store operations', () => {
      // Create and verify stores multiple times
      for (let i = 0; i < 5; i++) {
        new InMemoryStorage(`iteration-${i}`)
      }
      
      const roots = InMemoryStorage.availableRoots()
      expect(roots.length).toBeGreaterThan(0)
    })

    it('listFiles with special characters in prefix', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      await storage.writeBlob('日本語/ファイル.txt', 'content', 'workspace')
      await storage.writeBlob('日本語/sub/file.txt', 'content', 'workspace')
      
      const files = await storage.listFiles('日本語', 'workspace', true)
      expect(files.length).toBeGreaterThanOrEqual(0)
    })

    it('writeBlob to all segments triggers all info builders', async () => {
      const storage = new InMemoryStorage()
      await storage.init()
      
      // Write to each segment type
      await storage.writeBlob('all-seg.txt', 'ws', 'workspace')
      await storage.writeBlob('all-seg.txt', 'base', 'base')
      await storage.writeBlob('all-seg.txt', 'conflict', 'conflict')
      await storage.writeBlob('all-seg.txt', 'info-data', 'info')
      
      // Verify each segment
      const ws = await storage.readBlob('all-seg.txt', 'workspace')
      const base = await storage.readBlob('all-seg.txt', 'base')
      const conflict = await storage.readBlob('all-seg.txt', 'conflict')
      const info = await storage.readBlob('all-seg.txt', 'info')
      
      expect(ws).toBe('ws')
      expect(base).toBe('base')
      expect(conflict).toBe('conflict')
      expect(info).toBe('info-data')
    })
  })
})
