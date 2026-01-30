/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { shaOf, shaOfGitBlob } from '../../../../src/virtualfs/hashUtils'

describe('hashUtils', () => {
  it('shaOf returns hex string', async () => {
    const h = await shaOf('hello')
    expect(typeof h).toBe('string')
    expect(h.length).toBeGreaterThan(0)
  })

  it('shaOfGitBlob differs from shaOf for same content', async () => {
    const a = await shaOf('x')
    const b = await shaOfGitBlob('x')
    expect(a).not.toBe(b)
    expect(b.length).toBeGreaterThan(0)
  })
})
