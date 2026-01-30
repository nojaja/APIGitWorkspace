/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage - table-driven tests', () => {
  const cases = [
    {
      name: 'write-and-read-workspace',
      ops: async (s: any) => {
        await s.writeBlob('foo.txt', 'hello')
        const r = await s.readBlob('foo.txt')
        return r
      },
      expected: 'hello'
    },
    {
      name: 'write-base-and-read-segment',
      ops: async (s: any) => {
        await s.writeBlob('base.txt', 'basecontent', 'base')
        const r = await s.readBlob('base.txt', 'base')
        return r
      },
      expected: 'basecontent'
    },
    {
      name: 'delete-workspace-only',
      ops: async (s: any) => {
        await s.writeBlob('mix.txt', 'workspace', 'workspace')
        await s.writeBlob('mix.txt', 'baseval', 'base')
        await s.deleteBlob('mix.txt', 'workspace')
        const w = await s.readBlob('mix.txt')
        const b = await s.readBlob('mix.txt', 'base')
        return { w, b }
      },
      expected: { w: 'baseval', b: 'baseval' }
    },
    {
      name: 'listfiles-prefix-nonrecursive',
      ops: async (s: any) => {
        await s.writeBlob('dir/a.txt', 'a')
        await s.writeBlob('dir/sub/b.txt', 'b')
        const all = await s.listFiles('dir', 'workspace', false)
        return all.map((x: any) => x.path).sort()
      },
      expected: ['dir/a.txt']
    }
  ]

  test.each(cases)('$name', async (tc) => {
    const storeName = `testroot_${Math.random().toString(36).slice(2)}`
    const s = new (InMemoryStorage as any)(storeName)
    await s.init()
    const res = await tc.ops(s)
    expect(res).toEqual(tc.expected)
  })
})
import { jest } from '@jest/globals'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('InMemoryStorage - table-driven cases', () => {
  beforeEach(() => {
    // use a deterministic root name per test to isolate stores
    try { InMemoryStorage.delete('td-root') } catch (_) {}
  })

  it.each([
    {
      name: 'unknown segment write rejects',
      op: 'write',
      seg: 'unknown',
      key: 'u.txt',
      val: 'x',
      expectReject: true
    },
    {
      name: 'info segment write and read preserves raw string/json',
      op: 'info-roundtrip',
      seg: 'info',
      key: 'meta.json',
      val: JSON.stringify({ a: 1 }),
      expectRead: JSON.stringify({ a: 1 })
    },
    {
      name: 'delete without segment removes from all segments',
      op: 'delete-all',
      key: 'common.txt',
      prepare: true
    }
  ])('$name', async (tc) => {
    const s = new InMemoryStorage('td-root')
    if (tc.prepare) {
      // write to multiple segments
      await s.writeBlob(tc.key, 'wdata', 'workspace')
      await s.writeBlob(tc.key, 'bdata', 'base')
      await s.writeBlob(tc.key, 'cdata', 'conflict')
      await s.writeBlob(tc.key, JSON.stringify({ info: true }), 'info')
    }

    if (tc.op === 'write') {
      await expect(s.writeBlob(tc.key, tc.val, tc.seg as any)).rejects.toThrow()
      return
    }

    if (tc.op === 'info-roundtrip') {
      await s.writeBlob(tc.key, tc.val, 'info')
      const got = await s.readBlob(tc.key, 'info')
      expect(got).toBe(tc.expectRead)
      return
    }

    if (tc.op === 'delete-all') {
      // delete without segment should remove from all segments
      await s.deleteBlob(tc.key)
      expect(await s.readBlob(tc.key, 'workspace')).toBeNull()
      expect(await s.readBlob(tc.key, 'base')).toBeNull()
      expect(await s.readBlob(tc.key, 'conflict')).toBeNull()
      expect(await s.readBlob(tc.key, 'info')).toBeNull()
      return
    }
  })
})
