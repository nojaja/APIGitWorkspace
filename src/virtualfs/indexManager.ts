import type { StorageBackend } from './storageBackend.ts'
import { IndexFile } from './types.ts'

/**
 * インデックス管理クラス
 */
export class IndexManager {
  private backend: StorageBackend
  private head: string = ''
  private lastCommitKey: string | undefined

  /**
   * コンストラクタ
   * @param {StorageBackend} backend - ストレージバックエンド
   */
  constructor(backend: StorageBackend) {
    this.backend = backend
  }

  /**
   * インデックスをストレージから読み込む
   * @returns {Promise<void>}
   */
  async loadIndex(): Promise<void> {
    try {
      const raw = await this.backend.readIndex()
      if (raw) {
        this.head = raw.head || ''
        this.lastCommitKey = (raw as any).lastCommitKey
      }
    } catch (error) {
      this.head = ''
      this.lastCommitKey = undefined
      await this.saveIndex()
    }
  }

  /**
   * インデックスをストレージへ書き込む
   * @returns {Promise<void>}
   */
  async saveIndex(): Promise<void> {
    // Preserve existing top-level fields (such as adapter metadata) when saving
    const existing = (await this.backend.readIndex()) || { head: this.head, entries: {} }
    const index: IndexFile = { ...(existing as any) }
    index.head = this.head
    if (this.lastCommitKey) (index as any).lastCommitKey = this.lastCommitKey
    else delete (index as any).lastCommitKey
    await this.backend.writeIndex(index)
  }

  /**
   * 現在のheadを返す
   * @returns {string}
   */
  getHead(): string {
    return this.head
  }

  /**
   * headを設定する
   * @param {string} h - head文字列
   */
  setHead(h: string): void {
    this.head = h
  }

  /**
   * 最後のコミットキーを返す
   * @returns {string|undefined}
   */
  getLastCommitKey(): string | undefined {
    return this.lastCommitKey
  }

  /**
   * 最後のコミットキーを設定する
   * @param {string|undefined} k - コミットキー
   */
  setLastCommitKey(k: string | undefined): void {
    this.lastCommitKey = k
  }

  /**
   * 現在のインデックスを取得する（Proxyでheadを委譲）
   * @returns {Promise<IndexFile>} インデックスオブジェクト
   */
  async getIndex(): Promise<IndexFile> {
    const index = await this.backend.readIndex()
    const base = index || { head: this.head, entries: {} }
    const self = this
    return new Proxy(base, {
      /**
       * Proxy get handler
       * @param {any} target - 元オブジェクト
       * @param {string|symbol} property - 取得プロパティ
       * @returns {any}
       */
      get(target, property: string | symbol) {
        if (property === 'head') return self.head || (target as any).head
        return (target as any)[property]
      },
      /**
       * Proxy set handler
       * @param {any} target - 元オブジェクト
       * @param {string|symbol} property - 設定プロパティ
       * @param {any} value - 設定値
       * @returns {boolean}
       */
      set(target, property: string | symbol, value) {
        if (property === 'head') {
          self.head = value as string
        }
        (target as any)[property] = value
        return true
      }
    }) as IndexFile
  }

  /**
   * info に存在する全パスを列挙する
   * @returns {Promise<string[]>} パスの配列
   */
  async listPaths(): Promise<string[]> {
    const infos = await this.backend.listFiles(undefined, 'info')
    const out: string[] = []
    for (const it of infos) {
      // Exclude explicit tombstones (state: 'deleted') from visible paths
      try {
        if (it.info) {
          const parsed = JSON.parse(it.info)
          if (parsed && parsed.state === 'deleted') continue
        }
      } catch (_error) {
        // ignore parse errors and include the path
      }
      out.push(it.path)
    }
    return out
  }
}

export default IndexManager
