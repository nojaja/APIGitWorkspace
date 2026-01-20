import { describe, it, expect } from '@jest/globals'
import VirtualFS from '../../../src/virtualfs/virtualfs'
import InMemoryStorage from '../helpers/inmemoryStorage'

describe('renameWorkspace helper', () => {
  it('renames a base file to new path producing create+delete change set', async () => {
    const vfs = new VirtualFS({ backend: new InMemoryStorage() })
    await vfs.init()
    // apply base snapshot
    await vfs.applyBaseSnapshot({ 'c.txt': 'content-c' }, 'h1')

    await vfs.renameWorkspace('c.txt', 'd.txt')

    const changes = await vfs.getChangeSet()
    const hasCreate = changes.find((c: any) => c.type === 'create' && c.path === 'd.txt')
    const hasDelete = changes.find((c: any) => c.type === 'delete' && c.path === 'c.txt')
    expect(hasCreate).toBeDefined()
    expect(hasDelete).toBeDefined()
  })
})
