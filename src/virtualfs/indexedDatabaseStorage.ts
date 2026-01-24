import { IndexFile } from './types'
import { StorageBackend, StorageBackendConstructor, Segment } from './storageBackend'

/**
 * IndexedDB を用いた永続化実装
 */
export const IndexedDatabaseStorage: StorageBackendConstructor = class IndexedDatabaseStorage implements StorageBackend {
  /**
   * 環境に IndexedDB が存在するかを同期検査します。
    * @returns {boolean} 利用可能なら true
   */
  static canUse(): boolean {
    try {
      return !!(globalThis as any).indexedDB
    } catch (_) {
      return false
    }
  }
  private dbName: string
  private dbPromise: Promise<IDBDatabase>
  private static VAR_WORKSPACE = 'workspace'
  private static VAR_BASE = 'git-base'
  private static VAR_CONFLICT = 'git-conflict'
  private static VAR_INFO = 'git-info'
  private static DEFAULT_DB_NAME = 'apigit_storage'

  /** 利用可能な DB 名の一覧を返す
   * @returns {string[]} available root names
   */
  static availableRoots(): string[] {
    return [IndexedDatabaseStorage.DEFAULT_DB_NAME]
  }

  /** コンストラクタ */
  constructor(root?: string) {
    this.dbName = root ?? IndexedDatabaseStorage.DEFAULT_DB_NAME
    // Kick off DB open immediately so dbPromise is always defined
    this.dbPromise = this.openDb()
  }

  /**
   * 初期化: DB をオープンするまで待つ
   * @returns {Promise<void>} 初期化完了時に解決
   */
  async init(): Promise<void> {
    await this.dbPromise
  }

  /**
   * DB を開いて objectStore を初期化する
   * @returns {Promise<IDBDatabase>} Opened IDBDatabase
   */
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const idb = (globalThis as any).indexedDB
      if (!idb) return reject(new Error('IndexedDB is not available'))
      const request = idb.open(this.dbName, 1)
      /**
       * Handle DB upgrade event
       * @param {Event} ev Upgrade event
       * @returns {void}
       */
      request.onupgradeneeded = (event: any) => this._handleUpgrade(event)
      /**
       * Handle open success
       * @returns {void}
       */
      request.onsuccess = () => this._onOpenSuccess(request, resolve)
      /**
       * Handle open error
       * @returns {void}
       */
      request.onerror = () => this._onOpenError(request, reject)
    })
  }

  /**
   * DB スキーマの初期化/アップグレードを行うハンドラ
   */
  /**
   * Handle DB upgrade event and create required object stores.
   * @param ev Upgrade event
   * @returns {void}
   */
  private _handleUpgrade(event: any) {
    const database = (event.target as IDBOpenDBRequest).result
    if (!database.objectStoreNames.contains(IndexedDatabaseStorage.VAR_WORKSPACE)) database.createObjectStore(IndexedDatabaseStorage.VAR_WORKSPACE)
    if (!database.objectStoreNames.contains(IndexedDatabaseStorage.VAR_BASE)) database.createObjectStore(IndexedDatabaseStorage.VAR_BASE)
    if (!database.objectStoreNames.contains(IndexedDatabaseStorage.VAR_CONFLICT)) database.createObjectStore(IndexedDatabaseStorage.VAR_CONFLICT)
    if (!database.objectStoreNames.contains(IndexedDatabaseStorage.VAR_INFO)) database.createObjectStore(IndexedDatabaseStorage.VAR_INFO)
    if (!database.objectStoreNames.contains('index')) database.createObjectStore('index')
  }

  /**
   * 指定 DB に対する onversionchange ハンドラを生成します。
   */
  /**
   * Create a handler to close DB on version change.
   * @param dbParam Target DB
   * @returns {() => void}
   */
  private _makeVersionChangeHandler(databaseParameter: IDBDatabase) {
    return () => { databaseParameter.close() }
  }

  /**
   * DB open の成功ハンドラ
   */
  /**
   * Called when DB open succeeds.
   * @param req IDB open request
   * @param resolve Resolver for the open promise
   * @returns {void}
   */
  private _onOpenSuccess(request: IDBOpenDBRequest, resolve: (_database: IDBDatabase) => void) {
    const database = request.result
    database.onversionchange = this._makeVersionChangeHandler(database)
    resolve(database)
  }

  /**
   * DB open のエラーハンドラ
   */
  /**
   * Called when DB open errors.
   * @param req IDB open request
   * @param reject Reject function for the open promise
   * @returns {void}
   */
  private _onOpenError(request: IDBOpenDBRequest, reject: (_error?: any) => void) {
    reject(request.error)
  }

  /**
   * トランザクションラッパー。cb 内の処理をトランザクションで実行し、
   * 必要なら再試行します。
   */
  /**
   * トランザクションラッパー。cb 内の処理をトランザクションで実行し、必要なら再試行します。
   * @returns {Promise<void>} トランザクション処理完了時に解決
   */
  private async tx(storeName: string, mode: IDBTransactionMode, callback: (_store: IDBObjectStore) => void | Promise<void>): Promise<void> {
    try { return await this._performTxAttempt(storeName, mode, callback) } catch (error: any) {
      const isInvalidState = error && (error.name === 'InvalidStateError' || /closing/i.test(String(error.message || '')))
      if (isInvalidState) { this.dbPromise = this.openDb(); return await this._performTxAttempt(storeName, mode, callback) }
      throw error
    }
  }

  /**
   * 単一トランザクション試行実行を行います。
   * @returns {Promise<void>} トランザクション処理完了時に解決
   */
  private async _performTxAttempt(storeName: string, mode: IDBTransactionMode, callback: (_store: IDBObjectStore) => void | Promise<void>): Promise<void> {
    const database = await this.dbPromise
    return new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction
      try { tx = database.transaction(storeName, mode) } catch (error) { return reject(error) }
      const storeObject = tx.objectStore(storeName)

      /**
       * Transaction complete handler
       * @returns {void}
       */
      const handleTxComplete = () => { resolve() }
      /**
       * Transaction error handler
       * @returns {void}
       */
      const handleTxError = () => { reject(tx.error) }

      Promise.resolve(callback(storeObject)).then(() => {
        tx.oncomplete = handleTxComplete
        tx.onerror = handleTxError
      }).catch(reject)
    })
  }

  // legacy canUseOpfs removed; use static canUse() instead

  /**
   * index を読み出す
   * @returns {Promise<IndexFile|null>} 読み出した IndexFile、存在しなければ null
   */
  async readIndex(): Promise<IndexFile | null> {
    const database = await this.dbPromise
    // Read meta from 'index' store then reconstruct entries from VAR_INFO
    const meta: IndexFile | null = await new Promise<IndexFile | null>((resolve) => {
      try {
        const tx = database.transaction('index', 'readonly')
        const store = tx.objectStore('index')
        const request = store.get('index')
        /**
         * Success handler for index get.
         * @returns {void}
         */
        request.onsuccess = () => { resolve(request.result ?? null) }
        /**
         * Error handler for index get.
         * @returns {void}
         */
        request.onerror = () => { resolve(null) }
      } catch (_) { resolve(null) }
    })
    const result: IndexFile = { head: '', entries: {} }
    if (meta) {
      result.head = meta.head || ''
      if ((meta as any).lastCommitKey) result.lastCommitKey = (meta as any).lastCommitKey
    }

    // enumerate keys in info store and assemble entries
  
      const keys = await this._listKeysFromStore(IndexedDatabaseStorage.VAR_INFO)
      for (const k of keys) {
          const txt = await this._getFromStore(IndexedDatabaseStorage.VAR_INFO, k)
          if (!txt) continue
          const entry = JSON.parse(txt)
          result.entries[k] = entry
      }

    return result
  }

  /**
   * index を書き込む
   * @returns {Promise<void>} 書込完了時に解決
   */
  async writeIndex(index: IndexFile): Promise<void> {
    // Write entries individually into info store, then write metadata into 'index'
    const entries = index.entries || {}
    await this.tx(IndexedDatabaseStorage.VAR_INFO, 'readwrite', async (store) => {
      for (const filepath of Object.keys(entries)) {
        store.put(JSON.stringify(entries[filepath]), filepath)
      }
    })
    await this.tx('index', 'readwrite', (store) => { store.put({ head: index.head, lastCommitKey: (index as any).lastCommitKey }, 'index') })
  }

  /**
   * blob を書き込む
   * @returns {Promise<void>} 書込完了時に解決
   */
  async writeBlob(filepath: string, content: string, segment?: Segment): Promise<void> {
    const seg: Segment = segment ?? 'workspace'
      const storeName = seg === 'workspace' ? IndexedDatabaseStorage.VAR_WORKSPACE : seg === 'base' ? IndexedDatabaseStorage.VAR_BASE : seg === 'info' ? IndexedDatabaseStorage.VAR_INFO : IndexedDatabaseStorage.VAR_CONFLICT
    await this.tx(storeName, 'readwrite', (store) => { store.put(content, filepath) })

    // Do not recursively create info entry when writing into info store itself
    if (seg === 'info') return

    // Create/merge info metadata
    const sha = await this.shaOf(content)
    const now = Date.now()
    await this._updateInfoForWrite(filepath, seg, sha, now)
  }

  /**
   * Update info store entry for a written blob.
   * @returns {Promise<void>}
   */
  private async _updateInfoForWrite(filepath: string, seg: Segment, sha: string, now: number): Promise<void> {
    const existingTxt = await this._getFromStore(IndexedDatabaseStorage.VAR_INFO, filepath)
    const existing: any = existingTxt ? JSON.parse(existingTxt) : {}
    let entry: any = { path: filepath, updatedAt: now }
    if (seg === 'workspace') entry = this._buildWorkspaceEntry(existing, filepath, sha, now)
    else if (seg === 'base') entry = this._buildBaseEntry(existing, filepath, sha, now)
    else if (seg === 'conflict') entry = this._buildConflictEntry(existing, filepath, now)
    await this.tx(IndexedDatabaseStorage.VAR_INFO, 'readwrite', (store) => { store.put(JSON.stringify(entry), filepath) })
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
    entry.state = 'conflict'
    return entry
  }
  /**
   * blob を読み出す
   * @returns {Promise<string|null>} ファイル内容、存在しなければ null
   */
  async readBlob(filepath: string, segment?: Segment): Promise<string | null> {
    // segment指定がある場合はそのまま返却
    if (segment !== undefined) {
      if (segment === 'info') return await this._getFromStore(IndexedDatabaseStorage.VAR_INFO, filepath)
      const storeName = segment === IndexedDatabaseStorage.VAR_WORKSPACE ? IndexedDatabaseStorage.VAR_WORKSPACE : segment === 'base' ? IndexedDatabaseStorage.VAR_BASE : IndexedDatabaseStorage.VAR_CONFLICT
      return await this._getFromStore(storeName, filepath)
    }

    // segment未指定の場合はworkspace→baseの順で参照
    const workspaceContent = await this._getFromStore(IndexedDatabaseStorage.VAR_WORKSPACE, filepath)
    if (workspaceContent !== null) return workspaceContent
    return await this._getFromStore(IndexedDatabaseStorage.VAR_BASE, filepath)
  }

  /**
   * blob を削除する
   * @returns {Promise<void>} 削除完了時に解決
   */
  async deleteBlob(filepath: string, segment?: Segment): Promise<void> {
    if (segment === 'workspace') { await this._deleteFromStore(IndexedDatabaseStorage.VAR_WORKSPACE, filepath); return }
    if (segment === 'base') { await this._deleteFromStore(IndexedDatabaseStorage.VAR_BASE, filepath); return }
    if (segment === 'conflict') { await this._deleteFromStore(IndexedDatabaseStorage.VAR_CONFLICT, filepath); return }
    if (segment === 'info') { await this._deleteFromStore(IndexedDatabaseStorage.VAR_INFO, filepath); return }
    // segment未指定の場合はすべてのセグメントから削除
    await this._deleteFromStore(IndexedDatabaseStorage.VAR_WORKSPACE, filepath)
    await this._deleteFromStore(IndexedDatabaseStorage.VAR_BASE, filepath)
    await this._deleteFromStore(IndexedDatabaseStorage.VAR_CONFLICT, filepath)
    await this._deleteFromStore(IndexedDatabaseStorage.VAR_INFO, filepath)
  }

  /**
   * Read a value from a specific object store.
   * @param storeName Object store name
   * @param filepath Key to read
   * @returns {Promise<string|null>} value or null
   */
  private async _getFromStore(storeName: string, filepath: string): Promise<string | null> {
    const database = await this.dbPromise
    return new Promise<string | null>((resolve) => {
      try {
        const tx = database.transaction(storeName, 'readonly')
        const store = tx.objectStore(storeName)
        const request = store.get(filepath)
        /**
         * Index get success handler
         * @returns {void}
         */
        request.onsuccess = function () { resolve(request.result ?? null) }
        /**
         * Index get error handler
         * @returns {void}
         */
        request.onerror = function () { resolve(null) }
      } catch (_) { resolve(null) }
    })
  }

  /**
   * List all keys in an object store.
   * @returns {Promise<string[]>} Array of keys contained in the store
   */
  private async _listKeysFromStore(storeName: string): Promise<string[]> {
    const database = await this.dbPromise
    return new Promise<string[]>((resolve) => {
      try {
        const tx = database.transaction(storeName, 'readonly')
        const store = tx.objectStore(storeName)
        const keys: string[] = []
        const request = store.openKeyCursor()
        /**
         * Cursor success handler: collect keys.
         * @param ev Event from cursor
         * @returns {void}
         */
        request.onsuccess = function (event: any) {
          const current = event.target.result
            if (!current) { resolve(keys); return }
            if (current.key !== undefined) {
              keys.push(current.key as string)
            }
            current.continue()
        }
        /**
         * Cursor error handler: resolve with collected keys so far.
         * @returns {void}
         */
        request.onerror = function () { resolve(keys) }
      } catch (_) { resolve([]) }
    })
  }

  /**
   * 指定プレフィックス配下のファイル一覧を取得します。
   * @param prefix プレフィックス（省略時はルート）
   * @param segment セグメント（省略時は workspace）
   * @param recursive サブディレクトリも含めるか。省略時は true
    * @returns {Promise<Array<{ path: string; info: string | null }>>}
   */
  async listFiles(prefix?: string, segment?: Segment, recursive = true): Promise<Array<{ path: string; info: string | null }>> {
    const seg: Segment = segment ?? 'workspace'
    const storeName = seg === 'workspace' ? IndexedDatabaseStorage.VAR_WORKSPACE : seg === 'base' ? IndexedDatabaseStorage.VAR_BASE : seg === 'info' ? IndexedDatabaseStorage.VAR_INFO : IndexedDatabaseStorage.VAR_CONFLICT

    let keys: string[]
    try {
      keys = await this._listKeysFromStore(storeName)
    } catch (_) {
      keys = []
    }

    const p = prefix ? prefix.replace(/^\/+|\/+$/g, '') : ''
    keys = this._filterKeys(keys, p, recursive)
    return await this._collectFiles(keys)
  }

  /**
   * Filter keys by prefix and recursion flag.
   * @returns {string[]}
   */
  private _filterKeys(keys: string[], p: string, recursive: boolean): string[] {
    if (p) keys = keys.filter((k) => k === p || k.startsWith(p + '/'))
    if (!recursive) {
      keys = keys.filter((k) => {
        const rest = p ? k.slice(p.length + (p ? 1 : 0)) : k
        return !rest.includes('/')
      })
    }
    return keys
  }

  /**
   * Collect file info objects for keys array.
   * @returns {Promise<Array<{path:string, info:string|null}>>}
   */
  private async _collectFiles(keys: string[]): Promise<Array<{ path: string; info: string | null }>> {
    const out: Array<{ path: string; info: string | null }> = []
    for (const k of keys) {
      const info = await this._getFromStore(IndexedDatabaseStorage.VAR_INFO, k)
      out.push({ path: k, info })
    }
    return out
  }

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

  /**
   * Delete a key from a specific object store.
   * @param storeName Object store name
   * @param filepath Key to delete
   * @returns {Promise<void>}
   */
  private async _deleteFromStore(storeName: string, filepath: string): Promise<void> {
    return this.tx(storeName, 'readwrite', (store) => { store.delete(filepath) })
  }

}

export default IndexedDatabaseStorage
