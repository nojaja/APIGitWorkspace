import * as lib from '../../../src/index'

describe('VirtualFS full GitLab flow (pull, edit, delete, push)', () => {
  const remoteHead = '25a5767c9cd5d1fd235cf359c92dec1957369060'
  const expectedFetched = ['README.md','t1.txt','t2.txt','t3.txt','t4.txt','tt1.txt','tt2.txt']

  beforeEach(async () => {
    // ensure OPFS root exists via global test setup
    const root: any = await (global as any).navigator.storage.getDirectory()
    if (typeof root.getDirectoryHandle === 'function') await root.getDirectoryHandle('GitLab_test01', { create: true })
    else if (typeof root.getDirectory === 'function') await root.getDirectory('GitLab_test01', { create: true })
  })

  afterEach(async () => {
    try { if ((global as any).fetch && (global as any).fetch.mockRestore) (global as any).fetch.mockRestore() } catch (_) {}
    try { await lib.OpfsStorage.delete('GitLab_test01') } catch (_) {}
  })

  it('executes the scenario: pull -> write -> delete -> push', async () => {
    const treeJson = [
      { id: '9af29826d6e11847f0cff8a17b7403cfb9f5596c', name: 'README.md', type: 'blob', path: 'README.md' },
      { id: '7637868a7cd24c135fd62999ef36cfe2c5e8eb8b', name: 't1.txt', type: 'blob', path: 't1.txt' },
      { id: 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0', name: 't2.txt', type: 'blob', path: 't2.txt' },
      { id: 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0', name: 't3.txt', type: 'blob', path: 't3.txt' },
      { id: 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0', name: 't4.txt', type: 'blob', path: 't4.txt' },
      { id: 'd6d2f13a2ed121d421a912680d9174bca9e5d44b', name: 'tt1.txt', type: 'blob', path: 'tt1.txt' },
      { id: 'ee9808dcf8b9fc9326ce4d96ff74e478c3809447', name: 'tt2.txt', type: 'blob', path: 'tt2.txt' }
    ]

    const fileContents: Record<string,string> = {
      'README.md': '# test-repo\n',
      't1.txt': 'hello-hello-hello-hello',
      't2.txt': 'hello',
      't3.txt': 'hello',
      't4.txt': 'hello',
      'tt1.txt': 'bbbbbb',
      'tt2.txt': 'aaaaaa'
    }

    const fetchMock = jest.fn().mockImplementation(async (input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const make = (status:number, body:string, hdrs?:Record<string,string>) => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'ERR',
        headers: { get: (k:string) => (hdrs || {})[k.toLowerCase()] },
        text: async () => body,
        json: async () => JSON.parse(body),
        clone() { return this }
      })

      // branch HEAD
      if (url.endsWith('/repository/branches/main')) {
        return make(200, JSON.stringify({ name: 'main', commit: { id: remoteHead } }))
      }

      // tree
      if (url.includes('/repository/tree') && url.includes('ref=main')) {
        return make(200, JSON.stringify(treeJson))
      }

      // raw file
      if (url.includes('/repository/files/') && url.includes('/raw') && url.includes('ref=main')) {
        const m = url.match(/repository\/files\/(.+?)\/raw/) || []
        const enc = m[1] || ''
        const path = decodeURIComponent(enc)
        const content = fileContents[path] || ''
        return make(200, content, { 'content-type': 'text/plain' })
      }

      // commit POST
      if (url.endsWith('/repository/commits') && init && init.method === 'POST') {
        // return created commit id
        return make(201, JSON.stringify({ id: '0437a3a7ad2664deb12da00c5a4167e8c4455e6b', short_id: '0437a3a7' }))
      }

      return make(404, '')
    })

    ;(global as any).fetch = fetchMock

    // create backend and vfs
    const backend = new lib.OpfsStorage('GitLab_test01')
    const currentVfs = new lib.VirtualFS({ backend })
    await currentVfs.init()

    await currentVfs.setAdapter(null, { type: 'gitlab', opts: { projectId: 'root/test-repo', host: 'http://localhost:8929', token: 'aaaaa', branch: 'main' } })

    // initial pull
    const pullRes = await currentVfs.pull()
    expect(pullRes.fetchedPaths.sort()).toEqual(expectedFetched.sort())

    // listPaths contains expected files (order-insensitive)
    const pathsAfterPull = await currentVfs.listPaths()
    expect(pathsAfterPull.sort()).toEqual(expectedFetched.sort())

    // write new file t5.txt
    await currentVfs.writeFile('t5.txt', 'hello')
    const pathsAfterWrite = await currentVfs.listPaths()
    expect(pathsAfterWrite.sort()).toEqual(['t5.txt','tt2.txt','tt1.txt','t4.txt','t3.txt','t2.txt','t1.txt','README.md'].sort())

    const changes1 = await currentVfs.getChangeSet()
    expect(changes1).toEqual([{ type: 'create', path: 't5.txt', content: 'hello' }])

    // delete t4.txt
    await currentVfs.deleteFile('t4.txt')
    const pathsAfterDelete = await currentVfs.listPaths()
    expect(pathsAfterDelete.sort()).toEqual(['t5.txt','tt2.txt','tt1.txt','t3.txt','t2.txt','t1.txt','README.md'].sort())

    const changes2 = await currentVfs.getChangeSet()
    // expect delete entry first then create
    expect(changes2.find((c:any) => c.type === 'delete' && c.path === 't4.txt')).toBeTruthy()
    expect(changes2.find((c:any) => c.type === 'create' && c.path === 't5.txt' && c.content === 'hello')).toBeTruthy()

    // listFilesRaw from backend - verify exact expected URIs/paths
    const filesRaw = await backend.listFilesRaw()

    // define expected uri and path lists as consts (not generated at runtime)
    const expectedUris = [
      'GitLab_test01/.git/main/info/t3.txt',
      'GitLab_test01/.git/main/info/t4.txt',
      'GitLab_test01/.git/main/info/tt1.txt',
      'GitLab_test01/.git/main/info/tt2.txt',
      'GitLab_test01/index',
      'GitLab_test01/workspace/base/t5.txt',
      'GitLab_test01/workspace/info/t4.txt',
      'GitLab_test01/workspace/info/t5.txt',
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

    // For this test the expected paths equal expectedUris; define separately to assert both
    const expectedPaths = expectedUris.slice()

    // ensure every returned entry has uri === path
    expect(filesRaw.every((e:any) => e.uri === e.path)).toBe(true)

    // verify every expected uri exists in returned uris
    for (const exUri of expectedUris) {
      expect(filesRaw.some((f:any) => f.uri === exUri)).toBe(true)
    }

    // verify every expected path exists in returned paths
    for (const exPath of expectedPaths) {
      expect(filesRaw.some((f:any) => f.path === exPath)).toBe(true)
    }

    // additionally verify the returned set matches expected set (order-insensitive)
    const returnedPaths = filesRaw.map((f:any) => f.path).sort()
    expect(returnedPaths).toEqual(expectedPaths.slice().sort())

    // getIndex and head check
    const idx = await currentVfs.getIndex()
    expect(idx.head).toBe(remoteHead)
    expect(Object.keys(idx.entries)).toEqual(expect.arrayContaining(['README.md','t1.txt','t2.txt','t3.txt','t4.txt','tt1.txt','tt2.txt']))

    // prepare push input matching current change set
    const pushInput = { parentSha: remoteHead, message: 'Example push from UI', changes: changes2 }
    const pushRes = await currentVfs.push(pushInput as any)
    expect(pushRes.commitSha).toBe('0437a3a7ad2664deb12da00c5a4167e8c4455e6b')

    // after push, listPaths updates (order-insensitive)
    const afterPushPaths = await currentVfs.listPaths()
    expect(afterPushPaths.sort()).toEqual(['tt2.txt','tt1.txt','t5.txt','t3.txt','t2.txt','t1.txt','README.md'].sort())

    const finalChanges = await currentVfs.getChangeSet()
    expect(finalChanges).toEqual([])

    const rawAfterPush = await backend.listFilesRaw()
    // basic sanity: contains index and base/info for t5
    expect(rawAfterPush.some((r:any) => r.path && r.path.endsWith('/base/t5.txt'))).toBe(true)
    expect(rawAfterPush.some((r:any) => r.path && r.path.endsWith('/info/t5.txt'))).toBe(true)
  })
})
