import { GitAdapter } from './adapter'
import crypto from 'crypto'

type GLOpts = { projectId: string; token: string; host?: string }

export class GitLabAdapter implements GitAdapter {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(private opts: GLOpts) {
    const host = opts.host || 'https://gitlab.com'
    this.baseUrl = `${host}/api/v4/projects/${encodeURIComponent(opts.projectId)}`
    this.headers = { 'PRIVATE-TOKEN': opts.token, 'Content-Type': 'application/json' }
  }

  private shaOf(content: string) {
    return crypto.createHash('sha1').update(content, 'utf8').digest('hex')
  }

  async createBlobs(changes: any[]) {
    const map: Record<string, string> = {}
    for (const c of changes) {
      if (c.type === 'create' || c.type === 'update') map[c.path] = this.shaOf(c.content)
    }
    return map
  }

  async createTree(_changes: any[], _baseTreeSha?: string) {
    return `gitlab-tree-${Date.now()}`
  }

  async createCommit(message: string, parentSha: string, _treeSha: string) {
    return parentSha
  }

  async createCommitWithActions(branch: string, message: string, changes: Array<{ type: string; path: string; content?: string }>) {
    const url = `${this.baseUrl}/repository/commits`
    const actions = changes.map((c) => {
      if (c.type === 'delete') return { action: 'delete', file_path: c.path }
      if (c.type === 'create') return { action: 'create', file_path: c.path, content: c.content }
      return { action: 'update', file_path: c.path, content: c.content }
    })
    const body = JSON.stringify({ branch, commit_message: message, actions })
    const res = await fetch(url, { method: 'POST', headers: this.headers, body })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`GitLab commit failed: ${res.status} ${txt}`)
    }
    const j = await res.json()
    return j.id || j.commit || j
  }

  async updateRef(_ref: string, _commitSha: string, _force = false) {
    // Not required when using commits API
  }
}

export default GitLabAdapter
