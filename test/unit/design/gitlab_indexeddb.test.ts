import * as lib from '../../../src/index'

describe('IndexedDatabaseStorage + GitLab pull', () => {
  const expectedFiles = ['README.md', 't1.txt', 't2.txt', 't3.txt', 't4.txt', 'tt1.txt', 'tt2.txt']

  beforeEach(async () => {
    // ensure a clean IndexedDB for test (best-effort)
    try { await lib.IndexedDatabaseStorage.delete('GitLab_test01') } catch (_) {}
  })

  afterEach(async () => {
    // restore fetch mock if any
    try { if ((global as any).fetch && (global as any).fetch.mockRestore) (global as any).fetch.mockRestore() } catch (_) {}
    // cleanup created indexeddb (best-effort)
    try { await lib.IndexedDatabaseStorage.delete('GitLab_test01') } catch (_) {}
  })

  it('pulls from GitLab and backend reflects the same paths (listPaths & listFilesRaw by path)', async () => {
    // mock fetch to simulate GitLab API
    const branchJson = { name: 'main', commit: { id: '25a5767c9cd5d1fd235cf359c92dec1957369060' } }

    const treeJson = [
      { id: '9af29826', name: 'README.md', type: 'blob', path: 'README.md' },
      { id: '7637868a', name: 't1.txt', type: 'blob', path: 't1.txt' },
      { id: 'b6fc4c62', name: 't2.txt', type: 'blob', path: 't2.txt' },
      { id: 'b6fc4c62', name: 't3.txt', type: 'blob', path: 't3.txt' },
      { id: 'b6fc4c62', name: 't4.txt', type: 'blob', path: 't4.txt' },
      { id: 'd6d2f13a', name: 'tt1.txt', type: 'blob', path: 'tt1.txt' },
      { id: 'ee9808dc', name: 'tt2.txt', type: 'blob', path: 'tt2.txt' }
    ]

    const fileContents: Record<string, string> = {}
    for (const f of treeJson) fileContents[f.path] = `contents of ${f.path}`

    const fetchMock = jest.fn().mockImplementation(async (input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const headers = { 'content-type': 'application/json' }

      const makeResponse = (status: number, body: string, hdrs?: Record<string,string>) => {
        const r: any = {
          ok: status >= 200 && status < 300,
          status,
          statusText: status === 200 ? 'OK' : 'ERR',
          headers: { get: (k: string) => (hdrs || headers)[k.toLowerCase()] },
          text: async () => body,
          json: async () => JSON.parse(body),
          clone: function () { return this }
        }
        return r
      }

      if (url.includes('/repository/branches/') && url.includes('/repository/branches/main')) {
        return makeResponse(200, JSON.stringify(branchJson))
      }
      if (url.includes('/repository/tree') && url.includes('ref=main')) {
        return makeResponse(200, JSON.stringify(treeJson))
      }
      if (url.includes('/repository/files/') && url.includes('/raw') && url.includes('ref=main')) {
        const m = url.match(/repository\/files\/(.+?)\/raw/) || url.match(/repository\/files\/(.+?)\?raw/)
        let encPath = m && m[1] ? m[1] : ''
        const path = decodeURIComponent(encPath)
        const content = fileContents[path] || ''
        return makeResponse(200, content, { 'content-type': 'text/plain' })
      }

      return makeResponse(404, '')
    })

    ;(global as any).fetch = fetchMock

    // create backend and vfs, init and set adapter meta
    const backend = new lib.IndexedDatabaseStorage('GitLab_test01')
    const currentVfs = new lib.VirtualFS({ backend })
    await currentVfs.init()

    await currentVfs.setAdapter(null, { type: 'gitlab', opts: { projectId: 'root/test-repo', host: 'http://localhost:8929', token: 'aaaaaaaaa', branch: 'main' } })

    const res = await currentVfs.pull()

    // verify listPaths contains same set of files
    const paths = await currentVfs.listPaths()
    expect(paths.sort()).toEqual(expectedFiles.sort())

    // verify backend.listFilesRaw contains base and info entries for each file and index
    const filesRaw = await backend.listFilesRaw()

    // Expected raw paths (use const values defined here; index is not included for IndexedDB)
    const expectedRaw = [
      'GitLab_test01/.git/main/info/tt2.txt',
      'GitLab_test01/.git/main/info/tt1.txt',
      'GitLab_test01/.git/main/info/t4.txt',
      'GitLab_test01/.git/main/info/t3.txt',
      'GitLab_test01/.git/main/info/t2.txt',
      'GitLab_test01/.git/main/info/t1.txt',
      'GitLab_test01/.git/main/info/README.md',
      'GitLab_test01/.git/main/base/tt2.txt',
      'GitLab_test01/.git/main/base/tt1.txt',
      'GitLab_test01/.git/main/base/t4.txt',
      'GitLab_test01/.git/main/base/t3.txt',
      'GitLab_test01/.git/main/base/t2.txt',
      'GitLab_test01/.git/main/base/t1.txt',
      'GitLab_test01/.git/main/base/README.md'
    ]

    // The set of paths returned should match the expected const list (compare by path only)
    const returnedPaths = Array.from(new Set(filesRaw.map((f) => f.path))).sort()
    expect(returnedPaths).toEqual(expectedRaw.slice().sort())

    // Additionally ensure for each expected file there exist base/info as earlier
    for (const name of expectedFiles) {
      const hasBase = filesRaw.some((f) => f.path && f.path.endsWith(`/base/${name}`))
      const hasInfo = filesRaw.some((f) => f.path && f.path.endsWith(`/info/${name}`))
      expect(hasBase).toBe(true)
      expect(hasInfo).toBe(true)
    }
  })
})
import * as lib from '../../../src/index'

