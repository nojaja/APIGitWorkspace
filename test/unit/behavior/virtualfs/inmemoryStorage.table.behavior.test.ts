/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import InMemoryStorage from '../../../../src/virtualfs/inmemoryStorage'

async function computeSha(content: string) {
  const enc = new TextEncoder()
  const data = enc.encode(content)
  const buf = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('InMemoryStorage - table-driven branch tests', () => {
  it.each([
    { name: 'workspace default', seg: undefined, path: 'w.txt', content: 'hello', expectState: 'added', expectSegment: 'workspace' },
    { name: 'base segment', seg: 'base', path: 'b.txt', content: 'basecontent', expectState: 'base', expectSegment: 'base' },
    { name: 'conflict segment', seg: 'conflict', path: 'c.txt', content: 'conflictcontent', expectState: 'conflict', expectSegment: 'conflict' },
    { name: 'info segment (raw JSON)', seg: 'info', path: 'i.json', content: JSON.stringify({ meta: 1 }), expectState: null, expectSegment: 'info' }
  ])('$name', async ({ seg, path, content, expectState, expectSegment }) => {
    const root = `testroot_${Math.random().toString(36).slice(2)}`
    const s1 = new InMemoryStorage(root)

    // call writeBlob with/without segment
    if (seg === undefined) await s1.writeBlob(path, content)
    else await s1.writeBlob(path, content, seg)

    // verify blob presence in the expected segment
    const got = await s1.readBlob(path, expectSegment)
    expect(got).not.toBeNull()
    expect(got).toBe(content)

    // readIndex and inspect metadata when appropriate
    const idx = await s1.readIndex()
    const entry = idx?.entries[path]
    if (seg === 'info') {
      // content was raw JSON stored in info; readIndex should parse it
      expect(entry).toEqual({ meta: 1 })
    } else {
      expect(entry).toBeDefined()
      if (expectState) expect(entry.state).toBe(expectState)
      // the sha stored should match computed sha
      const expectedSha = await computeSha(content)
      if (expectState === 'added' || expectState === 'modified') expect(entry.workspaceSha).toBe(expectedSha)
      if (expectState === 'base') expect(entry.baseSha).toBe(expectedSha)
    }
  })

  it('constructor shares store when same directory provided', async () => {
    const root = `shared_${Math.random().toString(36).slice(2)}`
    const a = new InMemoryStorage(root)
    const b = new InMemoryStorage(root)
    await a.writeBlob('shared.txt', 'x')
    const got = await b.readBlob('shared.txt')
    expect(got).toBe('x')
  })

  it.each([
    { name: 'delete specific segment', setup: ['ws','base'], delSeg: 'workspace' },
    { name: 'delete all segments', setup: ['ws','base','conflict','info'], delSeg: undefined }
  ])('$name', async ({ setup, delSeg }) => {
    const root = `del_${Math.random().toString(36).slice(2)}`
    const s = new InMemoryStorage(root)
    // populate segments
    await s.writeBlob('f1.txt', 'w', 'workspace')
    await s.writeBlob('f1.txt', 'B', 'base')
    await s.writeBlob('f1.txt', 'C', 'conflict')
    await s.writeBlob('f1.txt', JSON.stringify({x:1}), 'info')

    if (delSeg) await s.deleteBlob('f1.txt', delSeg)
    else await s.deleteBlob('f1.txt')

    const w = await s.readBlob('f1.txt','workspace')
    const b = await s.readBlob('f1.txt','base')
    const c = await s.readBlob('f1.txt','conflict')
    const i = await s.readBlob('f1.txt','info')

    if (delSeg === 'workspace') {
      expect(w).toBeNull()
      // other segments should remain
      expect(b).toBe('B')
      expect(c).toBe('C')
      expect(i).toBe(JSON.stringify({x:1}))
    } else {
      // all deleted
      expect(w).toBeNull()
      expect(b).toBeNull()
      expect(c).toBeNull()
      expect(i).toBeNull()
    }
  })

  it('readBlob with invalid segment returns null', async () => {
    const s = new InMemoryStorage()
    await s.writeBlob('x','v','workspace')
    const got = await s.readBlob('x','nonesuch')
    expect(got).toBeNull()
  })

  it('listFiles respects prefix normalization and non-recursive flag', async () => {
    const root = `list_${Math.random().toString(36).slice(2)}`
    const s = new InMemoryStorage(root)
    await s.writeBlob('a','1','workspace')
    await s.writeBlob('a/b','2','workspace')
    await s.writeBlob('a/b/c','3','workspace')
    await s.writeBlob('d','9','workspace')

    const allRec = await s.listFiles('a','workspace', true)
    const nonRec = await s.listFiles('/a/','workspace', false)
    expect(allRec.map((r) => r.path).sort()).toEqual(['a','a/b','a/b/c'].sort())
    // nonRec should include only 'a' and 'a/b' (immediate children)
    expect(nonRec.map((r) => r.path).sort()).toEqual(['a','a/b'].sort())
  })

  it('writeBlob with unknown segment throws', async () => {
    const s = new InMemoryStorage()
    await expect(s.writeBlob('z','v','unknown')).rejects.toThrow('unknown segment')
  })

})

export {}
