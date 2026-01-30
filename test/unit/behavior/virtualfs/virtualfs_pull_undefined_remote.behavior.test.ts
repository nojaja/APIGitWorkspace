/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { VirtualFS } from '../../../../src'
import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

describe('VirtualFS.pull with undefined remote', () => {
  it('falls back to baseSnapshot normalization when adapter absent', async () => {
    const backend = new InMemoryStorage()
    const vfs = new VirtualFS({ backend })
    await vfs.init()
    const baseSnapshot = { 'foo.txt': 'hello', 'dir/bar.txt': 'x' }
    const res = await vfs.pull(undefined as any, baseSnapshot)
    expect(res).toBeDefined()
    const remote = (res as any).remote
    expect(remote).toBeDefined()
    const remotePaths = (res as any).remotePaths
    expect(Array.isArray(remotePaths)).toBeTruthy()
    expect(remotePaths.sort()).toEqual(Object.keys(baseSnapshot).sort())
  })
})
