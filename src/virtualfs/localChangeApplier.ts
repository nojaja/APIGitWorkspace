import type { StorageBackend } from './storageBackend.ts'

/**
 *
 */
export class LocalChangeApplier {
  private backend: StorageBackend

  /**
   *
   */
  constructor(backend: StorageBackend) {
    this.backend = backend
  }

  /**
   *
   */
  async applyCreateOrUpdate(ch: any) {
    // Ensure workspace copy is removed first (delete may remove all segments),
    // then persist base blob so it remains.
    await this.backend.deleteBlob(ch.path, 'workspace')
    await this.backend.writeBlob(ch.path, ch.content, 'base')
  }

  /**
   *
   */
  async applyDelete(ch: any) {
    await this.backend.deleteBlob(ch.path, 'info')
    // Backend manages base segment; remove blobs from backend
    await this.backend.deleteBlob(ch.path)
    await this.backend.deleteBlob(ch.path, 'workspace')
  }
}

export default LocalChangeApplier
