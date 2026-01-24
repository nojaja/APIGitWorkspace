import { VirtualFS, GitHubAdapter, GitLabAdapter } from '../../dist/index.js'

async function main() {
  console.log('ライブラリ利用例: VirtualFS とアダプタを初期化します')

  // VirtualFS の初期化（簡易例）
  try {
    const vfs = new VirtualFS()
    console.log('VirtualFS created:', typeof vfs === 'object')
  } catch (err) {
    console.error('VirtualFS 初期化時エラー:', err)
  }

  // GitHubAdapter の初期化例（ダミー設定）
  try {
    const gh = new GitHubAdapter({ token: 'dummy-token', owner: 'example', repo: 'demo-repo' })
    console.log('GitHubAdapter created:', gh.constructor.name)
  } catch (err) {
    console.error('GitHubAdapter 初期化時エラー (想定される動作です):', err)
  }

  // GitLabAdapter の初期化例（ダミー設定）
  try {
    const gl = new GitLabAdapter({ token: 'dummy-token', projectId: '123' })
    console.log('GitLabAdapter created:', gl.constructor.name)
  } catch (err) {
    console.error('GitLabAdapter 初期化時エラー (想定される動作です):', err)
  }
}

main().catch((e) => console.error('例外:', e))
