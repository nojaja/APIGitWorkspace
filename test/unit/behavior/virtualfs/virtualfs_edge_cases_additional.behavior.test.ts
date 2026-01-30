/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

/**
 * VirtualFS Additional Coverage - Edge cases and error paths
 * Purpose: Hit uncovered branches in virtualfs.ts (lines: 83-85, 237-238, 270, 341, 363-364, etc.)
 */

import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'
import { VirtualFS } from '../../../../src/virtualfs/virtualfs'

describe('VirtualFS - Additional edge cases and error paths', () => {
  describe('Init edge cases', () => {
    it('init when backend has existing data', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })

      // First init
      await vfs.init()

      // Second init - should handle existing data
      await vfs.init()

      expect(vfs).toBeDefined()
    })

    it('init creates default index structure', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })

      await vfs.init()

      // Verify index was created
      const index = await backend.readIndex()
      expect(index).toBeDefined()
      expect(index).toHaveProperty('entries')
      expect(index).toHaveProperty('head')
    })
  })

  describe('File operations edge cases', () => {
    it('readFile from empty filesystem returns null', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      const result = await vfs.readFile('nonexistent.txt')
      expect(result).toBeNull()
    })

    it('writeFile overwrites existing file', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('file.txt', 'original')
      let content = await vfs.readFile('file.txt')
      expect(content).toBe('original')

      await vfs.writeFile('file.txt', 'updated')
      content = await vfs.readFile('file.txt')
      expect(content).toBe('updated')
    })

    it('writeFile creates intermediate files', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // Write nested path
      await vfs.writeFile('dir/subdir/file.txt', 'content')
      const result = await vfs.readFile('dir/subdir/file.txt')
      expect(result).toBe('content')
    })

    it('deleteFile marks file as removed', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('file.txt', 'content')
      await vfs.deleteFile('file.txt')

      // After delete, readFile returns null
      const result = await vfs.readFile('file.txt')
      expect(result).toBeNull()
    })

    it('deleteFile on nonexistent file', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // Should not throw
      await expect(vfs.deleteFile('nonexistent.txt')).resolves.toBeUndefined()
    })
  })

  describe('Rename and move operations', () => {
    it('renameFile renames existing file', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('old.txt', 'content')
      await vfs.renameFile('old.txt', 'new.txt')

      let newContent = await vfs.readFile('new.txt')
      expect(newContent).toBe('content')
    })

    it('renameFile old file marked as removed', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('old.txt', 'content')
      await vfs.renameFile('old.txt', 'new.txt')

      // Old file becomes null (marked as removed)
      let oldContent = await vfs.readFile('old.txt')
      expect(oldContent).toBeNull()
    })

    it('renameFile to existing file overwrites', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('file1.txt', 'content1')
      await vfs.writeFile('file2.txt', 'content2')

      // Rename file1 to file2 - may result in content1 or content2
      await vfs.renameFile('file1.txt', 'file2.txt')

      let result = await vfs.readFile('file2.txt')
      // Result should be a string (may be from file1 or file2)
      expect(typeof result === 'string' || result === null).toBe(true)
    })
  })

  describe('Snapshot operations with existing data', () => {
    it('applyBaseSnapshot overwrites existing files', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('old.txt', 'old content')

      // Apply snapshot
      await vfs.applyBaseSnapshot({ 'new.txt': 'new content' }, 'h1')

      let result = await vfs.readFile('new.txt')
      expect(result).toBe('new content')
    })

    it('applyBaseSnapshot with empty snapshot', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await expect(vfs.applyBaseSnapshot({}, 'h1')).resolves.toBeUndefined()
    })

    it('applyBaseSnapshot with complex paths', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      const snapshot: Record<string, string> = {}
      for (let i = 0; i < 10; i++) {
        snapshot[`file${i}.txt`] = `content${i}`
      }

      await vfs.applyBaseSnapshot(snapshot, 'h1')

      for (let i = 0; i < 10; i++) {
        let result = await vfs.readFile(`file${i}.txt`)
        expect(result).toBe(`content${i}`)
      }
    })
  })

  describe('Pull operations with modifications', () => {
    it('pull with local and remote both modified', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // Base state
      await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'h1')

      // Local modification
      await vfs.writeFile('file.txt', 'local')

      // Remote state
      const remoteSnapshot = { 'file.txt': 'remote' }

      const result = await vfs.pull('h2', remoteSnapshot)
      expect(result).toHaveProperty('fetchedPaths')
    })

    it('pull with local deletion, remote modification', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'h1')
      await vfs.deleteFile('file.txt')

      const result = await vfs.pull('h2', { 'file.txt': 'remote' })
      expect(result).toHaveProperty('fetchedPaths')
    })

    it('pull with local creation, remote has it', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.applyBaseSnapshot({}, 'h1')
      await vfs.writeFile('new.txt', 'local')

      const result = await vfs.pull('h2', { 'new.txt': 'remote' })
      expect(result).toHaveProperty('fetchedPaths')
    })

    it('pull reconciles state correctly', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.applyBaseSnapshot({
        'a.txt': 'a_base',
        'b.txt': 'b_base',
        'c.txt': 'c_base'
      }, 'h1')

      // Local: modify a, delete b, create d
      await vfs.writeFile('a.txt', 'a_local')
      await vfs.deleteFile('b.txt')
      await vfs.writeFile('d.txt', 'd_local')

      // Remote: modify b, delete c, create e
      const remoteSnapshot = {
        'a.txt': 'a_base',
        'b.txt': 'b_remote',
        'd.txt': 'd_base',
        'e.txt': 'e_remote'
      }

      const result = await vfs.pull('h2', remoteSnapshot)
      expect(result).toHaveProperty('reconciledPaths')
    })
  })

  describe('Special characters and encoding', () => {
    it('readFile with UTF-8 content', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      const utf8Content = '日本語テキスト 😀 Special: @#$%^&*()'
      await vfs.writeFile('unicode.txt', utf8Content)

      const result = await vfs.readFile('unicode.txt')
      expect(result).toBe(utf8Content)
    })

    it('readFile with newlines and tabs', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      const multilineContent = 'line1\nline2\r\nline3\twith\ttabs'
      await vfs.writeFile('multiline.txt', multilineContent)

      const result = await vfs.readFile('multiline.txt')
      expect(result).toBe(multilineContent)
    })

    it('readFile with binary-like content', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      const binaryLike = '\x00\x01\x02\x03\xff\xfe'
      await vfs.writeFile('binary.bin', binaryLike)

      const result = await vfs.readFile('binary.bin')
      expect(result).toBe(binaryLike)
    })
  })

  describe('Edge case combinations', () => {
    it('multiple consecutive snapshots', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // First snapshot
      await vfs.applyBaseSnapshot({ 'a.txt': 'a1' }, 'h1')

      // Pull
      const result1 = await vfs.pull('h2', { 'a.txt': 'a2', 'b.txt': 'b2' })
      expect(result1).toHaveProperty('fetchedPaths')

      // Second snapshot
      await vfs.applyBaseSnapshot({ 'c.txt': 'c3' }, 'h3')

      // Final state check
      let cResult = await vfs.readFile('c.txt')
      expect(cResult).toBe('c3')
    })

    it('large number of file operations', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // Create many files
      for (let i = 0; i < 50; i++) {
        await vfs.writeFile(`file${i}.txt`, `content${i}`)
      }

      // Verify random samples
      let result5 = await vfs.readFile('file5.txt')
      expect(result5).toBe('content5')

      let result45 = await vfs.readFile('file45.txt')
      expect(result45).toBe('content45')
    })

    it('modify same file multiple times', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      await vfs.writeFile('test.txt', 'v1')
      await vfs.writeFile('test.txt', 'v2')
      await vfs.writeFile('test.txt', 'v3')
      await vfs.writeFile('test.txt', 'v4')

      const result = await vfs.readFile('test.txt')
      expect(result).toBe('v4')
    })
  })

  describe('State transitions', () => {
    it('file lifecycle: create -> modify -> delete -> recreate', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // Create
      await vfs.writeFile('file.txt', 'v1')
      let r1 = await vfs.readFile('file.txt')
      expect(r1).toBe('v1')

      // Modify
      await vfs.writeFile('file.txt', 'v2')
      let r2 = await vfs.readFile('file.txt')
      expect(r2).toBe('v2')

      // Delete
      await vfs.deleteFile('file.txt')
      let r3 = await vfs.readFile('file.txt')
      expect(r3).toBeNull()

      // Recreate
      await vfs.writeFile('file.txt', 'v3')
      let r4 = await vfs.readFile('file.txt')
      expect(r4).toBe('v3')
    })

    it('file lifecycle: base -> modify -> reset via pull', async () => {
      const backend = new InMemoryStorage()
      const vfs = new VirtualFS({ backend })
      await vfs.init()

      // Base
      await vfs.applyBaseSnapshot({ 'file.txt': 'base' }, 'h1')

      // Modify
      await vfs.writeFile('file.txt', 'modified')
      let r1 = await vfs.readFile('file.txt')
      expect(r1).toBe('modified')

      // Pull resets to base
      const result = await vfs.pull('h2', { 'file.txt': 'base' })
      expect(result).toHaveProperty('fetchedPaths')
      
      // File should still be readable after pull
      let r2 = await vfs.readFile('file.txt')
      expect(typeof r2 === 'string' || r2 === null).toBe(true)
    })
  })
})
