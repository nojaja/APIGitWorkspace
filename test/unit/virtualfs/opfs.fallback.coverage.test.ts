import { jest } from '@jest/globals'
import OpfsStorage from '../../../src/virtualfs/opfsStorage'

function makeHierRoot() {
  const files = new Map<string, string>()

  function makeDir(path: string, structure: any): any {
    const dir: any = {}
    dir.getDirectoryHandle = async (name: string) => {
      if (!structure[name]) throw new Error('no dir')
      return makeDir(path + '/' + name, structure[name])
    }
    dir.getDirectory = dir.getDirectoryHandle
    dir.getFileHandle = async (name: string) => {
      const f = structure[name]
      if (typeof f === 'string') {
        return {
          getFile: async () => ({ text: async () => f }),
          createWritable: async () => ({ write: async (c: string) => { structure[name] = c }, close: async () => {} })
        }
      }
      // return undefined when not a file
      return undefined
    }
    dir.removeEntry = async (name: string) => { delete structure[name] }
    dir.entries = async function* () { throw new Error('entries not supported') }
    dir.keys = async function* () { for (const k of Object.keys(structure)) yield k }
    return dir
  }

  // create root -> apigit_storage -> workspace
  const workspaceStruct: any = { 'foo.txt': 'vfoo', 'sub': { 'bar.txt': 'vbar' } }
  const rootStruct: any = { 'apigit_storage': { 'workspace': workspaceStruct } }
  const root = makeDir('', rootStruct)
  return { root }
}

describe('OpfsStorage fallback traversal', () => {
  afterEach(() => { jest.clearAllMocks(); delete (globalThis as any).navigator })

  it('uses keys() fallback and recurses into directories', async () => {
    const { root } = makeHierRoot()
    ;(globalThis as any).navigator = { storage: { getDirectory: async () => root } }

    const s = new OpfsStorage('apigit_storage')
    const files = await s.listFiles('', 'workspace', true)
    // keys fallback should produce paths 'foo.txt' and 'sub/bar.txt'
    const paths = files.map(f => f.path)
    expect(paths).toEqual(expect.arrayContaining(['foo.txt', 'sub/bar.txt']))
  })
})
