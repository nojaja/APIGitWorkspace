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
import * as GitOpsLib from 'browser-git-ops';

function el(id: string) { return document.getElementById(id)! }

function renderUI() {
  document.body.innerHTML = `
    <div style="font-family:Segoe UI,Meiryo,sans-serif;max-width:900px;margin:24px;">
      <h1>browser-git-ops - サンプル UI</h1>
      <p>GitHub/GitLab のリポジトリ情報と Personal Access Token を入力してライブラリを試せます。</p>

      <section style="margin-top:18px">
        <h2>Storage: availableRoots</h2>
        <div style="display:flex;gap:12px;align-items:flex-start;">
          <div style="flex:1">
            <h3 style="margin:6px 0">OPFS</h3><button id="connectOpfs">opfsStorageを追加</button><button id="opfsRoots">opfs の availableRoots を更新</button><button id="deleteOpfs">OPFSを削除</button>
            <select id="opfsRootsList" multiple size="6" style="background:#fff;border:1px solid #ddd;padding:6px;min-height:80px;margin:0;width:100%"></select>
          </div>
          <div style="flex:1">
            <h3 style="margin:6px 0">IndexedDB</h3><button id="connectIndexedDb">IndexedDbStorageを追加</button><button id="indexedDbRoots">IndexedDb の availableRoots を更新</button><button id="deleteIndexedDb">IndexedDbを削除</button>
            <select id="indexedDbRootsList" multiple size="6" style="background:#fff;border:1px solid #ddd;padding:6px;min-height:80px;margin:0;width:100%"></select>
          </div>
          <div style="flex:1">
            <h3 style="margin:6px 0">InMemory</h3><button id="connectInMemory">InMemoryStorageを追加</button><button id="inMemoryRoots">InMemory の availableRoots を更新</button><button id="deleteInMemory">InMemoryを削除</button>
            <select id="inMemoryRootsList" multiple size="6" style="background:#fff;border:1px solid #ddd;padding:6px;min-height:80px;margin:0;width:100%"></select>
          </div>
        </div>
      </section>
      
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
        <button id="connectBtn">接続設定の更新</button>
      </div>

      <section style="margin-top:18px">
        <h2>操作</h2>
          <button id="showSnapshot">スナップショット（ローカル）一覧表示</button>
          <button id="listAdapters">アダプタ情報を表示</button>
          <button id="fetchRemote">リモート一覧をfetch</button>
          <button id="resolveConflict">競合を解消済にする</button>
          <button id="remoteChanges">リモートで新しいファイル一覧 (チェンジセット)</button>
          <button id="addLocalFile">ローカルにファイルを追加</button>
          <button id="localChanges">ローカルの変更一覧を表示</button>
          <button id="pushLocal">ローカルのチェンジセットを push</button>
          <button id="editAndPush">既存ファイルを編集</button>
          <button id="deleteAndPush">既存ファイルを削除</button>
          <button id="renameAndPush">既存ファイルを名前変更</button>
      </section>

      <section style="margin-top:18px">
        <h2>結果</h2>
        <div style="display:flex;gap:12px;align-items:stretch;height:50vh;box-sizing:border-box;">
          <div style="flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column;">
            <pre id="output" style="background:#f7f7f8;padding:12px;border-radius:6px;height:100%;min-height:0;white-space:pre-wrap;overflow:auto;"></pre>
          </div>
          <div style="flex:1;min-width:0;overflow:hidden;display:flex;flex-direction:column;">
            <pre id="trace" style="background:#f7f7f8;padding:12px;border-radius:6px;height:100%;min-height:0;white-space:pre-wrap;overflow:auto;"></pre>
          </div>
        </div>
      </section>
      
    </div>
  `
}

function appendOutput(text: string) {
  const out = el('output') as HTMLPreElement
  out.textContent = out.textContent + text + '\n'
}
function appendTrace(text: string) {
  const out = el('trace') as HTMLPreElement
  out.textContent = out.textContent + text + '\n'
}

function setListContents(id: string, items: any[] | null) {
  try {
    const container = document.getElementById(id)
    if (!container) return
    // Clear existing contents
    if ((container as HTMLSelectElement).options) {
      const sel = container as HTMLSelectElement
      // remove all options
      while (sel.options.length) sel.remove(0)
      if (!items || items.length === 0) {
        const opt = document.createElement('option')
        opt.disabled = true
        opt.selected = true
        opt.textContent = '（なし）'
        sel.appendChild(opt)
        return
      }
      for (const it of items) {
        const opt = document.createElement('option')
        const v = typeof it === 'string' || typeof it === 'number' ? String(it) : JSON.stringify(it)
        opt.value = v
        opt.textContent = v
        sel.appendChild(opt)
      }
      return
    }
    // Fallback for non-select containers (kept for compatibility)
    container.innerHTML = ''
    if (!items || items.length === 0) {
      const li = document.createElement('li')
      li.style.color = '#777'
      li.textContent = '（なし）'
      container.appendChild(li)
      return
    }
    for (const it of items) {
      const li = document.createElement('li')
      li.textContent = String(it)
      container.appendChild(li)
    }
  } catch (_e) {
    // ignore DOM errors
  }
}

