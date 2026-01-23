/**
 * OPFS モックヘルパー
 * OpfsStorageのテストで使用する共通のモック実装を提供します。
 * 
 * 問題: 従来のモックでは、すべてのファイルを単一のMapに格納していたため、
 *       git-workspace/file.txt と git-info/file.txt が区別できず、
 *       infoの内容が workspaceの内容を上書きしてしまう問題がありました。
 * 
 * 解決策: 完全なパス（ディレクトリツリーを含む）をキーとして使用することで、
 *         各セグメント（workspace/base/conflict/info）を正しく分離します。
 */

export function createOpfsMock() {
  const allFiles = new Map<string, string>() // 完全パス -> コンテンツ

  function makeDir(pathPrefix: string, map: Map<string, any>) {
    async function getDirectory(name: string, opts?: any) {
      const newPrefix = pathPrefix ? `${pathPrefix}/${name}` : name
      if (!map.has(name)) map.set(name, makeDir(newPrefix, new Map()))
      return map.get(name)
    }
    async function getFileHandle(name: string, opts?: any) {
      const fullKey = pathPrefix ? `${pathPrefix}/${name}` : name
      async function createWritable() {
        return {
          async write(content: string) { allFiles.set(fullKey, content) },
          async close() {}
        }
      }
      async function getFile() {
        return { async text() { return allFiles.get(fullKey) } }
      }
      return { createWritable, getFile }
    }
    async function removeEntry(name: string) {
      const fullKey = pathPrefix ? `${pathPrefix}/${name}` : name
      map.delete(name)
      allFiles.delete(fullKey)
    }
    return { getDirectory, getFileHandle, removeEntry }
  }

  return makeDir('', new Map())
}

export function createOpfsMockWithRemove() {
  const allFiles = new Map<string, string>()

  function makeDir(pathPrefix: string, map: Map<string, any>) {
    async function getDirectory(name: string, opts?: any) {
      const newPrefix = pathPrefix ? `${pathPrefix}/${name}` : name
      if (!map.has(name)) map.set(name, makeDir(newPrefix, new Map()))
      return map.get(name)
    }
    async function getFileHandle(name: string, opts?: any) {
      const fullKey = pathPrefix ? `${pathPrefix}/${name}` : name
      async function createWritable() {
        return {
          async write(content: string) { allFiles.set(fullKey, content) },
          async close() {}
        }
      }
      async function getFile() {
        return { async text() { return allFiles.get(fullKey) } }
      }
      async function remove() { allFiles.delete(fullKey) }
      return { createWritable, getFile, remove }
    }
    async function removeEntry(name: string) {
      const fullKey = pathPrefix ? `${pathPrefix}/${name}` : name
      map.delete(name)
      allFiles.delete(fullKey)
    }
    return { getDirectory, getFileHandle, removeEntry }
  }

  return makeDir('', new Map())
}
