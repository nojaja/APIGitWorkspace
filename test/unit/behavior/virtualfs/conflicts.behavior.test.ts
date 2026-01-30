/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'

let tmpDir: string
beforeEach(async () => {
  jest.clearAllMocks()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apigit-test-'))
})
afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch (e) {
    console.warn('一時ディレクトリ削除で警告:', e)
  }
})

describe('VirtualFS conflict flows', () => {
  it('reports conflict when remote has new file but workspace has uncommitted changes', async () => {
    const storage = new InMemoryStorage(tmpDir)
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    // local workspace has file not present in index
    await vfs.writeFile('c.txt', 'local-c')

    // remote snapshot contains c.txt
    const baseSnapshot: Record<string, string> = { 'c.txt': 'remote-c' }
    const res = await vfs.pull('remote-head', baseSnapshot)

    expect(res.conflicts.length).toBeGreaterThanOrEqual(1)
    const found = res.conflicts.find((x: any) => x.path === 'c.txt')
    if (!found) throw new Error('c.txt の衝突エントリが見つかりません')
    expect(found.workspaceSha).toBeDefined()
    expect(found.remoteSha).toBeDefined()
  })

  it('reports conflict when remote changed and workspace modified', async () => {
    const storage = new InMemoryStorage(tmpDir)
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    // apply base snapshot (initial)
    const initialSnapshot = { 'd.txt': 'initial' }
    await vfs.applyBaseSnapshot(initialSnapshot, 'h1')

    // local modify
    await vfs.writeFile('d.txt', 'local-edit')

    // remote changed
    const remoteSnapshot = { 'd.txt': 'remote-edit' }
    const res = await vfs.pull('h2', remoteSnapshot)

    expect(res.conflicts.length).toBeGreaterThanOrEqual(1)
    const found = res.conflicts.find((x: any) => x.path === 'd.txt')
    if (!found) throw new Error('d.txt の衝突エントリが見つかりません')
    expect(found.baseSha).toBeDefined()
    expect(found.remoteSha).toBeDefined()
    expect(found.workspaceSha).toBeDefined()
  })

  it('reports conflict when remote deleted and workspace modified', async () => {
    const storage = new InMemoryStorage(tmpDir)
    const vfs = new VirtualFS({ backend: storage })
    await vfs.init()

    // apply base snapshot
    const initialSnapshot = { 'e.txt': 'orig' }
    await vfs.applyBaseSnapshot(initialSnapshot, 'h1')

    // modify locally
    await vfs.writeFile('e.txt', 'local')

    // remote snapshot excludes e.txt (deleted)
    const remoteSnapshot: Record<string, string> = {}
    const res = await vfs.pull('h2', remoteSnapshot)

    expect(res.conflicts.length).toBeGreaterThanOrEqual(1)
    const found = res.conflicts.find((x: any) => x.path === 'e.txt')
    if (!found) throw new Error('e.txt の衝突エントリが見つかりません')
    expect(found.baseSha).toBeDefined()
    expect(found.workspaceSha).toBeDefined()
  })
})
