import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage'

let tmpDir: string
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apigit-ck-'))
})
afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch (e) { void e }
})

describe('commitKey injection and index metadata', () => {
  it('injects commitKey into GitHub-style commit message and records lastCommitKey', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage(tmpDir) })
    await vfs.init()
    await vfs.writeFile('x.txt', 'content-x')
    const changes = await vfs.getChangeSet()
    const parent = (await vfs.getIndex()).head

    let capturedMessage = ''
    const adapter = {
      createBlobs: async (_: any[]) => ({}),
      createTree: async (_: any[]) => 'trees',
      createCommit: async (message: string, _parent: string, _tree: string) => {
        capturedMessage = message
        return 'commit-gh'
      },
      updateRef: async () => {}
    }

    const res = await vfs.push({ parentSha: parent, message: 'm', changes }, adapter as any)
    expect(res.commitSha).toBe('commit-gh')
    // compute expected commitKey
    const expectedKey = crypto.createHash('sha1').update(parent + JSON.stringify(changes)).digest('hex')
    expect(capturedMessage).toContain('apigit-commit-key:' + expectedKey)
    expect((await vfs.getIndex()).lastCommitKey).toBe(expectedKey)
  })

  it('injects commitKey into GitLab actions commit message and records lastCommitKey', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage(tmpDir) })
    await vfs.init()
    await vfs.writeFile('y.txt', 'content-y')
    const changes = await vfs.getChangeSet()
    const parent = (await vfs.getIndex()).head

    let capturedMessage = ''
    const adapter = {
      createCommitWithActions: async (_branch: string, message: string, _changes: any[]) => {
        capturedMessage = message
        return 'commit-gl'
      },
      updateRef: async () => {}
    }

    const res = await vfs.push({ parentSha: parent, message: 'ml', changes, ref: 'main' }, adapter as any)
    expect(res.commitSha).toBe('commit-gl')
    const expectedKey = crypto.createHash('sha1').update(parent + JSON.stringify(changes)).digest('hex')
    expect(capturedMessage).toContain('apigit-commit-key:' + expectedKey)
    expect((await vfs.getIndex()).lastCommitKey).toBe(expectedKey)
  })
})
