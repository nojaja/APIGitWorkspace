import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS classify & base read flows', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => jest.resetAllMocks())

  it('_readBaseContent reads from backend and caches result', async () => {
    const storage = new InMemoryStorage()
    const v = new VirtualFS({ backend: storage })
    // no init required for this test
    await storage.writeBlob('p.txt', 'hello', 'base')
    const got = await (v as any)._readBaseContent('p.txt')
    expect(got).toBe('hello')
    const cached = (v as any).base.get('p.txt')
    expect(cached).toBeDefined()
    expect(cached.content).toBe('hello')
  })

  it('_classifyRemotePathForPull reconciles when base content matches git blob sha', async () => {
    const storage = new InMemoryStorage()
    const v = new VirtualFS({ backend: storage })
    // prepare base blob content and compute git blob sha
    const content = 'payload'
    await storage.writeBlob('r.txt', content, 'base');
    // create an index entry with different baseSha
    (await v.getIndex()).entries['r.txt'] = { path: 'r.txt', baseSha: 'old', state: 'base' }

    // compute git blob sha via internal helper
    const gitSha = await (v as any).shaOfGitBlob(content)

    const normalized = { headSha: 'h', shas: {}, fetchContent: async (_: string[]) => ({}) }
    const pathsToFetch: string[] = []
    const reconciled: string[] = []

    const res = await (v as any)._classifyRemotePathForPull('r.txt', gitSha, normalized, pathsToFetch, reconciled)
    expect(res).toBe(true)
    // index entry should have been updated to new sha
    const ie = (await v.getIndex()).entries['r.txt']
    expect(ie.baseSha).toBe(gitSha)
    expect(reconciled).toContain('r.txt')
  })
})
