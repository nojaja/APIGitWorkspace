export interface Change {
  type: 'create' | 'update' | 'delete'
  path: string
  content?: string
  baseSha?: string
}

export interface CommitResult {
  commitSha: string
}

export interface GitAdapter {
  // create blobs for create/update changes, returns map path->blobSha
  createBlobs(_changes: Change[], _concurrency?: number): Promise<Record<string, string>>
  // create tree from changes, returns treeSha
  createTree(_changes: Change[], _baseTreeSha?: string): Promise<string>
  // create commit
  createCommit(_message: string, _parentSha: string, _treeSha: string): Promise<string>
  // update ref to point to commit
  updateRef(_reference: string, _commitSha: string, _force?: boolean): Promise<void>
}
