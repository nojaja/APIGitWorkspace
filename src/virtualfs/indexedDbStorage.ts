import { IndexFile } from './types'
import { StorageBackend, StorageBackendConstructor } from './storageBackend'

/**
 * IndexedDB を用いた永続化実装
 */
export const IndexedDbStorage: StorageBackendConstructor = class IndexedDbStorage implements StorageBackend {
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
  private dbName = 'apigit_storage'
  private dbPromise: Promise<IDBDatabase>

  /** コンストラクタ */
  constructor() {
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
      const req = idb.open(this.dbName, 1)

      /**
       * DB スキーマアップグレード時のハンドラ
       * @param {IDBVersionChangeEvent} ev イベント
       */
      function handleUpgrade(ev: any) {
        const db = (ev.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('index')) db.createObjectStore('index')
      }
      req.onupgradeneeded = handleUpgrade

      /**
       * 指定 DB に対する onversionchange ハンドラを生成します。
       * @param dbParam 対象の DB
       */
      /**
       * 指定 DB に対する onversionchange ハンドラを生成します。
       * @param dbParam 対象の DB
       * @returns {() => void} ハンドラ関数
       */
      function makeVersionChangeHandler(dbParam: IDBDatabase) {
        return function () { try { dbParam.close() } catch (_) { void 0 } }
      }

      /**
       * 成功時のハンドラ
       * @returns {void}
       */
      function handleSuccess() {
        const db = req.result
        try {
          db.onversionchange = makeVersionChangeHandler(db)
        } catch (_) { void 0 }
        resolve(db)
      }

      /** エラー時ハンドラ */
      function handleError() { reject(req.error) }

      req.onsuccess = handleSuccess
      req.onerror = handleError
    })
  }

  /**
   * トランザクションラッパー。cb 内の処理をトランザクションで実行し、
   * 必要なら再試行します。
   */
  /**
   * トランザクションラッパー。cb 内の処理をトランザクションで実行し、必要なら再試行します。
   * @returns {Promise<void>} トランザクション処理完了時に解決
   */
  private async tx(storeName: string, mode: IDBTransactionMode, cb: (_store: IDBObjectStore) => void | Promise<void>): Promise<void> {
    /**
     * 単一トランザクション試行実行を行います。
     * @returns {Promise<void>} トランザクション処理完了時に解決
     */
    const attempt = async (): Promise<void> => {
      const db = await this.dbPromise
      return new Promise<void>((resolve, reject) => {
        let tx: IDBTransaction
        try { tx = db.transaction(storeName, mode) } catch (err) { return reject(err) }
        const storeObj = tx.objectStore(storeName)

        /** トランザクション完了ハンドラ */
        function handleTxComplete() { resolve() }

        /** トランザクションエラーハンドラ */
        function handleTxError() { reject(tx.error) }

        Promise.resolve(cb(storeObj)).then(() => {
          tx.oncomplete = handleTxComplete
          tx.onerror = handleTxError
        }).catch(reject)
      })
    }

    try { return await attempt() } catch (err: any) {
      const isInvalidState = err && (err.name === 'InvalidStateError' || /closing/i.test(String(err.message || '')))
      if (isInvalidState) { this.dbPromise = this.openDb(); return await attempt() }
      throw err
    }
  }

  // legacy canUseOpfs removed; use static canUse() instead

  /**
   * index を読み出す
   * @returns {Promise<IndexFile|null>} 読み出した IndexFile、存在しなければ null
   */
  async readIndex(): Promise<IndexFile | null> {
    const db = await this.dbPromise
    return new Promise<IndexFile | null>((resolve, reject) => {
      const tx = db.transaction('index', 'readonly')
      const store = tx.objectStore('index')
      const req = store.get('index')

      /** index 取得成功ハンドラ */
      function handleIndexSuccess() { resolve(req.result ?? null) }

      /** index 取得エラーハンドラ */
      function handleIndexError() { reject(req.error) }

      req.onsuccess = handleIndexSuccess
      req.onerror = handleIndexError
    })
  }

  /**
   * index を書き込む
   * @returns {Promise<void>} 書込完了時に解決
   */
  async writeIndex(index: IndexFile): Promise<void> {
    await this.tx('index', 'readwrite', (store) => { store.put(index, 'index') })
  }

  /**
   * blob を書き込む
   * @returns {Promise<void>} 書込完了時に解決
   */
  async writeBlob(filepath: string, content: string): Promise<void> {
    await this.tx('blobs', 'readwrite', (store) => { store.put(content, filepath) })
  }

  /**
   * blob を読み出す
   * @returns {Promise<string|null>} ファイル内容、存在しなければ null
   */
  async readBlob(filepath: string): Promise<string | null> {
    const db = await this.dbPromise
    // Try primary key, then common fallbacks for workspace/.git-base/.git-conflict
    /**
     * 指定キーから blob を取得する小さなヘルパ
     * @param {string} key 対象キー
     * @returns {Promise<string|null>} 取得した文字列または null
     */
    const tryGet = (key: string) => new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readonly')
      const store = tx.objectStore('blobs')
      const req = store.get(key)
      /** 成功ハンドラ */
      function handleTryGetSuccess() { resolve(req.result ?? null) }
      /** エラーハンドラ */
      function handleTryGetError() { reject(req.error) }
      req.onsuccess = handleTryGetSuccess
      req.onerror = handleTryGetError
    })

    try {
      const primary = await tryGet(filepath)
      if (primary !== null) return primary
      const ws = await tryGet(`workspace/${filepath}`)
      if (ws !== null) return ws
      const base = await tryGet(`.git-base/${filepath}`)
      if (base !== null) return base
      const conflict = await tryGet(`.git-conflict/${filepath}`)
      if (conflict !== null) return conflict
      return null
    } catch (err) {
      return null
    }
  }

  /**
   * blob を削除する
   * @returns {Promise<void>} 削除完了時に解決
   */
  async deleteBlob(filepath: string): Promise<void> {
    // Delete the exact key and common variants for compatibility with other backends
    await this.tx('blobs', 'readwrite', (store) => {
      store.delete(filepath)
      store.delete(`workspace/${filepath}`)
      store.delete(`.git-base/${filepath}`)
      store.delete(`.git-conflict/${filepath}`)
    })
  }
}

export default IndexedDbStorage
