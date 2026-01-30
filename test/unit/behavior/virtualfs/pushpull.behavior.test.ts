/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS pull/push', () => {
  it('pull updates base when workspace unchanged', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()
    // initial base
    await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
    // remote updated a.txt to v2
    const remote = { 'a.txt': 'v2' }
    const res = await vfs.pull('head2', remote)
    expect(res.conflicts.length).toBe(0)
    const idx = await vfs.getIndex()
    expect(idx.head).toBe('head2')
    const content = await vfs.readFile('a.txt')
    expect(content).toBe('v2')
  })

  it('pull reports conflict when workspace modified', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()
    await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
    // modify locally
    await vfs.writeFile('a.txt', 'local-mod')
    // remote updated
    const remote = { 'a.txt': 'v2' }
    const res = await vfs.pull('head2', remote)
    expect(res.conflicts.length).toBeGreaterThan(0)
  })

  it('push fails when head mismatched and succeeds otherwise', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()
    await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
    // make workspace change
    await vfs.writeFile('a.txt', 'v1-mod')
    const changes = await vfs.getChangeSet()

    // try push with wrong parent
    await expect(vfs.push({ message: 'm', parentSha: 'wrong', changes })).rejects.toThrow()

    // push with correct parent
    const result = await vfs.push({ message: 'm', parentSha: 'head1', changes })
    expect(result.commitSha).toBeDefined()
    const idx = await vfs.getIndex()
    expect(idx.head).toBe(result.commitSha)
    // workspace cleaned and base updated (readFile returns base blob)
    const w = await vfs.readFile('a.txt')
    expect(w).toBe('v1-mod')
  })
})
