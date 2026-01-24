import { IndexFile } from './types'
import { StorageBackend, StorageBackendConstructor } from './storageBackend'

const ERR_OPFS_DIR_API = 'OPFS directory API not available'
const VAR_WORKSPACE = 'workspace'
const VAR_BASE = '.git-base'
const VAR_CONFLICT = '.git-conflict'
const VAR_INFO = '.git-info'

/** OPFS (origin private file system) を利用する永続化実装 */
export const OpfsStorage: StorageBackendConstructor = class OpfsStorage implements StorageBackend {
  /**
   * 同期的に OPFS 利用可否を判定します（レガシーヒントも含む）。
   * @returns {boolean} 利用可能なら true
   */
  static canUse(): boolean {
    let ok = false
    const nav = (globalThis as any).navigator
    // If navigator.storage.persist exists, treat as OPFS-capable hint (legacy detection)
    if (nav && nav.storage && typeof nav.storage.persist === 'function') ok = true
    if (nav && nav.storage && typeof nav.storage.getDirectory === 'function') ok = true

    if (!ok && (globalThis as any).originPrivateFileSystem && typeof (globalThis as any).originPrivateFileSystem.getDirectory === 'function') ok = true
    return ok
  }

  /** 利用可能なサブディレクトリ名の候補を返す
   * @returns {string[]} available root directories
   */
  static availableRoots(): string[] {
    return ['apigit_storage']
  }

  /**
   * Returns the known segment variants in search order.
   * @returns {string[]} segment directory names
   */
  private getVariants(): string[] {
    return [VAR_WORKSPACE, VAR_BASE, VAR_CONFLICT]
  }

  private rootDir = 'apigit_storage'

  /**
   * Calculate SHA-1 hex digest of given content.
   * @param content Input string
   * @returns {Promise<string>} Hex encoded SHA-1 digest
   */
  private async shaOf(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /** コンストラクタ（OPFS は初期化不要）。`root` は OPFS ルート直下に作成するサブディレクトリ名です。 */
  constructor(root?: string) {
    if (root) this.rootDir = root
  }

  /**
   * 初期化（OPFS はランタイム判定のみ）
   * @returns {Promise<void>} 初期化完了時に解決
   */
  async init(): Promise<void> {
    void 0
  }

  // legacy canUseOpfs removed; use static canUse() instead

  /**
   * Try to get OPFS root from navigator.storage.getDirectory().
   * @returns {Promise<any|null>}
   */
  private async _tryNavigatorStorage(): Promise<any | null> {
    const nav = (globalThis as any).navigator
    if (!nav || !nav.storage || typeof nav.storage.getDirectory !== 'function') {
      return null
    }
    try {
      const maybe = nav.storage.getDirectory()
      const d = await Promise.resolve(maybe)
      return d || null
    } catch (_) {
      return null
    }
  }

  /**
   * Try to get OPFS root from originPrivateFileSystem.getDirectory().
   * @returns {Promise<any|null>}
   */
  private async _tryOriginPrivateFileSystem(): Promise<any | null> {
    const opfs = (globalThis as any).originPrivateFileSystem
    if (!opfs || typeof opfs.getDirectory !== 'function') {
      return null
    }
    try {
      return await opfs.getDirectory()
    } catch (_) {
      return null
    }
  }

  /**
   * OPFS のルートディレクトリハンドルを取得します。失敗時は null を返す。
   * @returns {Promise<any|null>} ルートハンドルまたは null
   */
  private async getOpfsRoot(): Promise<any | null> {
    const fromNav = await this._tryNavigatorStorage()
    if (fromNav) return fromNav
    return await this._tryOriginPrivateFileSystem()
  }

  /**
   * 指定パスのディレクトリを再帰的に作成して返す
   * @returns {Promise<any>} 生成されたディレクトリハンドル
   */
  private async ensureDir(root: any, parts: string[]): Promise<any> {
    let dir = root
    for (const p of parts) {
      if (dir && typeof dir.getDirectoryHandle === 'function') {
        dir = await dir.getDirectoryHandle(p, { create: true })
      } else if (dir && typeof dir.getDirectory === 'function') {
        dir = await dir.getDirectory(p, { create: true })
      } else {
        throw new Error(ERR_OPFS_DIR_API)
      }
    }
    return dir
  }

  /**
   * index を読み出す
   * @returns {Promise<IndexFile|null>} 読み出した IndexFile、存在しなければ null
   */
  /**
   * Read index metadata file from OPFS.
   * @returns {Promise<string|null>}
   */
  private async _readIndexMetadata(root: any): Promise<string | null> {
    try {
      const hasDirApi = typeof (root as any).getDirectoryHandle === 'function' || typeof (root as any).getDirectory === 'function'
      if (hasDirApi) {
        const scoped = await this.traverseDir(root, this.rootDir.split('/').filter(Boolean))
        const fh = await scoped.getFileHandle('index')
        const file = await fh.getFile()
        return await file.text()
      }
      const fh = await (root as any).getFileHandle('index')
      const file = await fh.getFile()
      return await file.text()
    } catch (_) {
      return null
    }
  }

  /**
   * index を読み出す
   * @returns {Promise<IndexFile|null>} 読み出した IndexFile、存在しなければ null
   */
  async readIndex(): Promise<IndexFile | null> {
    try {
      const root = await this.getOpfsRoot()
      if (!root) return null

      const metaTxt = await this._readIndexMetadata(root)

      const result: IndexFile = { head: '', entries: {} }
      if (metaTxt) {
        const parsed = JSON.parse(metaTxt) as any
        result.head = parsed.head || ''
        if (parsed.lastCommitKey) result.lastCommitKey = parsed.lastCommitKey
      }

      // Reconstruct entries by reading all files under the 'info' segment
      await this._readInfoEntries(root, result)

      return result
    } catch (_) {
      return { head: '', entries: {} }
    }
  }

  /**
   * Read all info entries under VAR_INFO and populate the given IndexFile.entries map.
   * @returns {Promise<void>}
   */
  private async _readInfoEntries(root: any, result: IndexFile): Promise<void> {
    const infoFiles = await this.listFilesAtPrefix(root, VAR_INFO).catch(() => [])
    for (const fp of infoFiles) {
      const txt = await this.readBlob(fp, 'info')
      if (!txt) continue
      try {
        const entry = JSON.parse(txt) as any
        result.entries[fp] = entry
      } catch (error) {
        // ignore malformed info entry
        continue
      }
    }
  }

  /**
   * index を書き込む
   * @returns {Promise<void>} 書込完了時に解決
   */
  async writeIndex(index: IndexFile): Promise<void> {
    const root = await this.getOpfsRoot()
    if (!root) throw new Error('OPFS not available')

    // Write each entry separately to the 'info' segment
    const entries = index.entries || {}
    for (const filepath of Object.keys(entries)) {
      const entry = entries[filepath]
      // store each IndexEntry JSON under segment 'info' using the filepath as key
      await this.writeBlob(filepath, JSON.stringify(entry), 'info')
    }

    // Persist index metadata (without entries) as before
    const meta: any = { head: index.head }
    if (index.lastCommitKey) meta.lastCommitKey = index.lastCommitKey

    const hasDirApi = typeof (root as any).getDirectoryHandle === 'function' || typeof (root as any).getDirectory === 'function'
    const payload = JSON.stringify(meta)
    if (hasDirApi) {
      const parts = this.rootDir.split('/').filter(Boolean)
      const parent = await this.ensureDir(root, parts)
      const fh = await parent.getFileHandle('index', { create: true })
      const writable = await fh.createWritable()
      await writable.write(payload)
      await writable.close()
      return
    }
    // fallback: root supports getFileHandle directly
    const fh = await (root as any).getFileHandle('index', { create: true })
    const writable = await fh.createWritable()
    await writable.write(payload)
    await writable.close()
  }

  /**
   * blob を書き込む
   * @returns {Promise<void>} 書込完了時に解決
   */
  async writeBlob(filepath: string, content: string, segment?: 'workspace' | 'base' | 'conflict' | 'info'): Promise<void> {
    const seg: 'workspace' | 'base' | 'conflict' | 'info' = segment ?? 'workspace'
    const root = await this.getOpfsRoot()
    if (!root) throw new Error('OPFS not available')
    const prefix = seg === 'workspace' ? VAR_WORKSPACE : seg === 'base' ? VAR_BASE : seg === 'info' ? VAR_INFO : VAR_CONFLICT
    // write actual blob
    await this._writeToPrefix(root, prefix, filepath, content)

    // if writing to info segment itself, do not create recursive info entry
    if (seg === 'info') return

    // create/update corresponding info entry summarizing this file
    const sha = await this.shaOf(content)
    const now = Date.now()
    await this._updateInfoForWrite(root, seg, filepath, sha, now)
  }

  /**
   * Build and persist info metadata for a file written to a segment.
   * @returns {Promise<void>}
   */
  private async _updateInfoForWrite(root: any, seg: 'workspace' | 'base' | 'conflict' | 'info', filepath: string, sha: string, now: number): Promise<void> {
    // Attempt to read existing info metadata to preserve fields (e.g., baseSha)
    let existing: any = {}
    try {
      const existingTxt = await this.readFromPrefix(root, VAR_INFO, filepath)
      if (existingTxt) existing = JSON.parse(existingTxt)
    } catch (error) {
      existing = {}
    }

    let entry: any = { path: filepath, updatedAt: now }
    if (seg === 'workspace') entry = this._buildWorkspaceEntry(existing, filepath, sha, now)
    else if (seg === 'base') entry = this._buildBaseEntry(existing, filepath, sha, now)
    else if (seg === 'conflict') entry = this._buildConflictEntry(existing, filepath, now)

    await this._writeToPrefix(root, VAR_INFO, filepath, JSON.stringify(entry))
  }
  /**
   * Build info entry for workspace writes.
   * @returns {any}
   */
  private _buildWorkspaceEntry(existing: any, filepath: string, sha: string, now: number): any {
    const entry: any = { path: filepath, updatedAt: now }
    if (existing && existing.baseSha) entry.baseSha = existing.baseSha
    entry.workspaceSha = sha
    entry.state = entry.baseSha ? 'modified' : 'added'
    if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
    return entry
  }
  /**
   * Build info entry for base writes.
   * @returns {any}
   */
  private _buildBaseEntry(existing: any, filepath: string, sha: string, now: number): any {
    const entry: any = { path: filepath, updatedAt: now }
    if (existing && existing.workspaceSha) entry.workspaceSha = existing.workspaceSha
    entry.baseSha = sha
    entry.state = 'base'
    if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
    return entry
  }
  /**
   * Build info entry for conflict writes.
   * @returns {any}
   */
  private _buildConflictEntry(existing: any, filepath: string, now: number): any {
    const entry: any = { path: filepath, updatedAt: now }
    if (existing && existing.baseSha) entry.baseSha = existing.baseSha
    if (existing && existing.workspaceSha) entry.workspaceSha = existing.workspaceSha
    if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
    entry.state = 'conflict'
    return entry
  }

  /**
   * Write content to a file under given prefix, creating directories as needed.
   */
  private async _writeToPrefix(root: any, prefix: string, filepath: string, content: string): Promise<void> {
    const fullPath = this.rootDir ? `${this.rootDir}/${prefix}/${filepath}` : `${prefix}/${filepath}`
    const parts = fullPath.split('/').filter(Boolean)
    const dirParts = parts.slice(0, parts.length - 1)
    const parent = await this.ensureDir(root, dirParts)
    const fh = await parent.getFileHandle(parts[parts.length - 1], { create: true })
    const writable = await fh.createWritable()
    await writable.write(content)
    await writable.close()
  }

  /**
   * Read text from a file handle returning null on failure.
   * @param fh File handle
   * @returns {Promise<string|null>} file text or null
   */
  private async _readFileFromHandle(fh: any): Promise<string | null> {
    try {
      const file = await fh.getFile()
      const txt = await file.text()
      return txt ?? null
    } catch (_) {
      return null
    }
  }

  /**
   * blob を読み出す
   * @returns {Promise<string|null>} ファイル内容、存在しなければ null
   */
  async readBlob(filepath: string, segment?: any): Promise<string | null> {
    const root = await this.getOpfsRoot()
    if (!root) return null
    return await this._readBlobFromRoot(root, segment, filepath)
  }

  /**
   * Read blob from a resolved root. Extracted to reduce cognitive complexity of public entry.
   * @returns {Promise<string|null>}
   */
  private async _readBlobFromRoot(root: any, segment: 'workspace' | 'base' | 'conflict' | 'info' | undefined, filepath: string): Promise<string | null> {
    // segment指定がある場合はそのまま返却
    if (segment !== undefined) {
      return await this._readFromSegment(root, segment, filepath)
    }

    // segment未指定の場合はworkspace→baseの順で参照
    const workspaceContent = await this._readFromSegment(root, 'workspace', filepath)
    if (workspaceContent !== null) return workspaceContent
    return await this._readFromSegment(root, 'base', filepath)
  }

  /**
   * Read from a specific segment prefix.
    * @returns {Promise<string|null>} file text or null
    */
  private async _readFromSegment(root: any, segment: 'workspace' | 'base' | 'conflict' | 'info', filepath: string): Promise<string | null> {
    const prefix = segment === 'workspace' ? VAR_WORKSPACE : segment === 'base' ? VAR_BASE : segment === 'info' ? VAR_INFO : VAR_CONFLICT
    try {
      return await this.readFromPrefix(root, prefix, filepath)
    } catch (error) {
      return null
    }
  }

  /**
   * Read by trying each variant in order and returning first match.
    * @returns {Promise<string|null>} file text or null
    */
  private async _readFromVariants(root: any, filepath: string): Promise<string | null> {
    for (const v of this.getVariants()) {
      const txt = await this.readFromPrefix(root, v, filepath)
      if (txt !== null) return txt
    }
    return null
  }

  /**
   * blob を削除する
   * @returns {Promise<void>} 削除完了時に解決
   */
  async deleteBlob(filepath: string, segment?: any): Promise<void> {
    const root = await this.getOpfsRoot()
    if (!root) return
    if (segment === 'workspace') { await this.removeAtPrefix(root, VAR_WORKSPACE, filepath); return }
    if (segment === 'base') { await this.removeAtPrefix(root, VAR_BASE, filepath); return }
    if (segment === 'conflict') { await this.removeAtPrefix(root, VAR_CONFLICT, filepath); return }
    if (segment === 'info') { await this.removeAtPrefix(root, VAR_INFO, filepath); return }

    for (const v of this.getVariants()) await this.removeAtPrefix(root, v, filepath)
    // also remove any info entry
    await this.removeAtPrefix(root, VAR_INFO, filepath)
  }

  /**
    * Remove a file at a given prefix (does not create directories)
    * @param root root directory handle
    * @param prefix prefix dir
    * @param filepath path relative to prefix
    * @returns {Promise<void>} resolves when removal attempted (errors are ignored)
    */
  private async removeAtPrefix(root: any, prefix: string, filepath: string): Promise<void> {
    const full = this.rootDir ? `${this.rootDir}/${prefix}/${filepath}` : `${prefix}/${filepath}`
    const parts = full.split('/').filter(Boolean)
    let dir: any
    // ディレクトリが存在しない場合（NotFound）は削除対象なしとして終了
    try {
      dir = await this.traverseDir(root, parts.slice(0, parts.length - 1))
    } catch (_) {
      return
    }
    const name = parts[parts.length - 1]
    if (typeof dir.removeEntry === 'function') {
      try {
        await dir.removeEntry(name)
      } catch (_) {
        // removeEntryが失敗しても無視（存在しない等）
      }
      return
    }
    if (typeof dir.getFileHandle === 'function') {
      await this.tryRemoveFileHandle(dir, name)
      
    }
  }

  /**
   * Read a file under a prefix without throwing. Returns null when not found.
   * @param root root directory handle
   * @param prefix prefix dir
   * @param filepath path relative to prefix
    * @returns {Promise<string|null>} file contents or null when not found
    */
  private async readFromPrefix(root: any, prefix: string, filepath: string): Promise<string | null> {
    // reuse existing traversal logic but guard errors
    try {
      const fullPath = this.rootDir ? `${this.rootDir}/${prefix}/${filepath}` : `${prefix}/${filepath}`
      const parts = fullPath.split('/').filter(Boolean)
      const dir = await this.traverseDir(root, parts.slice(0, parts.length - 1))
      const fh = await dir.getFileHandle(parts[parts.length - 1])
      return await this._readFileFromHandle(fh)
    } catch (_) {
      return null
    }
  }


  /**
   * Traverse into nested directories without creating them.
   * @param root The starting directory handle
   * @param parts Path parts to traverse
   * @returns The final directory handle
   */
  private async traverseDir(root: any, parts: string[]): Promise<any> {
    let dir = root
    for (const p of parts) {
      if (dir && typeof dir.getDirectoryHandle === 'function') {
        dir = await dir.getDirectoryHandle(p)
      } else if (dir && typeof dir.getDirectory === 'function') {
        dir = await dir.getDirectory(p)
      } else {
        throw new Error(ERR_OPFS_DIR_API)
      }
    }
    return dir
  }

  /**
   * List all file paths under given prefix (relative paths).
   * @returns {Promise<string[]>} Array of relative file paths; empty array on failure
   */
  private async listFilesAtPrefix(root: any, prefix: string): Promise<string[]> {
    try {
      const parts = this.rootDir ? this.rootDir.split('/').filter(Boolean).concat([prefix]) : [prefix]
      const dir = await this.traverseDir(root, parts)
      const results: string[] = []
      await this._recurseListDir(dir, '', results)
      return results
    } catch (_) {
      return []
    }
  }

  /**
   * Helper to recursively walk directory handles and collect file paths.
   * @returns {Promise<void>}
   */
  private async _recurseListDir(d: any, base: string, results: string[]): Promise<void> {
    // Prefer entries() async iterator; if unavailable, delegate to fallback.
    try {
      for await (const pair of (d as any).entries()) {
        await this._processEntryPair(pair, base, results)
      }
      return
    } catch (error) {
      await this._recurseListDirFallback(d, base, results)
      return
    }
  }

  /**
   * Process a single entry returned by entries(): push files or recurse into directories.
   * @returns {Promise<void>}
   */
  private async _processEntryPair(pair: any, base: string, results: string[]): Promise<void> {
    const name = Array.isArray(pair) ? pair[0] : (pair.name || '')
    const handle = Array.isArray(pair) ? pair[1] : (pair[1] || pair)
    const childPath = base ? `${base}/${name}` : name
    if ((handle as any).kind === 'file' || typeof (handle as any).getFile === 'function') {
      results.push(childPath)
    } else {
      await this._recurseListDir(handle, childPath, results)
    }
  }

  /**
   * Fallback recursion over directory when entries() iterator unavailable.
   * @returns {Promise<void>}
   */
  private async _recurseListDirFallback(d: any, base: string, results: string[]): Promise<void> {
    for await (const name of (d as any).keys()) {
      await this._handleChildEntry(d, name, base, results)
    }
  }
  /** Handle a single child entry name: try file first, then directory. */
  /**
   * @returns {Promise<void>}
   */
  private async _handleChildEntry(d: any, name: string, base: string, results: string[]): Promise<void> {
    const childPath = base ? `${base}/${name}` : name
    if (typeof d.getFileHandle === 'function') {
      try {
        const fh = await d.getFileHandle(name)
        if (fh) { results.push(childPath); return }
      } catch (error) {
        return
      }
    }
    if (typeof d.getDirectoryHandle === 'function') {
      try {
        const childDir = await d.getDirectoryHandle(name)
        await this._recurseListDir(childDir, childPath, results)
      } catch (error) {
        return
      }
    }
  }

  /**
   * Safely list files at prefix, returning an empty array on error.
   * @returns {Promise<string[]>}
   */
  private async _safeListFilesAtPrefix(root: any, segPrefix: string): Promise<string[]> {
    return this.listFilesAtPrefix(root, segPrefix).catch(() => [])
  }

  /**
   * Collect info objects for given keys under VAR_INFO
   * @returns {Promise<Array<{ path: string; info: string | null }>>}
   */
  private async _collectInfoForKeys(root: any, keys: string[]): Promise<Array<{ path: string; info: string | null }>> {
    const out: Array<{ path: string; info: string | null }> = []
    for (const k of keys) {
      const info: string | null = await this.readFromPrefix(root, VAR_INFO, k).catch(() => null)
      out.push({ path: k, info })
    }
    return out
  }

  /**
   * 指定プレフィックス配下のファイル一覧を取得します。
   * @param prefix プレフィックス（例: 'dir/sub'）。省略時はルート
   * @param segment セグメント（'workspace' 等）。省略時は 'workspace'
   * @param recursive サブディレクトリも含めるか。省略時は true
    * @returns {Promise<Array<{ path: string; info: string | null }>>}
   */
  async listFiles(prefix?: string, segment?: any, recursive = true): Promise<Array<{ path: string; info: string | null }>> {
    const root = await this.getOpfsRoot()
    if (!root) return []

    const seg: 'workspace' | 'base' | 'conflict' | 'info' = segment ?? 'workspace'
    const segPrefix = seg === 'workspace' ? VAR_WORKSPACE : seg === 'base' ? VAR_BASE : seg === 'info' ? VAR_INFO : VAR_CONFLICT

    const keys = await this._safeListFilesAtPrefix(root, segPrefix)
    const p = prefix ? prefix.replace(/^\/+|\/+$/g, '') : ''
    const filtered = this._filterKeys(keys, p, recursive)
    return await this._collectInfoForKeys(root, filtered)
  }

  /**
   * Filter keys by prefix and recursion flag for OPFS listing
   * @returns {string[]}
   */
  private _filterKeys(keys: string[], p: string, recursive: boolean): string[] {
    let out = keys
    if (p) out = out.filter((k) => k === p || k.startsWith(p + '/'))
    if (!recursive) {
      out = out.filter((k) => {
        const rest = p ? k.slice(p.length + 1) : k
        return !rest.includes('/')
      })
    }
    return out
  }

  /**
   * Try to remove a file via its file handle.
   * @returns {Promise<boolean>} true when removed, false otherwise
   */
  private async tryRemoveFileHandle(dir: any, name: string): Promise<boolean> {
    try {
      const fh = await dir.getFileHandle(name)
      if (fh && typeof (fh as any).remove === 'function') {
        await (fh as any).remove()
        return true
      }
      return false
    } catch (error) {
      // getFileHandle/remove が例外を投げた場合は削除できなかったと扱う
      return false
    }
  }
}

export default OpfsStorage
