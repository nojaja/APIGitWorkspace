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
import { GitHubAdapter, GitLabAdapter, VirtualFS, OpfsStorage, IndexedDbStorage } from 'browser-git-ops';

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
          <button id="connectOpfs">opfsStorageを接続</button>
          <button id="connectIndexedDb">IndexedDbStorageを接続</button>
          <button id="listAdapters">アダプタ情報を表示</button>
          <button id="pullRemote">リモート一覧を pull</button>
          <label>Remote Path: <input id="remotePath" style="width:420px" placeholder="path/to/file.txt"/></label>
          <button id="fetchRemoteFile">リモートファイルを fetch</button>
          <button id="remoteChanges">リモートで新しいファイル一覧 (チェンジセット)</button>
          <button id="addLocalFile">ローカルにファイルを追加</button>
          <button id="localChanges">ローカルの変更一覧を表示</button>
          <button id="pushLocal">ローカルのチェンジセットを push</button>
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

  // GETパラメータから repo / token をプリセットする (例: ?repo=https://github.com/owner/repo&token=xxx)
  try {
    const params = new URLSearchParams(location.search)
    const repoParam = (params.get('repo') || '').trim()
    const tokenParam = (params.get('token') || '').trim()
    if (repoParam) {
      repoInput.value = repoParam
      appendOutput('GETパラメータから repo を設定しました: ' + repoParam)
    }
    if (tokenParam) {
      tokenInput.value = tokenParam
      appendOutput('GETパラメータから token を設定しました: ' + (tokenParam ? '***' : '<未入力>'))
    }
  } catch (e) {
    appendOutput('GETパラメータ解析で例外: ' + String(e))
  }

  // 入力が変更されたら URL の GET パラメータを同期する
  function syncUrlParams(repoVal: string, tokenVal: string) {
    try {
      const u = new URL(location.href)
      const p = u.searchParams
      if (repoVal) p.set('repo', repoVal)
      else p.delete('repo')
      if (tokenVal) p.set('token', tokenVal)
      else p.delete('token')
      const qs = p.toString()
      const newUrl = u.pathname + (qs ? '?' + qs : '') + u.hash
      history.replaceState(null, '', newUrl)
    } catch (e) {
      // ここでは UI を汚さないため出力しないが、例外は console に残す
      console.error('syncUrlParams error', e)
    }
  }

  repoInput.addEventListener('input', () => {
    syncUrlParams((repoInput.value || '').trim(), (tokenInput.value || '').trim())
  })
  tokenInput.addEventListener('input', () => {
    syncUrlParams((repoInput.value || '').trim(), (tokenInput.value || '').trim())
  })

  // Use the bundled library at build time. This replaces runtime dynamic loading.
    // Use the bundled library at build time. Assemble `lib` from named imports.
    const lib: AnyLib = {
      GitHubAdapter: GitHubAdapter,
      GitLabAdapter: GitLabAdapter,
      VirtualFS: VirtualFS,
      OpfsStorage: OpfsStorage,
      IndexedDbStorage: IndexedDbStorage,
    }

  // keep a reference to the created vfs so other buttons reuse it
  let currentVfs: any | null = null
  let currentAdapter: any | null = null
  let currentPlatform: 'github' | 'gitlab' | null = null
  let currentOwner: string | null = null
  let currentRepoName: string | null = null

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
        currentPlatform = 'github'
        currentOwner = owner
        currentRepoName = repoName
        try {
          const gh = new lib.GitHubAdapter({ owner, repo: repoName, token })
          currentAdapter = gh
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
        currentPlatform = 'gitlab'
        currentOwner = owner
        currentRepoName = repoName
        try {
          // GitLabAdapter expects projectId (namespace/project)
          const projectId = `${owner}/${repoName}`
          const gl = new lib.GitLabAdapter({ projectId, token })
          currentAdapter = gl
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

  const connectOpfsBtn = el('connectOpfs') as HTMLButtonElement
  connectOpfsBtn.addEventListener('click', () => {
    ;(async () => {
      try {
        if (!lib.VirtualFS) {
          appendOutput('バンドルに VirtualFS が含まれていません')
          return
        }
        if (!lib.OpfsStorage) {
          appendOutput('バンドルに OpfsStorage が含まれていません')
          return
        }
        const backend = new lib.OpfsStorage()
        const vfs = new lib.VirtualFS({ backend })
        currentVfs = vfs
        appendOutput('VirtualFS を作成し OpfsStorage を接続しました')
        try {
          await vfs.init()
          appendOutput('VirtualFS.init() 実行済み (OpfsStorage)')
        } catch (e) {
          appendOutput('VirtualFS.init()/IO で例外: ' + String(e))
        }
      } catch (e) {
        appendOutput('OpfsStorage 接続で例外: ' + String(e))
      }
    })()
  })

  const connectIndexedDbBtn = el('connectIndexedDb') as HTMLButtonElement
  connectIndexedDbBtn.addEventListener('click', () => {
    ;(async () => {
      try {
        if (!lib.VirtualFS) {
          appendOutput('バンドルに VirtualFS が含まれていません')
          return
        }
        if (!lib.IndexedDbStorage) {
          appendOutput('バンドルに IndexedDbStorage が含まれていません')
          return
        }
        const backend = new lib.IndexedDbStorage()
        const vfs = new lib.VirtualFS({ backend })
        currentVfs = vfs
        appendOutput('VirtualFS を作成し IndexedDbStorage を接続しました')
        try {
          await vfs.init()
          appendOutput('VirtualFS.init() 実行済み (IndexedDbStorage)')
        } catch (e) {
          appendOutput('VirtualFS.init()/IO で例外: ' + String(e))
        }
      } catch (e) {
        appendOutput('IndexedDbStorage 接続で例外: ' + String(e))
      }
    })()
  })

  const listAdaptersBtn = el('listAdapters') as HTMLButtonElement
  listAdaptersBtn.addEventListener('click', () => {
    appendOutput('バンドルに含まれるエクスポート: ' + Object.keys(lib ?? {}).join(', '))
  })

  // スナップショット取得はアダプタ実装の fetchSnapshot() を使います。

  const pullRemoteBtn = el('pullRemote') as HTMLButtonElement
  pullRemoteBtn.addEventListener('click', async () => {
    appendOutput('リモートスナップショットを取得して pull を実行します...')
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    if (!currentPlatform || !currentOwner || !currentRepoName) { appendOutput('先に接続してください'); return }
    try {
      let data: any
      if (currentAdapter && typeof currentAdapter.fetchSnapshot === 'function') {
        data = await currentAdapter.fetchSnapshot()
      } else {
        appendOutput('アダプタに fetchSnapshot() が実装されていません'); return
      }
      // show remote snapshot summary
      const remotePaths = Object.keys(data.snapshot || {})
      appendOutput(`リモートファイル数: ${remotePaths.length}`)
      if (remotePaths.length > 0) {
        const first = remotePaths.slice(0, 20)
        appendOutput('リモート先頭ファイル: ' + first.join(', '))
        if (remotePaths.length > 20) appendOutput(`... 他 ${remotePaths.length - 20} 件`) 
      }
      const preIndexKeys = Object.keys(currentVfs.getIndex().entries)
      const res = await currentVfs.pull(data.headSha, data.snapshot)
      appendOutput('pull 完了。コンフリクト数: ' + (res.conflicts ? res.conflicts.length : 0))
      if (res.conflicts && res.conflicts.length > 0) {
        appendOutput('--- コンフリクト詳細 ---')
        for (const c of res.conflicts) {
          try {
            const path = c.path || '<不明>'
            appendOutput(`path: ${path}`)
            appendOutput(`  workspaceSha: ${c.workspaceSha ?? '<なし>'}`)
            appendOutput(`  baseSha: ${c.baseSha ?? '<なし>'}`)
            appendOutput(`  remoteSha: ${c.remoteSha ?? '<なし>'}`)
            // local workspace content (may be null)
            try {
              const localContent = await currentVfs.readFile(path)
              const lsnippet = localContent === null ? '<存在しない>' : (typeof localContent === 'string' ? localContent.slice(0, 400).replace(/\r?\n/g, '\\n') : String(localContent))
              appendOutput(`  local (workspace) snippet: ${lsnippet}`)
            } catch (e) {
              appendOutput(`  local read error: ${String(e)}`)
            }
            // remote snapshot content if available in fetched data
            try {
              const remoteContent = (data && data.snapshot && data.snapshot[path]) || null
              const rsn = remoteContent === null ? '<取得不可>' : (typeof remoteContent === 'string' ? remoteContent.slice(0, 400).replace(/\r?\n/g, '\\n') : String(remoteContent))
              appendOutput(`  remote snippet: ${rsn}`)
            } catch (e) {
              appendOutput(`  remote read error: ${String(e)}`)
            }
          } catch (err) {
            appendOutput('  コンフリクト表示で例外: ' + String(err))
          }
        }
        appendOutput('--- 以上 ---')
      }

      try {
        const postIndex = currentVfs.getIndex()
        const postKeys = Object.keys(postIndex.entries)
        // newly added index entries
        const preSet = new Set(preIndexKeys)
        const added = postKeys.filter((k) => !preSet.has(k))
        appendOutput('インデックス内ファイル数: ' + postKeys.length)
        if (postKeys.length > 0) {
          const first = postKeys.slice(0, 50)
          appendOutput('インデックス先頭ファイル: ' + first.join(', '))
        }
        appendOutput('pull で新規に登録されたファイル: ' + (added.length ? added.join(', ') : '<なし>'))
      } catch (e) {
        appendOutput('pull 後のインデックス表示で例外: ' + String(e))
      }
    } catch (e) {
      appendOutput('pull 失敗: ' + String(e))
    }
  })

  const fetchRemoteFileBtn = el('fetchRemoteFile') as HTMLButtonElement
  fetchRemoteFileBtn.addEventListener('click', async () => {
    const path = (el('remotePath') as HTMLInputElement).value.trim()
    if (!path) { appendOutput('Remote Path を入力してください'); return }
    if (!currentPlatform || !currentOwner || !currentRepoName) { appendOutput('先に接続してください'); return }
    try {
      if (currentAdapter && typeof currentAdapter.fetchSnapshot === 'function') {
        const { snapshot } = await currentAdapter.fetchSnapshot()
        if (snapshot[path] === undefined) { appendOutput('リモートに該当ファイルがありません'); return }
        appendOutput(`--- ${path} ---\n` + snapshot[path])
      } else {
        appendOutput('アダプタに fetchSnapshot() が実装されていません')
      }
    } catch (e) {
      appendOutput('fetchRemoteFile 失敗: ' + String(e))
    }
  })

  const remoteChangesBtn = el('remoteChanges') as HTMLButtonElement
  remoteChangesBtn.addEventListener('click', async () => {
    appendOutput('リモートとローカルの差分を取得します...')
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    if (!currentPlatform || !currentOwner || !currentRepoName) { appendOutput('先に接続してください'); return }
    try {
      let data: any
      if (currentAdapter && typeof currentAdapter.fetchSnapshot === 'function') {
        data = await currentAdapter.fetchSnapshot()
      } else {
        appendOutput('アダプタに fetchSnapshot() が実装されていません'); return
      }
      const remoteShas: Record<string,string> = {}
      for (const [p, c] of Object.entries(data.snapshot)) {
        // compute simple sha via TextEncoder + subtle digest
        const enc = new TextEncoder(); const buf = await crypto.subtle.digest('SHA-1', enc.encode(c as string)); const sha = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')
        remoteShas[p] = sha
      }
      const idx = currentVfs.getIndex()
      const diffs: string[] = []
      for (const [p, sha] of Object.entries(remoteShas)) {
        const entry = idx.entries[p]
        if (!entry) diffs.push(`added: ${p}`)
        else if (entry.baseSha !== sha) diffs.push(`updated: ${p}`)
      }
      appendOutput('リモート差分ファイル数: ' + diffs.length)
      if (diffs.length > 0) appendOutput(diffs.join('\n'))
    } catch (e) {
      appendOutput('remoteChanges 失敗: ' + String(e))
    }
  })

  const addLocalFileBtn = el('addLocalFile') as HTMLButtonElement
  addLocalFileBtn.addEventListener('click', async () => {
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    const path = prompt('作成するファイル名を入力してください（例: examples/new.txt）')
    if (!path) return
    const content = prompt('ファイル内容を入力してください', 'hello') || ''
      try {
      await currentVfs.writeFile(path, content)
      appendOutput(`ローカルにファイルを追加しました: ${path}`)
    } catch (e) { appendOutput('addLocalFile 失敗: ' + String(e)) }
  })

  const localChangesBtn = el('localChanges') as HTMLButtonElement
  localChangesBtn.addEventListener('click', async () => {
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    try {
      const changes = await currentVfs.getChangeSet()
      appendOutput('ローカル変更一覧:\n' + JSON.stringify(changes, null, 2))
    } catch (e) { appendOutput('localChanges 失敗: ' + String(e)) }
  })

  const pushLocalBtn = el('pushLocal') as HTMLButtonElement
  pushLocalBtn.addEventListener('click', async () => {
    appendOutput('ローカルのチェンジセットをリモートに push します...')
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    if (!currentAdapter) { appendOutput('先にアダプタを接続してください'); return }
    try {
      const changes = await currentVfs.getChangeSet()
      if (!changes || changes.length === 0) { appendOutput('Push する変更がありません'); return }
      const idx = currentVfs.getIndex()
      const input = { parentSha: idx.head || '', message: 'Example push from UI', changes }
      const res = await currentVfs.push(input, currentAdapter)
      appendOutput('push 成功: ' + JSON.stringify(res))
    } catch (e) { appendOutput('pushLocal 失敗: ' + String(e)) }
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
              const content = await currentVfs.readFile(p)
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
