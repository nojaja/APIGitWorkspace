// Simple web UI that lets the user enter GitHub/GitLab repo and token
// and demonstrates creating instances from the library bundle.
// Loading strategy:
// 1. Prefer `window.APIGitLib` if already injected.
// 2. Try dynamic import of the built `../../dist/index.js`.
// 3. Fall back to a lightweight `./lib-shim` for demo when the real bundle
//    is not available in the served assets.

type AnyLib = any;

// Import library source directly so esbuild will include it in the examples bundle.
// Import library source so esbuild bundles proper ESM exports (GitHubAdapter/GitLabAdapter/VirtualFS)
// Import named exports and assemble a `lib` object so properties are present at runtime.
import { GitHubAdapter, GitLabAdapter, VirtualFS } from 'browser-git-ops';

function el(id: string) { return document.getElementById(id)! }

function renderUI() {
  document.body.innerHTML = `
    <div style="font-family:Segoe UI,Meiryo,sans-serif;max-width:900px;margin:24px;">
      <h1>browser-git-ops - サンプル UI</h1>
      <p>GitHub/GitLab のリポジトリ情報と Personal Access Token を入力してライブラリを試せます（ダミーでも可）。</p>

      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
        <label>Repository URL: <input id="repoInput" style="width:420px" placeholder="https://github.com/owner/repo"/></label>
        <label>Token: <input id="tokenInput" style="width:300px" placeholder="ghp_xxx or glpat_xxx"/></label>
        <button id="connectBtn">接続してインスタンス作成</button>
      </div>

      <section style="margin-top:18px">
        <h2>結果</h2>
        <pre id="output" style="background:#f7f7f8;padding:12px;border-radius:6px;min-height:120px;white-space:pre-wrap"></pre>
      </section>

      <section style="margin-top:18px">
        <h2>操作</h2>
        <button id="initVfs">VirtualFS を初期化</button>
        <button id="listAdapters">アダプタ情報を表示</button>
        <button id="showSnapshot">スナップショット一覧表示</button>
      </section>
    </div>
  `
}

function appendOutput(text: string) {
  const out = el('output') as HTMLPreElement
  out.textContent = out.textContent + text + '\n'
}

async function main() {
  renderUI()

  const connectBtn = el('connectBtn') as HTMLButtonElement
  const repoInput = el('repoInput') as HTMLInputElement
  const tokenInput = el('tokenInput') as HTMLInputElement

  // Use the bundled library at build time. This replaces runtime dynamic loading.
    // Use the bundled library at build time. Assemble `lib` from named imports.
    const lib: AnyLib = {
      GitHubAdapter: GitHubAdapter,
      GitLabAdapter: GitLabAdapter,
      VirtualFS: VirtualFS,
      default: VirtualFS
    }

  // keep a reference to the created vfs so other buttons reuse it
  let currentVfs: any | null = null

  connectBtn.addEventListener('click', async () => {
    appendOutput('接続を試みます...')
    const repo = repoInput.value.trim()
    const token = tokenInput.value.trim()
    appendOutput(`入力: repo=${repo || '<未入力>'} token=${token ? '***' : '<未入力>'}`)

    try {
      // GitHub: https://github.com/owner/repo
      const ghMatch = repo.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)/i)
      if (ghMatch && lib.GitHubAdapter) {
        const owner = ghMatch[1]
        const repoName = ghMatch[2]
        try {
          const gh = new lib.GitHubAdapter({ owner, repo: repoName, token })
          appendOutput('GitHubAdapter 作成: ' + gh.constructor.name)
        } catch (e) {
          appendOutput('GitHubAdapter の初期化で例外: ' + String(e))
        }
        // NOTE: manual GitHub API fetch removed — UI uses library adapters only
      }

      // GitLab: https://gitlab.com/namespace/project
      const glMatch = repo.match(/^https?:\/\/(?:www\.)?gitlab\.com\/(.+?)\/(.+?)(?:$|\/)*/i)
      if (glMatch && lib.GitLabAdapter) {
        const owner = glMatch[1]
        const repoName = glMatch[2]
        try {
          const gl = new lib.GitLabAdapter({ owner, repo: repoName, token })
          appendOutput('GitLabAdapter 作成: ' + gl.constructor.name)
        } catch (e) {
          appendOutput('GitLabAdapter の初期化で例外: ' + String(e))
        }
        // NOTE: manual GitLab API fetch removed — UI uses library adapters only
      }

      if (!ghMatch && !glMatch) {
        appendOutput('対応しているリポジトリ URL ではありません（github.com または gitlab.com）')
      }
    } catch (e) {
      appendOutput('接続処理で例外: ' + String(e))
    }
  })

  const initVfsBtn = el('initVfs') as HTMLButtonElement
  initVfsBtn.addEventListener('click', () => {
    ;(async () => {
      try {
        if (!lib.VirtualFS) {
          appendOutput('バンドルに VirtualFS が含まれていません')
          return
        }
        const vfs = currentVfs ?? new lib.VirtualFS()
        if (!currentVfs) currentVfs = vfs
        appendOutput('VirtualFS 作成: インスタンス OK')
        try {
          await vfs.init()
          appendOutput('VirtualFS.init() 実行済み（IndexedDB/OPFS 初期化）')
          const hasOPFS = !!(globalThis as any).originPrivateFileSystem
          appendOutput('OPFS 利用可: ' + String(hasOPFS))
          await vfs.writeWorkspace('examples/demo.txt', 'hello from examples')
          const txt = await vfs.readWorkspace('examples/demo.txt')
          appendOutput('デモファイル読み書き結果: ' + String(txt))
        } catch (e) {
          appendOutput('VirtualFS.init()/IO で例外: ' + String(e))
        }
      } catch (e) {
        appendOutput('VirtualFS 初期化で例外: ' + String(e))
      }
    })()
  })

  const listAdaptersBtn = el('listAdapters') as HTMLButtonElement
  listAdaptersBtn.addEventListener('click', () => {
    appendOutput('バンドルに含まれるエクスポート: ' + Object.keys(lib ?? {}).join(', '))
  })

  const showSnapshotBtn = el('showSnapshot') as HTMLButtonElement
  showSnapshotBtn.addEventListener('click', () => {
    ;(async () => {
      try {
        if (!currentVfs) {
          appendOutput('スナップショットがロードされていません（先に接続して repository を読み込んでください）')
          return
        }
        appendOutput('スナップショット内のパス一覧を取得しています...')
        try {
          const paths: string[] = currentVfs.listPaths ? await currentVfs.listPaths() : []
          if (!paths || paths.length === 0) {
            appendOutput('スナップショットにファイルは存在しません')
            return
          }
          appendOutput('ファイル数: ' + paths.length)
          for (const p of paths) {
            try {
              const content = await currentVfs.readWorkspace(p)
              const snippet = typeof content === 'string' ? content.slice(0, 200).replace(/\r?\n/g, '\\n') : String(content)
              appendOutput(`- ${p} : ${snippet}`)
            } catch (e) {
              appendOutput(`- ${p} : <読み取り失敗> ${String(e)}`)
            }
          }
        } catch (e) {
          appendOutput('スナップショット一覧取得で例外: ' + String(e))
        }
      } catch (e) {
        appendOutput('一覧表示処理で例外: ' + String(e))
      }
    })()
  })
}

// 自動起動
main().catch((e) => console.error(e))
