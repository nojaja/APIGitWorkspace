import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import GitLabAdapter from '../../../src/git/gitlabAdapter'

beforeEach(() => {
  jest.clearAllMocks()
  // @ts-ignore
  global.fetch = undefined
})

describe('GitLabAdapter basic flows', () => {
  it('createBlobs returns map of path->sha', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't' })
    const changes = [
      { type: 'create', path: 'a.txt', content: 'a' },
      { type: 'update', path: 'b.txt', content: 'b' },
    ]

    const map = await adapter.createBlobs(changes)
    expect(map['a.txt']).toBeDefined()
    expect(map['b.txt']).toBeDefined()
  })

  it('createTree returns marker string', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't' })
    const marker = await adapter.createTree([{ type: 'create', path: 'x', content: 'x' }])
    expect(typeof marker).toBe('string')
    expect(marker.startsWith('gitlab-tree-')).toBe(true)
  })

  it('createCommit uses pending actions and returns id from API', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't' })
    // createTree will set pendingActions
    await adapter.createTree([{ type: 'create', path: 'f', content: 'c' }])

    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: true, /**
     *
     */
    text: async () => JSON.stringify({ id: 'cid' }), /**
     *
     */
    json: async () => ({ id: 'cid' }) })
    // @ts-ignore
    global.fetch = fetchMock

    const res = await adapter.createCommit('msg', 'parent', 'treesha')
    expect(res).toBe('cid')
    expect(fetchMock).toHaveBeenCalled()
  })

  it('createCommitWithActions throws on invalid JSON', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't' })
    const fetchMock = jest.fn()
    fetchMock.mockResolvedValue({ ok: true, /**
     *
     */
    text: async () => 'not-json' })
    // @ts-ignore
    global.fetch = fetchMock

    await expect(adapter.createCommitWithActions('main', 'm', [{ type: 'create', path: 'a', content: 'c' }])).rejects.toThrow()
  })

  it('updateRef is noop and does not throw', async () => {
    const adapter = new GitLabAdapter({ projectId: '1', token: 't' })
    await expect(adapter.updateRef('heads/main', 'sha')).resolves.toBeUndefined()
  })
})
