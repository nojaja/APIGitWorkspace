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
        <label>Platform: 
          <select id="platformSelect" style="width:140px">
            <option value="auto">auto</option>
            <option value="github">github</option>
            <option value="gitlab">gitlab</option>
          </select>
        </label>
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
          <button id="resolveConflict">競合を解消済にする</button>
          <button id="remoteChanges">リモートで新しいファイル一覧 (チェンジセット)</button>
          <button id="addLocalFile">ローカルにファイルを追加</button>
          <button id="localChanges">ローカルの変更一覧を表示</button>
          <button id="pushLocal">ローカルのチェンジセットを push</button>
            <button id="editAndPush">既存ファイルを編集</button>
            <button id="deleteAndPush">既存ファイルを削除</button>
            <button id="renameAndPush">既存ファイルを名前変更</button>
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
  const platformSelect = el('platformSelect') as HTMLSelectElement

  // GETパラメータから repo / token / platform をプリセットする (例: ?repo=https://github.com/owner/repo&token=xxx&platform=gitlab)
  try {
    const params = new URLSearchParams(location.search)
    const repoParam = (params.get('repo') || '').trim()
    const tokenParam = (params.get('token') || '').trim()
    const platformParam = (params.get('platform') || '').trim()
    if (repoParam) {
      repoInput.value = repoParam
      appendOutput('GETパラメータから repo を設定しました: ' + repoParam)
    }
    if (tokenParam) {
      tokenInput.value = tokenParam
      appendOutput('GETパラメータから token を設定しました: ' + (tokenParam ? '***' : '<未入力>'))
    }
    if (platformParam) {
      // validate value
      if (['auto', 'github', 'gitlab'].includes(platformParam)) {
        platformSelect.value = platformParam
        appendOutput('GETパラメータから platform を設定しました: ' + platformParam)
      } else {
        appendOutput('GETパラメータの platform が無効です: ' + platformParam)
      }
    }
  } catch (e) {
    appendOutput('GETパラメータ解析で例外: ' + String(e))
  }

  // 入力が変更されたら URL の GET パラメータを同期する
  function syncUrlParams(repoVal: string, tokenVal: string, platformVal?: string) {
    try {
      const u = new URL(location.href)
      const p = u.searchParams
      if (repoVal) p.set('repo', repoVal)
      else p.delete('repo')
      if (tokenVal) p.set('token', tokenVal)
      else p.delete('token')
      if (typeof platformVal !== 'undefined') {
        if (platformVal) p.set('platform', platformVal)
        else p.delete('platform')
      }
      const qs = p.toString()
      const newUrl = u.pathname + (qs ? '?' + qs : '') + u.hash
      history.replaceState(null, '', newUrl)
    } catch (e) {
      // ここでは UI を汚さないため出力しないが、例外は console に残す
      console.error('syncUrlParams error', e)
    }
  }

  repoInput.addEventListener('input', () => {
    syncUrlParams((repoInput.value || '').trim(), (tokenInput.value || '').trim(), (platformSelect.value || '').trim())
  })
  tokenInput.addEventListener('input', () => {
    syncUrlParams((repoInput.value || '').trim(), (tokenInput.value || '').trim(), (platformSelect.value || '').trim())
  })
  platformSelect.addEventListener('change', () => {
    syncUrlParams((repoInput.value || '').trim(), (tokenInput.value || '').trim(), (platformSelect.value || '').trim())
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
      // Parse URL to support self-hosted instances as well as github.com/gitlab.com
      let parsed: URL | null = null
      try {
        parsed = new URL(repo)
      } catch (err) {
        parsed = null
      }

      if (!parsed) {
        appendOutput('無効な URL です。例: https://github.com/owner/repo')
        return
      }

      // Normalize path segments and strip trailing .git
        const path = parsed.pathname.replace(/(^\/+|\/+$)/g, '')
      const rawSegments = path ? path.split('/') : []
      const segments = rawSegments.map((s) => s.replace(/\.git$/i, ''))

      // Heuristics to choose platform:
      // - hostname contains 'gitlab' => GitLab
      // - hostname contains 'github' => GitHub
      // - token prefix 'glpat_' => GitLab, 'ghp_' => GitHub
      // - nested path (>=3 segments) => likely GitLab (groups/subgroups)
      // - otherwise (2 segments) => GitHub by default
      const hostname = (parsed.hostname || '').toLowerCase()
      const tokenHint = (token || '')
      let chosen: 'github' | 'gitlab' | null = null
      // If user explicitly selected platform, respect it
      const platformOverride = (platformSelect && platformSelect.value) ? (platformSelect.value as string) : 'auto'
      if (platformOverride === 'github' || platformOverride === 'gitlab') {
        chosen = platformOverride as 'github' | 'gitlab'
      } else {
        if (hostname.includes('gitlab')) chosen = 'gitlab'
        else if (hostname.includes('github')) chosen = 'github'
        else if (tokenHint.startsWith('glpat_')) chosen = 'gitlab'
        else if (tokenHint.startsWith('ghp_')) chosen = 'github'
        else if (segments.length >= 3) chosen = 'gitlab'
        else if (segments.length === 2) chosen = 'github'
      }

      if (chosen === 'github' && lib.GitHubAdapter) {
        const owner = segments[0] || ''
        const repoName = segments[1] || ''
        if (!owner || !repoName) {
          appendOutput('GitHub 用の owner/repo が URL から取得できませんでした')
        } else {
          currentPlatform = 'github'
          currentOwner = owner
          currentRepoName = repoName
          try {
            // For GitHub Enterprise/self-hosted, prefer API base at origin + '/api/v3'
            let hostForApi: string | undefined = undefined
            if (!/github\.com$/i.test(hostname)) {
              // assume enterprise => use API v3 path
              hostForApi = `${parsed.protocol}//${parsed.host}/api/v3`
            }
            const ghOpts: any = { owner, repo: repoName, token }
            if (hostForApi) ghOpts.host = hostForApi
            const gh = new lib.GitHubAdapter(ghOpts)
            currentAdapter = gh
            appendOutput('GitHubAdapter 作成: ' + gh.constructor.name)
          } catch (e) {
            appendOutput('GitHubAdapter の初期化で例外: ' + String(e))
          }
        }
      } else if (chosen === 'gitlab' && lib.GitLabAdapter) {
        if (segments.length < 2) {
          appendOutput('GitLab 用の namespace/project が URL から取得できませんでした')
        } else {
          // projectId should be full namespace path (group[/subgroup]/project)
          const projectId = segments.join('/')
          currentPlatform = 'gitlab'
          currentOwner = segments.slice(0, -1).join('/') || null
          currentRepoName = segments[segments.length - 1] || null
          try {
            const glOpts: any = { projectId, token }
            // For self-hosted GitLab, use origin as host so GitLabAdapter will append /api/v4
            if (!/gitlab\.com$/i.test(hostname)) glOpts.host = `${parsed.protocol}//${parsed.host}`
            const gl = new lib.GitLabAdapter(glOpts)
            currentAdapter = gl
            appendOutput('GitLabAdapter 作成: ' + gl.constructor.name)
          } catch (e) {
            appendOutput('GitLabAdapter の初期化で例外: ' + String(e))
          }
        }
      } else {
        appendOutput('対応しているリポジトリ URL ではありません（GitHub/GitLab の形式を指定してください）')
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
      const totalConflicts = res.conflicts ? res.conflicts.length : 0
      // count conflicts where baseSha === remoteSha (already-resolved)
      let resolvedConflicts = 0
      if (res.conflicts && res.conflicts.length > 0) {
        for (const c of res.conflicts) {
          if (c.baseSha && c.remoteSha && c.baseSha === c.remoteSha) resolvedConflicts++
        }
      }
      appendOutput('pull 完了。コンフリクト数: ' + totalConflicts)
      if (resolvedConflicts > 0) appendOutput('解決済コンフリクト数: ' + resolvedConflicts)
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

  const resolveConflictBtn = el('resolveConflict') as HTMLButtonElement
  resolveConflictBtn.addEventListener('click', async () => {
    const path = (el('remotePath') as HTMLInputElement).value.trim() || prompt('競合を解消するファイル名を入力してください（例: examples/new.txt）')
    if (!path) return
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    try {
      if (typeof currentVfs.resolveConflict === 'function') {
        const ok = await currentVfs.resolveConflict(path)
        if (ok) appendOutput(`競合を解消しました: ${path}`)
        else appendOutput(`競合ファイルが見つからないか削除に失敗しました: ${path}`)
      } else {
        appendOutput('VirtualFS に resolveConflict() が実装されていません')
      }
    } catch (e) {
      appendOutput('resolveConflict 失敗: ' + String(e))
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

  // --- Edit / Delete / Rename existing file and push to remote ---
  const editAndPushBtn = el('editAndPush') as HTMLButtonElement
  editAndPushBtn.addEventListener('click', async () => {
    appendOutput('既存ファイルの編集 & push を開始します...')
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    if (!currentAdapter) { appendOutput('先にアダプタを接続してください'); return }
    try {
      const defaultPath = (el('remotePath') as HTMLInputElement).value.trim()
      const path = defaultPath || prompt('編集するファイルのパスを入力してください（例: examples/file.txt）') || ''
      if (!path) return
      const existing = await currentVfs.readFile(path)
      const newContent = prompt('新しいファイル内容を入力してください', existing === null ? '' : String(existing))
      if (newContent === null) return
      await currentVfs.writeFile(path, newContent)
      appendOutput(`ローカル編集しました: ${path}`)

      const changes = await currentVfs.getChangeSet()
      appendOutput('ローカル変更一覧 (編集後):\n' + JSON.stringify(changes, null, 2))
    } catch (e) {
      appendOutput('editAndPush 失敗: ' + String(e))
    }
  })

  const deleteAndPushBtn = el('deleteAndPush') as HTMLButtonElement
  deleteAndPushBtn.addEventListener('click', async () => {
    appendOutput('既存ファイルの削除 & push を開始します...')
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    if (!currentAdapter) { appendOutput('先にアダプタを接続してください'); return }
    try {
      const defaultPath = (el('remotePath') as HTMLInputElement).value.trim()
      const path = defaultPath || prompt('削除するファイルのパスを入力してください（例: examples/file.txt）') || ''
      if (!path) return
      const ok = confirm(`本当に削除しますか: ${path}`)
      if (!ok) return
      await currentVfs.deleteFile(path)
      appendOutput(`ローカルで削除しました（トゥームストーンまたはインデックスから除去）: ${path}`)

      const changes = await currentVfs.getChangeSet()
      appendOutput('ローカル変更一覧 (削除後):\n' + JSON.stringify(changes, null, 2))
    } catch (e) {
      appendOutput('deleteAndPush 失敗: ' + String(e))
    }
  })

  const renameAndPushBtn = el('renameAndPush') as HTMLButtonElement
  renameAndPushBtn.addEventListener('click', async () => {
    appendOutput('既存ファイルの名前変更 & push を開始します...')
    if (!currentVfs) { appendOutput('先に VirtualFS を初期化してください'); return }
    if (!currentAdapter) { appendOutput('先にアダプタを接続してください'); return }
    try {
      const defaultFrom = (el('remotePath') as HTMLInputElement).value.trim()
      const from = defaultFrom || prompt('変更元のファイルパスを入力してください（例: examples/old.txt）') || ''
      if (!from) return
      const to = prompt('新しいファイル名を入力してください（例: examples/new.txt）') || ''
      if (!to) return
      await currentVfs.renameFile(from, to)
      appendOutput(`ローカルでリネームしました: ${from} -> ${to}`)

      const changes = await currentVfs.getChangeSet()
      appendOutput('ローカル変更一覧 (リネーム後):\n' + JSON.stringify(changes, null, 2))
    } catch (e) {
      appendOutput('renameAndPush 失敗: ' + String(e))
    }
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