describe('IndexedDatabaseStorage + GitLab pull', () => {
  const expectedFiles = ['README.md', 't1.txt', 't2.txt', 't3.txt', 't4.txt', 'tt1.txt', 'tt2.txt']

  beforeEach(async () => {
    // Ensure IndexedDB root exists for test
    // IndexedDatabaseStorage.availableRoots relies on IndexedDB being present via setupIndexedDB.js
    // Create a storage instance to ensure DB is created
    const db = new lib.IndexedDatabaseStorage('GitLab_test01')
    await db.init()
  })

  afterEach(async () => {
    // restore fetch mock if any
    try { if ((global as any).fetch && (global as any).fetch.mockRestore) (global as any).fetch.mockRestore() } catch (_) {}
    // cleanup created indexeddb (best-effort)
    try { await lib.IndexedDatabaseStorage.delete('GitLab_test01') } catch (_) {}
  })

  it('pulls from GitLab and backend reflects the same paths and expected URIs', async () => {
    // mock fetch to simulate GitLab API (reuse same behavior as other test)
    const branchJson = { name: 'main', commit: { id: '25a5767c9cd5d1fd235cf359c92dec1957369060' } }
    const treeJson = [
      { id: '9af29826', name: 'README.md', type: 'blob', path: 'README.md' },
      { id: '7637868a', name: 't1.txt', type: 'blob', path: 't1.txt' },
      { id: 'b6fc4c62', name: 't2.txt', type: 'blob', path: 't2.txt' },
      { id: 'b6fc4c62', name: 't3.txt', type: 'blob', path: 't3.txt' },
      { id: 'b6fc4c62', name: 't4.txt', type: 'blob', path: 't4.txt' },
      { id: 'd6d2f13a', name: 'tt1.txt', type: 'blob', path: 'tt1.txt' },
      { id: 'ee9808dc', name: 'tt2.txt', type: 'blob', path: 'tt2.txt' }
    ]
    const fileContents: Record<string, string> = {}
    for (const f of treeJson) fileContents[f.path] = `contents of ${f.path}`

    const fetchMock = jest.fn().mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const makeResponse = (status: number, body: string, hdrs?: Record<string,string>) => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'ERR',
        headers: { get: (k: string) => (hdrs || {})[k.toLowerCase()] },
        text: async () => body,
        json: async () => JSON.parse(body),
        clone: function () { return this }
      })

      if (url.includes('/repository/branches/') && url.includes('/repository/branches/main')) return makeResponse(200, JSON.stringify(branchJson))
      if (url.includes('/repository/tree') && url.includes('ref=main')) return makeResponse(200, JSON.stringify(treeJson))
      if (url.includes('/repository/files/') && url.includes('/raw') && url.includes('ref=main')) {
        const m = url.match(/repository\/files\/(.+?)\/raw/) || url.match(/repository\/files\/(.+?)\?raw/)
        const encPath = m && m[1] ? m[1] : ''
        const path = decodeURIComponent(encPath)
        const content = fileContents[path] || ''
        return makeResponse(200, content, { 'content-type': 'text/plain' })
      }
      return makeResponse(404, '')
    })
    ;(global as any).fetch = fetchMock

    // create backend and vfs
    const backend = new lib.IndexedDatabaseStorage('GitLab_test01')
    const currentVfs = new lib.VirtualFS({ backend })
    await currentVfs.init()
    await currentVfs.setAdapter(null, { type: 'gitlab', opts: { projectId: 'root/test-repo', host: 'http://localhost:8929', token: 'aaaaaaaaa', branch: 'main' } })

    await currentVfs.pull()

    const paths = await currentVfs.listPaths()
    expect(paths.sort()).toEqual(expectedFiles.sort())

    const filesRaw = await backend.listFilesRaw()

    // Expected URIs (from provided log)
    const expectedUris = [
      'GitLab_test01/git-base/main::README.md',
      'GitLab_test01/git-base/main::t1.txt',
      'GitLab_test01/git-base/main::t2.txt',
      'GitLab_test01/git-base/main::t3.txt',
      'GitLab_test01/git-base/main::t4.txt',
      'GitLab_test01/git-base/main::tt1.txt',
      'GitLab_test01/git-base/main::tt2.txt',
      'GitLab_test01/git-info/README.md',
      'GitLab_test01/git-info/main::README.md',
      'GitLab_test01/git-info/main::t1.txt',
      'GitLab_test01/git-info/main::t2.txt',
      'GitLab_test01/git-info/main::t3.txt',
      'GitLab_test01/git-info/main::t4.txt',
      'GitLab_test01/git-info/main::tt1.txt',
      'GitLab_test01/git-info/main::tt2.txt',
      'GitLab_test01/git-info/t1.txt',
      'GitLab_test01/git-info/t2.txt',
      'GitLab_test01/git-info/t3.txt',
      'GitLab_test01/git-info/t4.txt',
      'GitLab_test01/git-info/tt1.txt',
      'GitLab_test01/git-info/tt2.txt'
    ]

    const expectedPaths = [
      'GitLab_test01/.git/main/base/README.md',
      'GitLab_test01/.git/main/base/t1.txt',
      'GitLab_test01/.git/main/base/t2.txt',
      'GitLab_test01/.git/main/base/t3.txt',
      'GitLab_test01/.git/main/base/t4.txt',
      'GitLab_test01/.git/main/base/tt1.txt',
      'GitLab_test01/.git/main/base/tt2.txt',
      'GitLab_test01/.git/main/info/README.md',
      'GitLab_test01/.git/main/info/README.md',
      'GitLab_test01/.git/main/info/t1.txt',
      'GitLab_test01/.git/main/info/t2.txt',
      'GitLab_test01/.git/main/info/t3.txt',
      'GitLab_test01/.git/main/info/t4.txt',
      'GitLab_test01/.git/main/info/tt1.txt',
      'GitLab_test01/.git/main/info/tt2.txt',
      'GitLab_test01/.git/main/info/t1.txt',
      'GitLab_test01/.git/main/info/t2.txt',
      'GitLab_test01/.git/main/info/t3.txt',
      'GitLab_test01/.git/main/info/t4.txt',
      'GitLab_test01/.git/main/info/tt1.txt',
      'GitLab_test01/.git/main/info/tt2.txt'
    ]

    // uri values must equal expected URIs (as provided)
    const returnedUris = filesRaw.map((f) => f.uri).sort()
    expect(returnedUris).toEqual(expectedUris.slice().sort())

    // path values must equal expected paths
    const returnedPaths = filesRaw.map((f) => f.path).sort()
    expect(returnedPaths).toEqual(expectedPaths.slice().sort())

    // ensure for each logical repo file there exist base/info entries
    for (const name of expectedFiles) {
      const hasBase = filesRaw.some((f) => f.path && f.path.endsWith(`/base/${name}`))
      const hasInfo = filesRaw.some((f) => f.path && f.path.endsWith(`/info/${name}`))
      expect(hasBase).toBe(true)
      expect(hasInfo).toBe(true)
    }
  })
})
