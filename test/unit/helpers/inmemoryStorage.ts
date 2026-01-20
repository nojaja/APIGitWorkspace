import { IndexFile } from '../../../src/virtualfs/types'

export class InMemoryStorage {
  private index: IndexFile = { head: '', entries: {} }
  private blobs: Map<string, string> = new Map()
  constructor(_dir?: string) {
    // accept dir for compatibility but ignore
  }
  async init() {
    return
  }
  async readIndex() {
    return this.index
  }
  async writeIndex(idx: IndexFile) {
    this.index = idx
  }
  async writeBlob(filepath: string, content: string) {
    this.blobs.set(filepath, content)
  }
  async readBlob(filepath: string) {
    return this.blobs.has(filepath) ? this.blobs.get(filepath)! : null
  }
  async deleteBlob(filepath: string) {
    this.blobs.delete(filepath)
  }
}

export default InMemoryStorage
