import type { StorageBackend } from './storageBackend.ts'

const WORKSPACE = 'workspace'
const BASE = 'base'
const INFO = 'info'
const INFO_WORKSPACE = 'info-workspace'
const INFO_GIT = 'info-git'

/**
 * ローカルファイル操作のラッパー
 */
export class LocalFileManager {
  private backend: StorageBackend

  /**
   * コンストラクタ
   * @param {StorageBackend} backend - ストレージバックエンド
   */
  constructor(backend: StorageBackend) {
    this.backend = backend
  }

  /**
   * ファイルを書き込む（workspace領域）
   * @param {string} filepath - ファイルパス
   * @param {string} content - 書き込む内容
   * @returns {Promise<void>}
   */
  async writeFile(filepath: string, content: string): Promise<void> {
    await this.backend.writeBlob(filepath, content, WORKSPACE)
  }

  /**
   * git に残る info を元に workspace 用のトンブストーンを作成して書き込む
   * @param {string} filepath - ファイルパス
   * @returns {Promise<void>}
   */
  private async _writeTombstoneFromGit(filepath: string): Promise<void> {
    const gitInfoTxt = await this.backend.readBlob(filepath, INFO_GIT)
    let gitInfo: any = {}
    if (gitInfoTxt) {
      try {
        gitInfo = JSON.parse(gitInfoTxt)
      } catch (_error) {
        gitInfo = {}
      }
    }
    gitInfo.state = 'deleted'
    gitInfo.updatedAt = Date.now()
    await this.backend.writeBlob(filepath, JSON.stringify(gitInfo), INFO_WORKSPACE)
  }

  /**
   * ワークスペースの info をトンブストーン状態に更新して書き込む
   * @param {string} filepath - ファイルパス
   * @returns {Promise<void>}
   */
  private async _writeWorkspaceTombstone(filepath: string): Promise<void> {
    const existingWorkspaceInfoTxt = await this.backend.readBlob(filepath, INFO)
    let existingWorkspaceInfo: any = {}
    if (existingWorkspaceInfoTxt) {
      try {
        existingWorkspaceInfo = JSON.parse(existingWorkspaceInfoTxt)
      } catch (_error) {
        existingWorkspaceInfo = {}
      }
    }
    existingWorkspaceInfo.state = 'deleted'
    existingWorkspaceInfo.updatedAt = Date.now()
    await this.backend.writeBlob(filepath, JSON.stringify(existingWorkspaceInfo), INFO_WORKSPACE)
  }

  /**
   * info 関連のエントリを削除する（best-effort）
   * @param {string} filepath - ファイルパス
   * @returns {Promise<void>}
   */
  private async _deleteInfos(filepath: string): Promise<void> {
    await this.backend.deleteBlob(filepath, INFO_WORKSPACE)
    await this.backend.deleteBlob(filepath, INFO)
  }

  /**
   * ファイルを削除する（workspace と info をクリア）
   * @param {string} filepath - ファイルパス
   * @returns {Promise<void>}
   */
  async deleteFile(filepath: string): Promise<void> {
    const gitBase = await this.backend.readBlob(filepath, BASE)
    // read existing unprefixed info (workspace-local info) to decide action
    const existingInfoTxt = await this.backend.readBlob(filepath, INFO)

    // remove workspace cache first to avoid accidental deletion of newly written workspace-info
    await this.backend.deleteBlob(filepath, WORKSPACE)

    try {
      if (gitBase !== null) {
        // preserve git-scoped info, but create a workspace tombstone derived from git info
        await this._writeTombstoneFromGit(filepath)
        return
      }
      // If there was an existing workspace-local info entry, persist a workspace tombstone
      // so the deletion is recorded locally. Otherwise remove info entries entirely so
      // the entry disappears (covers add-then-delete-before-base case).
      if (existingInfoTxt !== null) {
        await this._writeWorkspaceTombstone(filepath)
        return
      }
      await this._deleteInfos(filepath)
    } catch (_error) {
      // best-effort: ignore and finish
    }
  }

  /**
   * ワークスペースまたはベースからファイルを読み出す
   * @param {string} filepath - ファイルパス
   * @returns {Promise<string|null>} ファイル内容または null
   */
  async readFile(filepath: string): Promise<string | null> {
    const wsBlob = await this.backend.readBlob(filepath, WORKSPACE)
    if (wsBlob !== null) return wsBlob
    const baseBlob = await this.backend.readBlob(filepath, BASE)
    if (baseBlob !== null) return baseBlob
    return null
  }

  /**
   * ファイルをリネームする（内容をコピーして元を削除）
   * @param {string} from - 元パス
   * @param {string} to - 先パス
   * @returns {Promise<void>}
   */
  async renameFile(from: string, to: string): Promise<void> {
    const content = await this.readFile(from)
    if (content === null) throw new Error('Source file not found')
    await this.writeFile(to, content)
    await this.deleteFile(from)
  }
}

export default LocalFileManager
