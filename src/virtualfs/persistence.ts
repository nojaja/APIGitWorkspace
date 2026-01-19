import fs from 'fs/promises'
import path from 'path'
import { IndexFile } from './types'

/**
 * 永続化レイヤーの抽象インターフェース
 * Storage の具体実装はこの契約に従うこと
 */
export interface StorageBackend {
  /**
   * 初期化処理
   * @returns {Promise<void>}
   */
  init(): Promise<void>
  /**
   * index.json を読み込む
   * @returns {Promise<IndexFile|null>}
   */
  readIndex(): Promise<IndexFile | null>
  /**
   * index.json を書き込む
   * @param {IndexFile} index
   * @returns {Promise<void>}
   */
  writeIndex(_index: IndexFile): Promise<void>
  /**
   * ファイルコンテンツを保存
   * @param {string} filepath
   * @param {string} content
   * @returns {Promise<void>}
   */
  writeBlob(_filepath: string, _content: string): Promise<void>
  /**
   * ファイルコンテンツを読み出す
   * @param {string} filepath
   * @returns {Promise<string|null>}
   */
  readBlob(_filepath: string): Promise<string | null>
  /**
   * ファイルを削除する
   * @param {string} filepath
   * @returns {Promise<void>}
   */
  deleteBlob(_filepath: string): Promise<void>
}

/**
 * ファイルシステム上にデータを永続化する実装
 */
export class NodeFsStorage implements StorageBackend {
  private dir: string
  private indexPath: string
  /**
   * NodeFsStorage を初期化します。
   * @param {string} dir 永続化ディレクトリ
   */
  constructor(dir: string) {
    this.dir = dir
    this.indexPath = path.join(this.dir, 'index.json')
  }

  /**
   * ストレージ用ディレクトリを作成します。
   * @returns {Promise<void>}
   */
  async init() {
    await fs.mkdir(this.dir, { recursive: true })
  }

  /**
   * index.json を読み込みます。存在しなければ null を返します。
   * @returns {Promise<IndexFile|null>} 読み込んだ Index ファイル、または null
   */
  async readIndex() {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8')
      return JSON.parse(raw) as IndexFile
    } catch (err) {
      return null
    }
  }

  /**
   * index.json を書き込みます。
   * @param {IndexFile} index 書き込む Index データ
   * @returns {Promise<void>}
   */
  async writeIndex(index: IndexFile) {
    const data = JSON.stringify(index, null, 2)
    await fs.writeFile(this.indexPath, data, 'utf8')
  }

  /**
   * 指定パスへファイルを保存します。
   * @param {string} filepath ファイルパス
   * @param {string} content ファイル内容
   * @returns {Promise<void>}
   */
  async writeBlob(filepath: string, content: string) {
    const full = path.join(this.dir, filepath)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, 'utf8')
  }

  /**
   * 指定パスのファイルを読み出します。存在しなければ null を返します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readBlob(filepath: string) {
    try {
      const full = path.join(this.dir, filepath)
      return await fs.readFile(full, 'utf8')
    } catch (err) {
      return null
    }
  }

  /**
   * 指定パスのファイルを削除します。存在しない場合は無視されます。
   * @param {string} filepath ファイルパス
   * @returns {Promise<void>}
   */
  async deleteBlob(filepath: string) {
    try {
      const full = path.join(this.dir, filepath)
      await fs.unlink(full)
    } catch (err) {
      // ignore
    }
  }
}

// BrowserStorage: use OPFS when available, otherwise IndexedDB
/**
 * ブラウザ環境向けの永続化実装: OPFS を優先し、無ければ IndexedDB を使用する
 */
export class BrowserStorage implements StorageBackend {
  private dbName = 'apigit_storage'
  private dbPromise: Promise<IDBDatabase>

  /**
   * BrowserStorage を初期化します。内部で IndexedDB 接続を開始します。
   */
  constructor() {
    this.dbPromise = this.openDb()
  }

  /**
   * 初期化を待機します（IndexedDB の準備完了を待つ）。
   * @returns {Promise<void>}
   */
  async init() {
    await this.dbPromise
  }

