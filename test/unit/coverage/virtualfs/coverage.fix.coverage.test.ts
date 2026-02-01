/**
 * @test-type coverage
 * @purpose Coverage expansion only
 * @policy MODIFICATION ALLOWED
 */

import { jest } from '@jest/globals'
import VirtualFS from '../../../../src/virtualfs/virtualfs'
import { InMemoryStorage } from '../../../../src/virtualfs/inmemoryStorage'

describe('coverage fix: VirtualFS push cleanup', () => {
  it('applies create/update/delete and removes workspace blobs', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()

    // set head so push pre-checks pass
    const idx = await vfs.getIndex()
    idx.head = 'parent'

    const input: any = {
      parentSha: 'parent',
      message: 'msg',
      changes: [
        { type: 'create', path: 'a.txt', content: 'x' },
        { type: 'update', path: 'b.txt', content: 'y', baseSha: 'old' },
        { type: 'delete', path: 'c.txt', baseSha: 'b' },
      ],
    }

    const res = await vfs.push(input)
    expect(res).toBeDefined()
    expect(res.commitSha).toBeTruthy()

    // .git-base should contain new content
    expect(await vfs.readFile('a.txt')).toBe('x')
    expect(await vfs.readFile('b.txt')).toBe('y')

    // workspace blobs should be removed
    const backend: any = (vfs as any).backend
    expect(await backend.readBlob('a.txt','workspace')).toBeNull()
    expect(await backend.readBlob('b.txt','workspace')).toBeNull()
    expect(await backend.readBlob('c.txt','workspace')).toBeNull()
  })
})
