/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import OpfsStorage from '../../../../src/virtualfs/opfsStorage'

describe('OpfsStorage private helpers', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => jest.resetAllMocks())

  it('ensureDir succeeds with getDirectoryHandle API', async () => {
    const root: any = {}
    root.getDirectoryHandle = jest.fn(async (p: string) => root)
    const res = await (OpfsStorage.prototype as any).ensureDir(root, ['a', 'b', 'c'])
    expect(res).toBe(root)
  })

  it('ensureDir throws when dir API missing', async () => {
    const root: any = {}
    await expect((OpfsStorage.prototype as any).ensureDir(root, ['x'])).rejects.toThrow('OPFS directory API not available')
  })

  it('tryRemoveFileHandle returns true when file handle has remove and false when not', async () => {
    const dirWithRemove: any = { getFileHandle: jest.fn(async () => ({ remove: jest.fn(async () => true) })) }
    const ok = await (OpfsStorage.prototype as any).tryRemoveFileHandle(dirWithRemove, 'n')
    expect(ok).toBe(true)

    const dirThrow: any = { getFileHandle: jest.fn(async () => { throw new Error('nope') }) }
    const nok = await (OpfsStorage.prototype as any).tryRemoveFileHandle(dirThrow, 'n')
    expect(nok).toBe(false)
  })
})