  /**
   * IndexedDB を開き、データベースインスタンスを返します。
   * @returns {Promise<IDBDatabase>}
   */
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const idb = (globalThis as any).indexedDB
      if (!idb) return reject(new Error('IndexedDB is not available'))
      const req = idb.open(this.dbName, 1)
      /**
       * データベーススキーマの初期化
       */
      req.onupgradeneeded = (ev: any) => {
        const db = (ev.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        if (!db.objectStoreNames.contains('index')) db.createObjectStore('index')
      }
      // 成功時ハンドラ
      /**
       * ハンドラ（成功時） - 戻り値なし
       * @returns {void}
       */
      req.onsuccess = () => resolve(req.result)
      // エラー時ハンドラ
      /**
       * ハンドラ（エラー時） - 戻り値なし
       * @returns {void}
       */
      req.onerror = () => reject(req.error)
    })
  }

  /**
   * IndexedDB トランザクションをラップしてコールバックを実行します。
   * @param {string} storeName ストア名
   * @param {IDBTransactionMode} mode トランザクションモード
   * @param {(store: IDBObjectStore)=>void|Promise<void>} cb 実行コールバック
   * @returns {Promise<void>}
   */
  private async tx(storeName: string, mode: IDBTransactionMode, cb: (_store: IDBObjectStore) => void | Promise<void>) {
    const db = await this.dbPromise
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const storeObj = tx.objectStore(storeName)
      Promise.resolve(cb(storeObj)).then(() => {
        // トランザクション完了時ハンドラ
        /**
         * トランザクション完了時のコールバック（内部処理）
         * @returns {void}
         */
        tx.oncomplete = () => resolve()
        // トランザクションエラー時ハンドラ
        /**
         * トランザクションエラー時のコールバック（内部処理）
         * @returns {void}
         */
        tx.onerror = () => reject(tx.error)
      }).catch(reject)
    })
  }

  /**
   * index を IndexedDB から読み出します。
   * @returns {Promise<IndexFile|null>} 読み込んだ Index ファイル、または null
   */
  async readIndex() {
    const db = await this.dbPromise
    return new Promise<IndexFile | null>((resolve, reject) => {
      const tx = db.transaction('index', 'readonly')
      const store = tx.objectStore('index')
      const req = store.get('index')
      // onsuccess handler
      /**
       * onsuccess ハンドラ（内部処理） - 戻り値なし
       * @returns {void}
       */
      req.onsuccess = () => resolve(req.result ?? null)
      // onerror handler
      /**
       * onerror ハンドラ（内部処理） - 戻り値なし
       * @returns {void}
       */
      req.onerror = () => reject(req.error)
    })
  }

  /**
   * index を IndexedDB に書き込みます。
   * @param {IndexFile} index 書き込むデータ
   * @returns {Promise<void>}
   */
  async writeIndex(index: IndexFile) {
    await this.tx('index', 'readwrite', (store) => { store.put(index, 'index') })
  }

  /**
   * blob を書き込みます。OPFS がある場合は OPFS を優先して使用します。
   * @param {string} filepath ファイルパス
   * @param {string} content ファイル内容
   * @returns {Promise<void>}
   */
  async writeBlob(filepath: string, content: string) {
    // try OPFS if available
    // @ts-ignore
    const opfs = (globalThis as any).originPrivateFileSystem
    if (opfs && opfs.getFileHandle) {
      try {
        // naive OPFS write
        // @ts-ignore
        const root = await opfs.getDirectory()
        const parts = filepath.split('/')
        let dir = root
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectory(parts[i])
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true })
        const writable = await fh.createWritable()
        await writable.write(content)
        await writable.close()
        return
      } catch (e) {
        // fallthrough to indexeddb
      }
    }

    await this.tx('blobs', 'readwrite', (store) => { store.put(content, filepath) })
  }

  /**
   * 指定パスの blob を読み出します。存在しなければ null を返します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readBlob(filepath: string) {
    // try OPFS read
    // @ts-ignore
    const opfs = (globalThis as any).originPrivateFileSystem
    if (opfs && opfs.getFileHandle) {
      try {
        // @ts-ignore
        const root = await opfs.getDirectory()
        const parts = filepath.split('/')
        let dir = root
        for (let i = 0; i < parts.length - 1; i++) {
          dir = await dir.getDirectory(parts[i])
        }
        const fh = await dir.getFileHandle(parts[parts.length - 1])
        const file = await fh.getFile()
        return await file.text()
      } catch (e) {
        // fallback
      }
    }

    const db = await this.dbPromise
    return new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readonly')
      const store = tx.objectStore('blobs')
      const req = store.get(filepath)
      // onsuccess handler
      /**
       * onsuccess ハンドラ（内部処理） - 戻り値なし
       * @returns {void}
       */
      req.onsuccess = () => resolve(req.result ?? null)
      // onerror handler
      /**
       * onerror ハンドラ（内部処理） - 戻り値なし
       * @returns {void}
       */
      req.onerror = () => reject(req.error)
    })
  }

  /**
   * 指定パスの blob を削除します。
   * @param {string} filepath ファイルパス
   * @returns {Promise<void>}
   */
  async deleteBlob(filepath: string) {
    // delete from IndexedDB
    await this.tx('blobs', 'readwrite', (store) => { store.delete(filepath) })
  }
}