async function main() {
  renderUI()

  const connectBtn = el('connectBtn') as HTMLButtonElement
  const repoInput = el('repoInput') as HTMLInputElement
  const tokenInput = el('tokenInput') as HTMLInputElement
  const platformSelect = el('platformSelect') as HTMLSelectElement

  // Note: URL GET param prefill and sync removed per UI simplification.

  // Use the bundled library at build time. This replaces runtime dynamic loading.
  // Use the bundled library at build time. Assemble `lib` from named imports.
  const lib: AnyLib = {
    GitHubAdapter: (GitOpsLib as any).GitHubAdapter,
    GitLabAdapter: (GitOpsLib as any).GitLabAdapter,
    VirtualFS: (GitOpsLib as any).VirtualFS,
    OpfsStorage: (GitOpsLib as any).OpfsStorage,
    InMemoryStorage: (GitOpsLib as any).InMemoryStorage,
    IndexedDatabaseStorage: (GitOpsLib as any).IndexedDatabaseStorage,
  }

  // keep a reference to the created vfs so other buttons reuse it
  let currentVfs: any | null = null
  let currentPlatform: 'github' | 'gitlab' | null = null
  let currentOwner: string | null = null
  let currentRepoName: string | null = null

  async function getCurrentAdapter() {
    if (!currentVfs) return null
    try {
      if (typeof currentVfs.getAdapterInstance === 'function') return await currentVfs.getAdapterInstance()
    } catch (_e) {
      return null
    }
    return null
  }

  connectBtn.addEventListener('click', async () => {
    appendOutput('[connectBtn]接続を試みます...')
    const repo = repoInput.value.trim()
    const token = tokenInput.value.trim()
    appendOutput(`[connectBtn]入力: repo=${repo || '<未入力>'} token=${token ? '***' : '<未入力>'}`)

    try {
      // Parse URL to support self-hosted instances as well as github.com/gitlab.com
      let parsed: URL | null = null
      try {
        parsed = new URL(repo)
      } catch (err) {
        parsed = null
      }

      if (!parsed) {
        appendOutput('[connectBtn]無効な URL です。例: https://github.com/owner/repo')
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
          appendOutput('[connectBtn]GitHub 用の owner/repo が URL から取得できませんでした')
        } else {
          currentPlatform = 'github'
          currentOwner = owner
          currentRepoName = repoName
          try {
            // For GitHub Enterprise/self-hosted, prefer API base at origin + '/api/v3'
            let hostForApi: string | undefined = undefined
            if (!/github\.com$/i.test(hostname)) {
              hostForApi = `${parsed.protocol}//${parsed.host}/api/v3`
            }
            const ghOpts: any = { owner, repo: repoName, token }
            if (hostForApi) ghOpts.host = hostForApi
            // Do NOT instantiate adapter here; only persist connection metadata into VirtualFS
            if (currentVfs && typeof currentVfs.setAdapter === 'function') {
              try {
                await currentVfs.setAdapter(null, { type: 'github', opts: ghOpts })
                appendOutput('GitHub 接続情報を VirtualFS に登録しました')
                
                appendTrace(`await currentVfs.setAdapter(null, { type: 'github', opts: ${JSON.stringify(ghOpts)} })`)
              } catch (e) {
                appendOutput('[connectBtn]VirtualFS に adapter 情報を設定できませんでした: ' + String(e))
              }
            } else {
              appendOutput('[connectBtn]VirtualFS が接続されていません。adapter 情報を登録できません')
            }
          } catch (e) {
            appendOutput('[connectBtn]GitHub 接続情報の登録で例外: ' + String(e))
          }
        }
      } else if (chosen === 'gitlab' && lib.GitLabAdapter) {
        if (segments.length < 2) {
          appendOutput('[connectBtn]GitLab 用の namespace/project が URL から取得できませんでした')
        } else {
          // projectId should be full namespace path (group[/subgroup]/project)
          const projectId = segments.join('/')
          currentPlatform = 'gitlab'
          currentOwner = segments.slice(0, -1).join('/') || null
          currentRepoName = segments[segments.length - 1] || null
            try {
            const glOpts: any = { projectId, token }
            if (!/gitlab\.com$/i.test(hostname)) glOpts.host = `${parsed.protocol}//${parsed.host}`
            // Do NOT instantiate adapter here; only persist connection metadata into VirtualFS
            if (currentVfs && typeof currentVfs.setAdapter === 'function') {
              try {
                await currentVfs.setAdapter(null, { type: 'gitlab', opts: glOpts })
                appendOutput('GitLab 接続情報を VirtualFS に登録しました')
                appendTrace(`await currentVfs.setAdapter(null, { type: 'gitlab', opts: ${JSON.stringify(glOpts)} })`)
              } catch (e) {
                appendOutput('[connectBtn]VirtualFS に adapter 情報を設定できませんでした: ' + String(e))
              }
            } else {
              appendOutput('[connectBtn]VirtualFS が接続されていません。adapter 情報を登録できません')
            }
          } catch (e) {
            appendOutput('[connectBtn]GitLab 接続情報の登録で例外: ' + String(e))
          }
        }
      } else {
        appendOutput('[connectBtn]対応しているリポジトリ URL ではありません（GitHub/GitLab の形式を指定してください）')
      }
    } catch (e) {
      appendOutput('[connectBtn]接続処理で例外: ' + String(e))
      appendTrace(`${JSON.stringify(e)}`)
    }
  })

  const connectOpfsBtn = el('connectOpfs') as HTMLButtonElement
  connectOpfsBtn.addEventListener('click', () => {
    ; (async () => {
      try {
        if (!lib.VirtualFS) {
          appendOutput('[connectOpfsBtn]バンドルに VirtualFS が含まれていません')
          return
        }
        if (!lib.OpfsStorage) {
          appendOutput('[connectOpfsBtn]バンドルに OpfsStorage が含まれていません')
          return
        }
        const rootNameInput = (prompt('OPFS のルート名を入力してください（空欄でデフォルト）') || '').trim()
        const backend = rootNameInput ? new lib.OpfsStorage(rootNameInput) : new lib.OpfsStorage()
        appendTrace(`const backend = new lib.OpfsStorage(${JSON.stringify(rootNameInput)})`)
        const vfs = new lib.VirtualFS({ backend })
        appendTrace(`const vfs = new lib.VirtualFS({ backend })`)
        if (currentVfs) {
          appendOutput('[connectOpfsBtn]既存の VirtualFS を新しいものに切り替えます')
          try {
            if (typeof (currentVfs as any).close === 'function') await (currentVfs as any).close()
            else if (typeof (currentVfs as any).dispose === 'function') await (currentVfs as any).dispose()
          } catch (e) {
            appendOutput('[connectOpfsBtn]既存 VirtualFS のクリーンアップで例外: ' + String(e))
          }
        }
        currentVfs = vfs
        appendOutput('[connectOpfsBtn]VirtualFS を作成し OpfsStorage を接続しました' + (rootNameInput ? ` (root=${rootNameInput})` : ''))
        try {
          await vfs.init()
          appendOutput('[connectOpfsBtn]VirtualFS.init() 実行済み (OpfsStorage)')
        } catch (e) {
          appendOutput('[connectOpfsBtn]VirtualFS.init()/IO で例外: ' + String(e))
        }
        // 接続後に OPFS の availableRoots を再取得して UI を更新
        if (typeof opfsRootsBtn !== 'undefined' && opfsRootsBtn) opfsRootsBtn.click()
      } catch (e) {
        appendOutput('[connectOpfsBtn]OpfsStorage 接続で例外: ' + String(e))
      }
    })()
  })

  const connectIndexedDbBtn = el('connectIndexedDb') as HTMLButtonElement
  connectIndexedDbBtn.addEventListener('click', () => {
    ; (async () => {
      try {
        if (!lib.VirtualFS) {
          appendOutput('[connectIndexedDbBtn]バンドルに VirtualFS が含まれていません')
          return
        }
        if (!lib.IndexedDatabaseStorage) {
          appendOutput('[connectIndexedDbBtn]バンドルに IndexedDatabaseStorage が含まれていません')
          return
        }
        const dbNameInput = (prompt('IndexedDB の DB 名を入力してください（空欄でデフォルト）') || '').trim()
        const backend = dbNameInput ? new lib.IndexedDatabaseStorage(dbNameInput) : new lib.IndexedDatabaseStorage()
        appendTrace(`const backend = new lib.IndexedDatabaseStorage(${JSON.stringify(dbNameInput)})`)
        const vfs = new lib.VirtualFS({ backend })
        appendTrace(`const vfs = new lib.VirtualFS({ backend })`)
        if (currentVfs) {
          appendOutput('[connectIndexedDbBtn]既存の VirtualFS を新しいものに切り替えます')
          try {
            if (typeof (currentVfs as any).close === 'function') await (currentVfs as any).close()
            else if (typeof (currentVfs as any).dispose === 'function') await (currentVfs as any).dispose()
          } catch (e) {
            appendOutput('[connectIndexedDbBtn]既存 VirtualFS のクリーンアップで例外: ' + String(e))
          }
        }
        currentVfs = vfs
        appendOutput('[connectIndexedDbBtn]VirtualFS を作成し IndexedDatabaseStorage を接続しました' + (dbNameInput ? ` (db=${dbNameInput})` : ''))
        try {
          await vfs.init()
          appendOutput('[connectIndexedDbBtn]VirtualFS.init() 実行済み (IndexedDatabaseStorage)')
        } catch (e) {
          appendOutput('[connectIndexedDbBtn]VirtualFS.init()/IO で例外: ' + String(e))
        }
        // 接続後に IndexedDB の availableRoots を再取得して UI を更新
        // DBの永続化完了を待つため、少し遅延させる
        await new Promise(resolve => setTimeout(resolve, 100))
        if (typeof indexedDbRootsBtn !== 'undefined' && indexedDbRootsBtn) indexedDbRootsBtn.click()
      } catch (e) {
        appendOutput('[connectIndexedDbBtn]IndexedDatabaseStorage 接続で例外: ' + String(e))
      }
    })()
  })

  const connectInMemoryBtn = el('connectInMemory') as HTMLButtonElement
  connectInMemoryBtn.addEventListener('click', () => {
    ; (async () => {
      try {
        if (!lib.VirtualFS) {
          appendOutput('[connectInMemoryBtn]バンドルに VirtualFS が含まれていません')
          return
        }
        if (!lib.InMemoryStorage) {
          appendOutput('[connectInMemoryBtn]バンドルに InMemoryStorage が含まれていません')
          return
        }
        const rootNameInput = (prompt('InMemory のルート名を入力してください（空欄でデフォルト）') || '').trim()
        const backend = rootNameInput ? new lib.InMemoryStorage(rootNameInput) : new lib.InMemoryStorage()
        appendTrace(`const backend = new lib.InMemoryStorage(${JSON.stringify(rootNameInput)})`)
        const vfs = new lib.VirtualFS({ backend })
        appendTrace(`const vfs = new lib.VirtualFS({ backend })`)
        if (currentVfs) {
          appendOutput('[connectInMemoryBtn]既存の VirtualFS を新しいものに切り替えます')
          try {
            if (typeof (currentVfs as any).close === 'function') await (currentVfs as any).close()
            else if (typeof (currentVfs as any).dispose === 'function') await (currentVfs as any).dispose()
          } catch (e) {
            appendOutput('[connectInMemoryBtn]既存 VirtualFS のクリーンアップで例外: ' + String(e))
          }
        }
        currentVfs = vfs
        appendOutput('[connectInMemoryBtn]VirtualFS を作成し InMemoryStorage を接続しました' + (rootNameInput ? ` (root=${rootNameInput})` : ''))
        try {
          await vfs.init()
          appendOutput('[connectInMemoryBtn]VirtualFS.init() 実行済み (InMemoryStorage)')
        } catch (e) {
          appendOutput('[connectInMemoryBtn]VirtualFS.init()/IO で例外: ' + String(e))
        }
        // 接続後に InMemory の availableRoots を再取得して UI を更新
        if (typeof inMemoryRootsBtn !== 'undefined' && inMemoryRootsBtn) inMemoryRootsBtn.click()
      } catch (e) {
        appendOutput('[connectInMemoryBtn]InMemoryStorage 接続で例外: ' + String(e))
      }
    })()
  })

  const opfsRootsBtn = el('opfsRoots') as HTMLButtonElement
  opfsRootsBtn.addEventListener('click', async () => {
    try {
      const OpfsCtor: any = lib.OpfsStorage
      if (!OpfsCtor) {
        appendOutput('[opfsRoots]バンドルに OpfsStorage が含まれていません')
        setListContents('opfsRootsList', [])
        return
      }
      if (OpfsCtor && typeof OpfsCtor.availableRoots === 'function') {
        let roots: any = OpfsCtor.availableRoots()
        appendTrace('let opfsRoots = lib.OpfsStorage.availableRoots()')
        if (roots && typeof roots.then === 'function') {
          try {
            roots = await roots
          } catch (_e) {
            roots = []
          }
        }
        appendTrace('JSON.stringify(opfsRoots) => ' + JSON.stringify(roots))
        
        appendOutput('[opfsRoots]availableRoots: ' + JSON.stringify(roots))
        setListContents('opfsRootsList', Array.isArray(roots) ? roots : [])
      }
    } catch (e) {
      appendOutput('[opfsRoots]取得失敗: ' + String(e))
      setListContents('opfsRootsList', [])
    }
  })

  const indexedDbRootsBtn = el('indexedDbRoots') as HTMLButtonElement
  indexedDbRootsBtn.addEventListener('click', async () => {
    try {
      const IdxCtor: any = lib.IndexedDatabaseStorage
      if (!IdxCtor) {
        appendOutput('[indexedDbRoots]バンドルに IndexedDatabaseStorage が含まれていません')
        setListContents('indexedDbRootsList', [])
        return
      }
      // フォーカスが当たるたびに最新の状態を取得するため、少し待機してから取得
      await new Promise(resolve => setTimeout(resolve, 50))
      
      if (IdxCtor && typeof IdxCtor.availableRoots === 'function') {
        let roots: any = IdxCtor.availableRoots()
        appendTrace('let indexedDbRoots = lib.IndexedDatabaseStorage.availableRoots()')
        if (roots && typeof roots.then === 'function') {
          try {
            roots = await roots
          } catch (_e) {
            roots = []
          }
        }
        appendTrace('JSON.stringify(indexedDbRoots) => ' + JSON.stringify(roots))
        appendOutput('[indexedDbRoots]availableRoots: ' + JSON.stringify(roots))
        setListContents('indexedDbRootsList', Array.isArray(roots) ? roots : [])
      } else {
        appendOutput('[indexedDbRoots]IndexedDatabaseStorage に availableRoots() が実装されていません')
        setListContents('indexedDbRootsList', [])
      }
    } catch (e) {
      appendOutput('[indexedDbRoots]取得失敗: ' + String(e))
      setListContents('indexedDbRootsList', [])
    }
  })

  const inMemoryRootsBtn = el('inMemoryRoots') as HTMLButtonElement
  inMemoryRootsBtn.addEventListener('click', async () => {
    appendOutput('[inMemoryRoots]availableRoots を取得します...')
    try {
      let MemCtor: any = lib.InMemoryStorage
      let roots: any[] = []
      if (MemCtor && typeof MemCtor.availableRoots === 'function') {
        roots = MemCtor.availableRoots() || []
        appendTrace('let inMemoryRoots = lib.InMemoryStorage.availableRoots()')
      }
      appendTrace('JSON.stringify(inMemoryRoots) => ' + JSON.stringify(roots))
      appendOutput('[inMemoryRoots]availableRoots: ' + JSON.stringify(roots))
      setListContents('inMemoryRootsList', Array.isArray(roots) ? roots : [])
    } catch (e) {
      appendOutput('[inMemoryRoots]取得失敗: ' + String(e))
      setListContents('inMemoryRootsList', [])
    }
  })

  // Select の選択で該当ストレージへ接続する（クリックで切替）
  // 共通処理: VirtualFS を作成して接続し、persisted adapter metadata を UI に反映する
  async function populateAdapterMetadata(vfs: any) {
    try {
      const meta = await vfs.getAdapter()
      if (meta && meta.type === 'github') {
        const o = meta.opts || {}
        try {
          const base = o.host ? (() => { try { return new URL(o.host).origin } catch { return String(o.host).replace(/\/api\/v3\/?$/, '') } })() : 'https://github.com'
          repoInput.value = o.owner && o.repo ? `${base}/${o.owner}/${o.repo}` : ''
        } catch (_) { repoInput.value = '' }
        tokenInput.value = (o && o.token) || ''
        platformSelect.value = 'github'
        currentPlatform = 'github'
        currentOwner = o.owner || null
        currentRepoName = o.repo || null
      } else if (meta && meta.type === 'gitlab') {
        const o = meta.opts || {}
        try {
          const base = o.host ? (() => { try { return new URL(o.host).origin } catch { return String(o.host).replace(/\/api\/v4\/?$/, '') } })() : 'https://gitlab.com'
          repoInput.value = o.projectId ? `${base}/${o.projectId}` : ''
        } catch (_) { repoInput.value = '' }
        tokenInput.value = (o && o.token) || ''
        platformSelect.value = 'gitlab'
        currentPlatform = 'gitlab'
        try {
          const parts = (o.projectId || '').split('/').filter(Boolean)
          currentOwner = parts.slice(0, -1).join('/') || null
          currentRepoName = parts[parts.length - 1] || null
        } catch (_) {
          currentOwner = null
          currentRepoName = null
        }
      } else {
        repoInput.value = ''
        tokenInput.value = ''
        platformSelect.value = 'auto'
        currentPlatform = null
        currentOwner = null
        currentRepoName = null
      }
    } catch (_e) {
      repoInput.value = ''
      tokenInput.value = ''
      platformSelect.value = 'auto'
      currentPlatform = null
      currentOwner = null
      currentRepoName = null
    }
  }

  async function connectVfsBackend(prefix: string, BackendCtor: any, val: string, displayName: string, suffixLabel: 'root' | 'db' = 'root') {
    try {
      if (!BackendCtor || !lib.VirtualFS) { appendOutput(`[${prefix}]${displayName}/VirtualFS が見つかりません`); return }
      const backend = new BackendCtor(val)
      appendTrace(`const backend = new lib.${displayName}(${JSON.stringify(val)})`)
      const vfs = new (lib.VirtualFS as any)({ backend })
      appendTrace(`const vfs = new lib.VirtualFS({ backend })`)
      if (currentVfs) appendOutput(`[${prefix}]既存の VirtualFS を新しいものに切り替えます`)
      currentVfs = vfs
      appendOutput(`[${prefix}]VirtualFS を作成し ${displayName} を接続しました (${suffixLabel}=${val})`)
      try {
        await vfs.init()
        appendTrace(`await vfs.init()`)
        appendOutput(`[${prefix}]VirtualFS.init() 実行済み (${displayName})`)
        await populateAdapterMetadata(vfs)
      } catch (e) { appendOutput(`[${prefix}]VirtualFS.init() で例外: ${String(e)}`) }
    } catch (e) { appendOutput(`[${prefix}]接続失敗: ${String(e)}`) }
  }

  if (typeof document !== 'undefined') {
    const opfsSel = document.getElementById('opfsRootsList') as HTMLSelectElement | null
    const idxSel = document.getElementById('indexedDbRootsList') as HTMLSelectElement | null
    const memSel = document.getElementById('inMemoryRootsList') as HTMLSelectElement | null

    if (opfsSel) {
      opfsSel.addEventListener('change', async () => {
        if (idxSel) idxSel.selectedIndex = -1
        if (memSel) memSel.selectedIndex = -1
        try {
          const val = opfsSel.value
          if (!val) return
          await connectVfsBackend('opfsRoots', lib.OpfsStorage, val, 'OpfsStorage', 'root')
        } catch (e) { appendOutput('[opfsRoots]接続失敗: ' + String(e)) }
      })
    }

    if (idxSel) {
      idxSel.addEventListener('change', async () => {
        if (opfsSel) opfsSel.selectedIndex = -1
        if (memSel) memSel.selectedIndex = -1
        try {
          const val = idxSel.value
          if (!val) return
          await connectVfsBackend('indexedDbRoots', lib.IndexedDatabaseStorage, val, 'IndexedDbStorage', 'db')
        } catch (e) { appendOutput('[indexedDbRoots]接続失敗: ' + String(e)) }
      })
    }

    if (memSel) {
      memSel.addEventListener('change', async () => {
        if (opfsSel) opfsSel.selectedIndex = -1
        if (idxSel) idxSel.selectedIndex = -1
        try {
          const val = memSel.value
          if (!val) return
          await connectVfsBackend('inMemoryRoots', lib.InMemoryStorage, val, 'InMemoryStorage', 'root')
        } catch (e) { appendOutput('[inMemoryRoots]接続失敗: ' + String(e)) }
      })
    }
  }

  // OPFS削除ボタン
  const deleteOpfsBtn = el('deleteOpfs') as HTMLButtonElement
  deleteOpfsBtn.addEventListener('click', async () => {
    appendOutput('[deleteOpfsBtn]選択された OPFS のルートを削除します...')
    const opfsSel = document.getElementById('opfsRootsList') as HTMLSelectElement | null
    if (!opfsSel || opfsSel.selectedIndex === -1) {
      appendOutput('[deleteOpfsBtn]削除対象のルートが選択されていません')
      return
    }
    try {
      const selectedVal = opfsSel.value
      const OpfsCtor: any = lib.OpfsStorage
      if (!OpfsCtor) {
        appendOutput('[deleteOpfsBtn]OpfsStorage が見つかりません')
        return
      }
      if (typeof OpfsCtor.delete === 'function') {
        await OpfsCtor.delete(selectedVal)
        appendOutput(`[deleteOpfsBtn]OPFS ルート "${selectedVal}" を削除しました`)
        if (opfsRootsBtn) opfsRootsBtn.click()
      } else if (typeof OpfsCtor.remove === 'function') {
        await OpfsCtor.remove(selectedVal)
        appendOutput(`[deleteOpfsBtn]OPFS ルート "${selectedVal}" を削除しました`)
        if (opfsRootsBtn) opfsRootsBtn.click()
      } else {
        appendOutput('[deleteOpfsBtn]OpfsStorage に削除メソッドが実装されていません')
      }
    } catch (e) {
      appendOutput('[deleteOpfsBtn]削除に失敗しました: ' + String(e))
    }
  })

  // IndexedDB削除ボタン
  const deleteIndexedDbBtn = el('deleteIndexedDb') as HTMLButtonElement
  deleteIndexedDbBtn.addEventListener('click', async () => {
    appendOutput('[deleteIndexedDbBtn]選択された IndexedDB を削除します...')
    const idxSel = document.getElementById('indexedDbRootsList') as HTMLSelectElement | null
    if (!idxSel || idxSel.selectedIndex === -1) {
      appendOutput('[deleteIndexedDbBtn]削除対象の DB が選択されていません')
      return
    }
    try {
      const selectedVal = idxSel.value
      const IdxCtor: any = lib.IndexedDatabaseStorage
      if (!IdxCtor) {
        appendOutput('[deleteIndexedDbBtn]IndexedDatabaseStorage が見つかりません')
        return
      }
      if (typeof IdxCtor.delete === 'function') {
        await IdxCtor.delete(selectedVal)
        appendOutput(`[deleteIndexedDbBtn]IndexedDB "${selectedVal}" を削除しました`)
        if (indexedDbRootsBtn) indexedDbRootsBtn.click()
      } else if (typeof IdxCtor.remove === 'function') {
        await IdxCtor.remove(selectedVal)
        appendOutput(`[deleteIndexedDbBtn]IndexedDB "${selectedVal}" を削除しました`)
        if (indexedDbRootsBtn) indexedDbRootsBtn.click()
      } else {
        appendOutput('[deleteIndexedDbBtn]IndexedDatabaseStorage に削除メソッドが実装されていません')
      }
    } catch (e) {
      appendOutput('[deleteIndexedDbBtn]削除に失敗しました: ' + String(e))
    }
  })

  // InMemory削除ボタン
  const deleteInMemoryBtn = el('deleteInMemory') as HTMLButtonElement
  deleteInMemoryBtn.addEventListener('click', async () => {
    appendOutput('[deleteInMemoryBtn]選択された InMemory のルートを削除します...')
    const memSel = document.getElementById('inMemoryRootsList') as HTMLSelectElement | null
    if (!memSel || memSel.selectedIndex === -1) {
      appendOutput('[deleteInMemoryBtn]削除対象のルートが選択されていません')
      return
    }
    try {
      const selectedVal = memSel.value
      const MemCtor: any = lib.InMemoryStorage
      if (!MemCtor) {
        appendOutput('[deleteInMemoryBtn]InMemoryStorage が見つかりません')
        return
      }
      if (typeof MemCtor.delete === 'function') {
        await MemCtor.delete(selectedVal)
        appendOutput(`[deleteInMemoryBtn]InMemory ルート "${selectedVal}" を削除しました`)
        if (inMemoryRootsBtn) inMemoryRootsBtn.click()
      } else if (typeof MemCtor.remove === 'function') {
        await MemCtor.remove(selectedVal)
        appendOutput(`[deleteInMemoryBtn]InMemory ルート "${selectedVal}" を削除しました`)
        if (inMemoryRootsBtn) inMemoryRootsBtn.click()
      } else {
        appendOutput('[deleteInMemoryBtn]InMemoryStorage に削除メソッドが実装されていません')
      }
    } catch (e) {
      appendOutput('[deleteInMemoryBtn]削除に失敗しました: ' + String(e))
    }
  })

  // 初期表示で自動的に各 Storage の availableRoots を取得して表示する
  // 要素が存在すれば click() でハンドラを起動
  if (opfsRootsBtn) opfsRootsBtn.click()
  if (indexedDbRootsBtn) indexedDbRootsBtn.click()
  if (inMemoryRootsBtn) inMemoryRootsBtn.click()

  const listAdaptersBtn = el('listAdapters') as HTMLButtonElement
  listAdaptersBtn.addEventListener('click', () => {
    appendOutput('[listAdaptersBtn]バンドルに含まれるエクスポート: ' + Object.keys(lib ?? {}).join(', '))
  })

  // スナップショット取得はアダプタ実装の fetchSnapshot() を使います。

  const fetchRemoteBtn = el('fetchRemote') as HTMLButtonElement
  fetchRemoteBtn.addEventListener('click', async () => {
    appendOutput('[fetchRemoteBtn]リモートスナップショットを取得します...')
    if (!currentVfs) { appendOutput('[fetchRemoteBtn]先に VirtualFS を初期化してください'); return }
    try {
      appendTrace('const res = await currentVfs.pull()')
      const res = await currentVfs.pull()
      appendTrace('res => ' + JSON.stringify(res))
      const remote = (res as any).remote
      const remotePaths = (res as any).remotePaths || Object.keys(remote?.shas || {})
      appendOutput(`[fetchRemoteBtn]リモートファイル数: ${remotePaths.length}`)
      if (remotePaths.length > 0) {
        const first = remotePaths.slice(0, 20)
        appendOutput('[fetchRemoteBtn]リモート先頭ファイル: ' + first.join(', '))
        if (remotePaths.length > 20) appendOutput(`[fetchRemoteBtn]... 他 ${remotePaths.length - 20} 件`)
      }
      const fetchedPaths = (res as any).fetchedPaths || []
      const reconciledPaths = (res as any).reconciledPaths || []
      const totalConflicts = res.conflicts ? res.conflicts.length : 0
      // count conflicts where baseSha === remoteSha (already-resolved)
      let resolvedConflicts = 0
      if (res.conflicts && res.conflicts.length > 0) {
        for (const c of res.conflicts) {
          if (c.baseSha && c.remoteSha && c.baseSha === c.remoteSha) resolvedConflicts++
        }
      }
      appendOutput(`[fetchRemoteBtn]pull 完了。コンフリクト数: ${totalConflicts}`)
      appendOutput(`[fetchRemoteBtn]fetchContent 対象ファイル数: ${fetchedPaths.length}`)
      if (reconciledPaths.length > 0) {
        const sample = reconciledPaths.slice(0, 20)
        appendOutput(`[fetchRemoteBtn]ローカル一致で再計算されたファイル: ${sample.join(', ')}`)
      }
      if (resolvedConflicts > 0) appendOutput(`[fetchRemoteBtn]解決済コンフリクト数: ${resolvedConflicts}`)
      if (res.conflicts && res.conflicts.length > 0) {
        appendOutput('[fetchRemoteBtn]--- コンフリクト詳細 ---')
        for (const c of res.conflicts) {
          try {
            const path = c.path || '<不明>'
            appendOutput(`[fetchRemoteBtn]path: ${path}`)
            appendOutput(`[fetchRemoteBtn]  workspaceSha: ${c.workspaceSha ?? '<なし>'}`)
            appendOutput(`[fetchRemoteBtn]  baseSha: ${c.baseSha ?? '<なし>'}`)
            appendOutput(`[fetchRemoteBtn]  remoteSha: ${c.remoteSha ?? '<なし>'}`)
            // local workspace content (may be null)
            try {
              const localContent = await currentVfs.readFile(path)
              const lsnippet = localContent === null ? '<存在しない>' : (typeof localContent === 'string' ? localContent.slice(0, 400).replace(/\r?\n/g, '\\n') : String(localContent))
              appendOutput(`[fetchRemoteBtn]  local (workspace) snippet: ${lsnippet}`)
            } catch (e) {
              appendOutput(`[fetchRemoteBtn]  local read error: ${String(e)}`)
            }
            // remote snapshot content if available in fetched data
            try {
              const fetched = remote && typeof remote.fetchContent === 'function' ? await remote.fetchContent([path]) : {}
              const remoteContent = fetched[path] || null
              const rsn = remoteContent === null ? '<取得不可>' : (typeof remoteContent === 'string' ? remoteContent.slice(0, 400).replace(/\r?\n/g, '\\n') : String(remoteContent))
              appendOutput(`[fetchRemoteBtn]  remote snippet: ${rsn}`)
            } catch (e) {
              appendOutput(`[fetchRemoteBtn]  remote read error: ${String(e)}`)
            }
          } catch (err) {
            appendOutput(`[fetchRemoteBtn]  コンフリクト表示で例外: ${String(err)}`)
          }
        }
        appendOutput('[fetchRemoteBtn]--- 以上 ---')
      }

      try {
        const postKeys = (res as any).postIndexKeys || []
        const added = (res as any).addedPaths || []
        appendOutput(`[fetchRemoteBtn]インデックス内ファイル数: ` + postKeys.length)
        if (postKeys.length > 0) {
          const first = postKeys.slice(0, 50)
          appendOutput(`[fetchRemoteBtn]インデックス先頭ファイル: ` + first.join(', '))
        }
        appendOutput(`[fetchRemoteBtn]pull で新規に登録されたファイル: ` + (added.length ? added.join(', ') : '<なし>'))
      } catch (e) {
        appendOutput(`[fetchRemoteBtn]pull 後のインデックス表示で例外: ` + String(e))
      }
    } catch (e) {
      appendOutput(`[fetchRemoteBtn]pull 失敗: ` + String(e))
    }
  })



  const resolveConflictBtn = el('resolveConflict') as HTMLButtonElement
  resolveConflictBtn.addEventListener('click', async () => {
    const path = (prompt('競合を解消するファイル名を入力してください（例: examples/new.txt）') || '').trim()
    if (!path) return
    if (!currentVfs) { appendOutput('[resolveConflictBtn]先に VirtualFS を初期化してください'); return }
    try {
      if (typeof currentVfs.resolveConflict === 'function') {
        const ok = await currentVfs.resolveConflict(path)
        if (ok) appendOutput(`[resolveConflictBtn]競合を解消しました: ${path}`)
        else appendOutput(`[resolveConflictBtn]競合ファイルが見つからないか削除に失敗しました: ${path}`)
      } else {
        appendOutput('[resolveConflictBtn]VirtualFS に resolveConflict() が実装されていません')
      }
    } catch (e) {
      appendOutput('[resolveConflictBtn]resolveConflict 失敗: ' + String(e))
    }
  })

  const remoteChangesBtn = el('remoteChanges') as HTMLButtonElement
  remoteChangesBtn.addEventListener('click', async () => {
    appendOutput('[remoteChangesBtn]リモートとローカルの差分を取得します...')
    if (!currentVfs) { appendOutput('[remoteChangesBtn]先に VirtualFS を初期化してください'); return }
    try {
      if (!currentVfs || typeof currentVfs.getRemoteDiffs !== 'function') {
        appendOutput('[remoteChangesBtn] VirtualFS に getRemoteDiffs() が存在しません');
        return
      }
      const res = await currentVfs.getRemoteDiffs()
      const diffs: string[] = res?.diffs || []
      appendOutput('[remoteChangesBtn]リモート差分ファイル数: ' + diffs.length)
      if (diffs.length > 0) appendOutput(diffs.join('\n'))
    } catch (e) {
      appendOutput('[remoteChangesBtn]remoteChanges 失敗: ' + String(e))
    }
  })

  const addLocalFileBtn = el('addLocalFile') as HTMLButtonElement
  addLocalFileBtn.addEventListener('click', async () => {
    if (!currentVfs) { appendOutput('[addLocalFileBtn]先に VirtualFS を初期化してください'); return }
    const path = prompt('作成するファイル名を入力してください（例: examples/new.txt）')
    if (!path) return
    const content = prompt('ファイル内容を入力してください', 'hello') || ''
    try {
      await currentVfs.writeFile(path, content)
      appendOutput(`[addLocalFileBtn]ローカルにファイルを追加しました: ${path}`)
    } catch (e) { appendOutput('[addLocalFileBtn]addLocalFile 失敗: ' + String(e)) }
  })

  const localChangesBtn = el('localChanges') as HTMLButtonElement
  localChangesBtn.addEventListener('click', async () => {
    if (!currentVfs) { appendOutput('[localChangesBtn]先に VirtualFS を初期化してください'); return }
    try {
      const changes = await currentVfs.getChangeSet()
      appendOutput('[localChangesBtn]ローカル変更一覧:\n' + JSON.stringify(changes, null, 2))
    } catch (e) { appendOutput('[localChangesBtn]localChanges 失敗: ' + String(e)) }
  })

  const pushLocalBtn = el('pushLocal') as HTMLButtonElement
  pushLocalBtn.addEventListener('click', async () => {
    appendOutput('[pushLocalBtn]ローカルのチェンジセットをリモートに push します...')
    if (!currentVfs) { appendOutput('[pushLocalBtn]先に VirtualFS を初期化してください'); return }
    if (!(await getCurrentAdapter())) { appendOutput('[pushLocalBtn]先にアダプタを接続してください'); return }
    try {
      const changes = await currentVfs.getChangeSet()
      if (!changes || changes.length === 0) { appendOutput('[pushLocalBtn]Push する変更がありません'); return }
      const idx = await currentVfs.getIndex()
      const input = { parentSha: idx.head || '', message: 'Example push from UI', changes }
      const res = await currentVfs.push(input)
      appendOutput('[pushLocalBtn]push 成功: ' + JSON.stringify(res))
    } catch (e) { appendOutput('[pushLocalBtn]pushLocal 失敗: ' + String(e)) }
  })

  // --- Edit / Delete / Rename existing file and push to remote ---
  const editAndPushBtn = el('editAndPush') as HTMLButtonElement
  editAndPushBtn.addEventListener('click', async () => {
    appendOutput('[editAndPushBtn]既存ファイルの編集 & push を開始します...')
    if (!currentVfs) { appendOutput('[editAndPushBtn]先に VirtualFS を初期化してください'); return }
    if (!(await getCurrentAdapter())) { appendOutput('[editAndPushBtn]先にアダプタを接続してください'); return }
    try {
      const path = (prompt('編集するファイルのパスを入力してください（例: examples/file.txt）') || '').trim()
      if (!path) return
      const existing = await currentVfs.readFile(path)
      const newContent = prompt('新しいファイル内容を入力してください', existing === null ? '' : String(existing))
      if (newContent === null) return
      await currentVfs.writeFile(path, newContent)
      appendOutput(`[editAndPushBtn]ローカル編集しました: ${path}`)

    } catch (e) {
      appendOutput('[editAndPushBtn]editAndPush 失敗: ' + String(e))
    }
  })

  const deleteAndPushBtn = el('deleteAndPush') as HTMLButtonElement
  deleteAndPushBtn.addEventListener('click', async () => {
    appendOutput('[deleteAndPushBtn]既存ファイルの削除 & push を開始します...')
    if (!currentVfs) { appendOutput('[deleteAndPushBtn]先に VirtualFS を初期化してください'); return }
    if (!(await getCurrentAdapter())) { appendOutput('[deleteAndPushBtn]先にアダプタを接続してください'); return }
    try {
      const path = (prompt('削除するファイルのパスを入力してください（例: examples/file.txt）') || '').trim()
      if (!path) return
      const ok = confirm(`本当に削除しますか: ${path}`)
      if (!ok) return
      await currentVfs.deleteFile(path)
      appendOutput(`[deleteAndPushBtn]ローカルで削除しました: ${path}`)

    } catch (e) {
      appendOutput('[deleteAndPushBtn]deleteAndPush 失敗: ' + String(e))
    }
  })

  const renameAndPushBtn = el('renameAndPush') as HTMLButtonElement
  renameAndPushBtn.addEventListener('click', async () => {
    appendOutput('[renameAndPushBtn]既存ファイルの名前変更を開始します...')
    if (!currentVfs) { appendOutput('[renameAndPushBtn]先に VirtualFS を初期化してください'); return }
    if (!(await getCurrentAdapter())) { appendOutput('[renameAndPushBtn]先にアダプタを接続してください'); return }
    try {
      const from = (prompt('変更元のファイルパスを入力してください（例: examples/old.txt）') || '').trim()
      if (!from) return
      const to = (prompt('新しいファイル名を入力してください（例: examples/new.txt）') || '').trim()
      if (!to) return
      await currentVfs.renameFile(from, to)
      appendOutput(`[renameAndPushBtn]ローカルでリネームしました: ${from} -> ${to}`)

    } catch (e) {
      appendOutput('[renameAndPushBtn]renameAndPush 失敗: ' + String(e))
    }
  })

  const showSnapshotBtn = el('showSnapshot') as HTMLButtonElement
  showSnapshotBtn.addEventListener('click', () => {
    ; (async () => {
      try {
        if (!currentVfs) {
          appendOutput('[showSnapshotBtn]先に VirtualFS を初期化してください')
          return
        }
        appendOutput('[showSnapshotBtn]スナップショット内のパス一覧を取得しています...')
        try {
          const paths: string[] = currentVfs.listPaths ? await currentVfs.listPaths() : []
          appendTrace('const paths = await currentVfs.listPaths()')
          appendTrace('paths => ' + JSON.stringify(paths))
          if (!paths || paths.length === 0) {
            appendOutput('[showSnapshotBtn]スナップショットにファイルは存在しません')
            return
          }
          appendOutput('[showSnapshotBtn]ファイル数: ' + paths.length)
          for (const p of paths) {
            try {
              const content = await currentVfs.readFile(p)
              const snippet = typeof content === 'string' ? content.slice(0, 200).replace(/\r?\n/g, '\\n') : String(content)
              appendOutput(`[showSnapshotBtn]- ${p} : ${snippet}`)
            } catch (e) {
              appendOutput(`[showSnapshotBtn]- ${p} : <読み取り失敗> ${String(e)}`)
            }
          }
        } catch (e) {
          appendOutput('[showSnapshotBtn]スナップショット一覧取得で例外: ' + String(e))
        }
      } catch (e) {
        appendOutput('[showSnapshotBtn]一覧表示処理で例外: ' + String(e))
      }
    })()
  })
}

// 自動起動
main().catch((e) => console.error(e))
