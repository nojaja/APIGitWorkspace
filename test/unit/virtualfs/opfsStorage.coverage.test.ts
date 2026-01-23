import OpfsStorage from '../../../src/virtualfs/opfsStorage'

describe('OpfsStorage extra coverage', () => {
  it('write/read/delete via OPFS directory chain', async () => {
    const s = new (OpfsStorage as any)('apigit_storage')
    const store = new Map<string, string>()

    function createDirHandler(pathPrefix: string): any {
      return {
        getFileHandle: async (name: string, opts?: any) => {
          const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name
          return {
            createWritable: async () => ({
              write: async (data: string) => { store.set(fullPath, data) },
              close: async () => undefined
            }),
            getFile: async () => ({ 
              text: async () => store.get(fullPath) ?? ''
            })
          }
        },
        getDirectoryHandle: async (name: string, opts?: any) => {
          const newPrefix = pathPrefix ? `${pathPrefix}/${name}` : name
          return createDirHandler(newPrefix)
        },
        removeEntry: async (name: string) => { 
          const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name
          store.delete(fullPath) 
        }
      }
    }

    const rootDir = createDirHandler('apigit_storage')

    // stub getOpfsRoot to return our fake root
    ;(s as any).getOpfsRoot = async () => rootDir

    await (s as any).writeBlob('a.txt', 'hello')
    const txt = await (s as any).readBlob('a.txt')
    expect(txt).toBe('hello')

    await (s as any).deleteBlob('a.txt')
    const txt2 = await (s as any).readBlob('a.txt')
    expect(txt2).toBeFalsy()
  })

  it('delete via file handle.remove when removeEntry not present', async () => {
    const s = new (OpfsStorage as any)('apigit_storage')
    const store = new Map<string, string>()
    store.set('apigit_storage/workspace/b.txt', 'payload')

    const fh = {
      remove: async () => { store.delete('apigit_storage/workspace/b.txt') },
      getFile: async () => ({ text: async () => (store.get('apigit_storage/workspace/b.txt') ?? '') })
    }

    const workspaceDir = {
      getFileHandle: async (_name: string) => fh
    }

    const apigitDir = {
      getDirectoryHandle: async (_p: string) => workspaceDir
    }

    const rootDir = {
      getDirectoryHandle: async (_p: string) => apigitDir
    }

    ;(s as any).getOpfsRoot = async () => rootDir

    await (s as any).deleteBlob('b.txt')
    const got = await (s as any).readBlob('b.txt')
    expect(got).toBeFalsy()
  })
})
