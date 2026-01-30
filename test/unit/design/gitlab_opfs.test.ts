import * as lib from '../../../src/index'

describe('OpfsStorage + GitLab pull', () => {
  const expectedFiles = ['README.md', 't1.txt', 't2.txt', 't3.txt', 't4.txt', 'tt1.txt', 'tt2.txt']

  beforeEach(async () => {
    // ensure OPFS root exists for test
    const nav: any = (global as any).navigator
    const root = await nav.storage.getDirectory()
    await root.getDirectoryHandle('GitLab_test01', { create: true })
  })

  afterEach(async () => {
    // restore fetch mock if any
    try { if ((global as any).fetch && (global as any).fetch.mockRestore) (global as any).fetch.mockRestore() } catch (_) {}
    // cleanup created opfs root (best-effort)
    try { await lib.OpfsStorage.delete('GitLab_test01') } catch (_) {}
  })

  it('pulls from GitLab and backend reflects the same paths (listPaths & listFilesRaw)', async () => {
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
        // extract path from URL between /repository/files/ and /raw
        const m = url.match(/repository\/files\/(.+?)\/raw/) || url.match(/repository\/files\/(.+?)\?raw/)
        let encPath = m && m[1] ? m[1] : ''
        // decodeURIComponent safe replace for encoded slashes
        const path = decodeURIComponent(encPath)
        const content = fileContents[path] || ''
        return makeResponse(200, content, { 'content-type': 'text/plain' })
      }

      return makeResponse(404, '')
    })

    ;(global as any).fetch = fetchMock

    // create backend and vfs, init and set adapter meta
    const backend = new lib.OpfsStorage('GitLab_test01')
    const currentVfs = new lib.VirtualFS({ backend })
    await currentVfs.init()

    await currentVfs.setAdapter(null, { type: 'gitlab', opts: { projectId: 'root/test-repo', host: 'http://localhost:8929', token: 'aaaaaaaaa', branch: 'main' } })

    const res = await currentVfs.pull()

    // verify listPaths contains same set of files
    const paths = await currentVfs.listPaths()
    expect(paths.sort()).toEqual(expectedFiles.sort())

    // verify backend.listFilesRaw contains base and info entries for each file and index
    const filesRaw = await backend.listFilesRaw()

    // must include index
    const hasIndex = filesRaw.some((f) => f.path && f.path.includes('/index'))
    expect(hasIndex).toBe(true)

    // Expected raw URIs/paths (use const values defined here)
    const expectedRaw = [
      'GitLab_test01/index',
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

    // All entries should have uri === path
    expect(filesRaw.every((e) => e.uri === e.path)).toBe(true)

    // The set of paths returned should match the expected const list
    const returnedPaths = filesRaw.map((f) => f.path).sort()
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
