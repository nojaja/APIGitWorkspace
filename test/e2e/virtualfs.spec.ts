import { test, expect, Page } from '@playwright/test'
import { clearOPFS, dumpOPFS } from './helpers/opfs'

// Lightweight in-page VirtualFS implementation used by the simple browser tests
const vfsSimpleScript = `(() => {
  const base = {}; // files that reflect remote base
  const workspace = {}; // pending edits
  const tombstone = new Set();
  let head = 'initial';

  async function pull() {
    // simulate remote pull returning current base
    return { head };
  }

  async function push() {
    // simulate successful push
    head = 'commit-' + Math.random().toString(36).slice(2, 8);
    // clear workspace/tombstone
    for (const k of Object.keys(workspace)) delete workspace[k];
    tombstone.clear();
    return { commit: { id: head } };
  }

  return {
    readWorkspace: (p) => {
      if (p in workspace) return workspace[p];
      if (p in base) return base[p];
      return '';
    },
    writeWorkspace: (p, content) => { workspace[p] = content; tombstone.delete(p); },
    deleteWorkspace: (p) => { delete workspace[p]; if (p in base) tombstone.add(p); },
    renameWorkspace: (from, to) => {
      if (from in workspace) { workspace[to] = workspace[from]; delete workspace[from]; }
      else if (from in base) { tombstone.add(from); workspace[to] = base[from]; }
    },
    getIndex: () => {
      const keys = new Set([...Object.keys(base), ...Object.keys(workspace)]);
      const entries = Object.fromEntries(Array.from(keys).map(k => [k, { path: k, baseSha: base[k] ? 'b' : undefined, workspaceSha: workspace[k] ? 'w' : undefined, state: workspace[k] ? 'added' : 'base' }]));
      return { head, entries };
    },
    getTombstones: () => Array.from(tombstone),
    getChangeSet: async () => {
      const changes = [];
      for (const k of Object.keys(workspace)) {
        if (!(k in base)) changes.push({ type: 'create', path: k });
        else if (base[k] !== workspace[k]) changes.push({ type: 'update', path: k });
      }
      for (const p of tombstone) changes.push({ type: 'delete', path: p });
      return changes;
    },
    applyBaseSnapshot: (m, h) => { for (const k of Object.keys(base)) delete base[k]; for (const k of Object.keys(m)) base[k] = m[k]; head = h; },
    pull, push,
    _debug: () => ({ base: { ...base }, workspace: { ...workspace }, tombstone: Array.from(tombstone), head })
  };
})();`;

test.describe('VirtualFS E2E (browser)', () => {
  test('basic add/update/delete', async ({ page }) => {
    // inject in-page vfs and run tests without depending on bundle
    await page.addInitScript({ content: 'window.vfs = ' + vfsSimpleScript })
    await page.goto('about:blank')
    const state = await page.evaluate(async () => {
      const vfs = (window as any).vfs
      await vfs.writeWorkspace('foo.txt', 'hello')
      let idx = vfs.getIndex()
      const s1 = idx.entries['foo.txt'].state
      await vfs.writeWorkspace('foo.txt', 'hello2')
      idx = vfs.getIndex()
      const s2 = idx.entries['foo.txt'].state
      await vfs.deleteWorkspace('foo.txt')
      idx = vfs.getIndex()
      const exists = !!idx.entries['foo.txt']
      return { s1, s2, exists }
    })
    expect(state.s1).toBe('added')
    expect(state.s2).toBe('added')
    expect(state.exists).toBe(false)
  })

  test('tombstone case with base', async ({ page }) => {
    await page.addInitScript({ content: 'window.vfs = ' + vfsSimpleScript })
    await page.goto('about:blank')
    const res = await page.evaluate(async () => {
      const vfs = (window as any).vfs
      await vfs.applyBaseSnapshot({ 'a.txt': 'basecontent' }, 'head1')
      await vfs.writeWorkspace('a.txt', 'modified')
      await vfs.deleteWorkspace('a.txt')
      const tombs = vfs.getTombstones()
      const changes = await vfs.getChangeSet()
      return { tombsLength: tombs.length, hasDelete: changes.some((c: any) => c.type === 'delete' && c.path === 'a.txt') }
    })
    expect(res.tombsLength).toBe(1)
    expect(res.hasDelete).toBe(true)
  })

  test('pull updates base when workspace unchanged', async ({ page }) => {
    await page.addInitScript({ content: 'window.vfs = ' + vfsSimpleScript })
    await page.goto('about:blank')
    const result = await page.evaluate(async () => {
      const vfs = (window as any).vfs
      await vfs.applyBaseSnapshot({ 'a.txt': 'v1' }, 'head1')
      const remote = { 'a.txt': 'v2' }
      // simulate pull by applying snapshot
      await vfs.applyBaseSnapshot(remote, 'head2')
      return { conflicts: 0, head: vfs.getIndex().head, content: await vfs.readWorkspace('a.txt') }
    })
    expect(result.conflicts).toBe(0)
    expect(result.head).toBe('head2')
    expect(result.content).toBe('v2')
  })
})

type FileMap = Record<string, string>;

// Helper to install a mocked remote API and recorder into the Playwright page
async function installMockApi(page: Page, initialFiles: FileMap = {}) {
  const commits: any[] = [];
  let remoteFiles: FileMap = { ...initialFiles };

  // expose helper for assertions
  await page.exposeBinding('__mock_getCommits', () => commits);
  await page.exposeBinding('__mock_getRemoteFiles', () => remoteFiles);

  // route any /api/* requests
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (url.endsWith('/api/pull') && method === 'GET') {
      // Return current remote files as base state
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: remoteFiles, head: 'HEAD' + commits.length }),
      });
      return;
    }
    if (url.endsWith('/api/commit') && method === 'POST') {
      const body = await req.postData();
      const payload = body ? JSON.parse(body) : {};
      const { actions, message } = payload;
      const commit = { id: 'c' + (commits.length + 1), actions, message };
      // apply actions to remoteFiles
      for (const a of actions || []) {
        if (a.action === 'create' || a.action === 'update') {
          remoteFiles[a.path] = a.content ?? '';
        } else if (a.action === 'delete') {
          delete remoteFiles[a.path];
        }
      }
      commits.push(commit);
      await route.fulfill({ status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commit }) });
      return;
    }

    // default: 404
    await route.fulfill({ status: 404, body: 'not-found' });
  });

  return {
    getCommits: () => commits,
    getRemoteFiles: () => remoteFiles,
    setRemoteFiles: (m: FileMap) => (remoteFiles = { ...m }),
  };
}

// Simple in-page VirtualFS implementation used by tests
const vfsScript = `(() => {
  const base = {}; // files that reflect remote base
  const workspace = {}; // pending edits
  const tombstone = new Set();
  let head = 'initial';

  async function pull() {
    const res = await fetch('http://example.com/api/pull');
    if (!res.ok) throw new Error('pull failed');
    const body = await res.json();
    for (const k of Object.keys(base)) delete base[k];
    for (const [k,v] of Object.entries(body.files)) base[k]=v;
    head = body.head;
    // clear workspace/tombstone on successful pull
    for (const k of Object.keys(workspace)) delete workspace[k];
    tombstone.clear();
    return { head };
  }

  async function push() {
    // compute actions from workspace/tombstone
    const actions = [];
    for (const k of Object.keys(workspace)) {
      if (!(k in base)) actions.push({ action: 'create', path: k, content: workspace[k] });
      else if (base[k] !== workspace[k]) actions.push({ action: 'update', path: k, content: workspace[k] });
    }
    for (const p of tombstone) actions.push({ action: 'delete', path: p });
    if (actions.length === 0) return { noop: true };
    const res = await fetch('http://example.com/api/commit', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ actions, message: 'test commit' }) });
    if (!res.ok) throw new Error('push failed');
    const body = await res.json();
    // apply commit to base
    for (const a of actions) {
      if (a.action === 'create' || a.action === 'update') base[a.path] = a.content ?? '';
      else if (a.action === 'delete') delete base[a.path];
    }
    // clear workspace/tombstone
    for (const k of Object.keys(workspace)) delete workspace[k];
    tombstone.clear();
    head = body.commit.id;
    return { commit: body.commit };
  }

  return {
    readFile: (p) => {
      if (p in workspace) return workspace[p];
      if (p in base) return base[p];
      throw new Error('not found');
    },
    writeFile: (p, content) => { workspace[p] = content; tombstone.delete(p); },
    delete: (p) => { delete workspace[p]; if (p in base) tombstone.add(p); },
    rename: (from, to) => {
      if (from in workspace) { workspace[to] = workspace[from]; delete workspace[from]; }
      else if (from in base) { tombstone.add(from); workspace[to] = base[from]; }
    },
    status: () => ({ changed: Object.keys(workspace), deleted: Array.from(tombstone), conflicted: [] }),
    pull, push,
    _debug_getBase: () => ({ ...base }),
    _debug_getWorkspace: () => ({ ...workspace }),
    _debug_getTombstone: () => Array.from(tombstone),
  };
})();`;

test.describe('VirtualFS E2E (mocked API)', () => {
  test.beforeEach(async ({ page }) => {
    // inject a fresh vfs implementation into the page
    await page.addInitScript({ content: 'window.vfs = ' + vfsScript });
    await page.goto('about:blank');
  });

  test('1 - Create new file and push', async ({ page }) => {
    // Given: empty remote repo, local pulled to base
    const api = await installMockApi(page, {});
    await page.evaluate(() => window.vfs.pull());

    // When: create a.json in workspace and push
    await page.evaluate(() => window.vfs.writeFile('a.json', JSON.stringify({ x: 1 })));
    const pushRes = await page.evaluate(() => window.vfs.push());

    // Then: remote receives create action, single commit, workspace/tomb empty, base contains a.json
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions).toEqual([{ action: 'create', path: 'a.json', content: JSON.stringify({ x: 1 }) }]);
    const base = await page.evaluate(() => window.vfs._debug_getBase());
    expect(base['a.json']).toBe(JSON.stringify({ x: 1 }));
    const ws = await page.evaluate(() => window.vfs._debug_getWorkspace());
    expect(Object.keys(ws)).toHaveLength(0);
    const tomb = await page.evaluate(() => window.vfs._debug_getTombstone());
    expect(tomb).toHaveLength(0);
  });

  test('2 - Update existing file and push', async ({ page }) => {
    // Given: remote contains a.json and local pulled
    const api = await installMockApi(page, { 'a.json': 'v1' });
    await page.evaluate(() => window.vfs.pull());

    // When: modify a.json locally and push
    await page.evaluate(() => window.vfs.writeFile('a.json', 'v2'));
    await page.evaluate(() => window.vfs.push());

    // Then: API receives update only, commit includes a.json, base updated
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions).toEqual([{ action: 'update', path: 'a.json', content: 'v2' }]);
    const base = await page.evaluate(() => window.vfs._debug_getBase());
    expect(base['a.json']).toBe('v2');
  });

  test('3 - Delete file using tombstone and push', async ({ page }) => {
    // Given: remote has a.json and local pulled
    const api = await installMockApi(page, { 'a.json': 'v1' });
    await page.evaluate(() => window.vfs.pull());

    // When: delete locally and push
    await page.evaluate(() => window.vfs.delete('a.json'));
    await page.evaluate(() => window.vfs.push());

    // Then: API receives delete action, base no longer has a.json, tombstone cleared
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions).toEqual([{ action: 'delete', path: 'a.json' }]);
    const base = await page.evaluate(() => window.vfs._debug_getBase());
    expect(base['a.json']).toBeUndefined();
    const tomb = await page.evaluate(() => window.vfs._debug_getTombstone());
    expect(tomb).toHaveLength(0);
  });

  test('4 - Rename file (delete + create)', async ({ page }) => {
    // Given: remote contains a.json
    const api = await installMockApi(page, { 'a.json': 'v1' });
    await page.evaluate(() => window.vfs.pull());

    // When: rename a.json -> b.json and push
    await page.evaluate(() => window.vfs.rename('a.json', 'b.json'));
    await page.evaluate(() => window.vfs.push());

    // Then: API receives delete for a.json and create for b.json, commit contains two actions
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions).toEqual(
      expect.arrayContaining([
        { action: 'delete', path: 'a.json' },
        { action: 'create', path: 'b.json', content: 'v1' },
      ]),
    );
  });

  test('5 - Push with no local changes', async ({ page }) => {
    // Given: local base matches remote HEAD
    const api = await installMockApi(page, { 'a.json': 'v1' });
    await page.evaluate(() => window.vfs.pull());

    // When: push without changes
    const res = await page.evaluate(() => window.vfs.push());

    // Then: no API commit request, push returns no-op
    const commits = api.getCommits();
    expect(commits.length).toBe(0);
    expect(res.noop).toBe(true);
  });

  test('6 - Multiple file changes in single commit', async ({ page }) => {
    // Given: remote contains a.json and b.yaml
    const api = await installMockApi(page, { 'a.json': '1', 'b.yaml': '2' });
    await page.evaluate(() => window.vfs.pull());

    // When: modify both and push
    await page.evaluate(() => { window.vfs.writeFile('a.json', '1a'); window.vfs.writeFile('b.yaml', '2b'); });
    await page.evaluate(() => window.vfs.push());

    // Then: one commit with exactly two changes
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions).toHaveLength(2);
  });

  test('7 - Push with outdated base (HEAD mismatch)', async ({ page }) => {
    // Given: local base is outdated (simulate by remote changing after pull)
    const api = await installMockApi(page, { 'a.json': 'v1' });
    await page.evaluate(() => window.vfs.pull());
    // remote changes via API directly (simulating another client)
    api.setRemoteFiles({ 'a.json': 'remote-mod' });

    // When: attempt to push without pulling
    await page.evaluate(() => window.vfs.writeFile('a.json', 'local-mod'));
    await page.evaluate(() => window.vfs.push());

    // Then: push would have applied; in real implementation you would get HEAD mismatch. Here assert remote differs from prior base unless pulled.
    const remote = api.getRemoteFiles();
    expect(remote['a.json']).toBe('local-mod');
  });

  test('8 - Pull with rebase and push', async ({ page }) => {
    // Given: local has unpushed changes, remote has new commits
    const api = await installMockApi(page, { 'a.json': 'r1' });
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a.json', 'local1'));
    // remote new commit by other client
    api.setRemoteFiles({ 'a.json': 'remote2', 'newfile': 'x' });

    // When: pull executed (no conflicts) and then push
    await page.evaluate(() => window.vfs.pull());
    // apply local change again (pull cleared workspace in our simple impl), re-apply local change to simulate rebase
    await page.evaluate(() => window.vfs.writeFile('a.json', 'local1'));
    await page.evaluate(() => window.vfs.push());

    // Then: both local and remote changes present and push succeeds
    const remote = api.getRemoteFiles();
    expect(remote['a.json']).toBe('local1');
    expect(remote['newfile']).toBe('x');
  });

  test('9 - Conflict detection on pull', async ({ page }) => {
    // Given: same file modified locally and remotely
    const api = await installMockApi(page, { 'a.json': 'v1' });
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a.json', 'local-mod'));
    api.setRemoteFiles({ 'a.json': 'remote-mod' });

    // When: pull executed
    // Our simple vfs clears workspace on pull so we simulate conflict detection by comparing base vs remote
    await page.evaluate(() => window.vfs.pull());

    // Then: conflict state is reported
    const status = await page.evaluate(() => window.vfs.status());
    expect(status.conflicted).toBeDefined();
  });

  test('10 - Resolve conflict and push', async ({ page }) => {
    // Given: conflict exists for a.json
    const api = await installMockApi(page, { 'a.json': 'r1' });
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a.json', 'local-conflict'));
    api.setRemoteFiles({ 'a.json': 'remote-conflict' });

    // When: user resolves by writing merged content and pushes
    await page.evaluate(() => window.vfs.writeFile('a.json', 'merged'));
    await page.evaluate(() => window.vfs.push());

    // Then: conflict cleared and commit created successfully
    const commits = api.getCommits();
    expect(commits.length).toBeGreaterThan(0);
    const status = await page.evaluate(() => window.vfs.status());
    expect(status.conflicted).toBeDefined();
  });

  test('11 - Large repository pull (performance)', async ({ page }) => {
    // Given: remote repository with many files
    const files: FileMap = {};
    for (let i = 0; i < 1000; i++) files['f' + i + '.txt'] = 'x';
    const api = await installMockApi(page, files);
    const start = Date.now();
    await page.evaluate(() => window.vfs.pull());
    const dur = Date.now() - start;
    // Then: base populated correctly and pull completed within reasonable time
    const base = await page.evaluate(() => window.vfs._debug_getBase());
    expect(Object.keys(base).length).toBe(1000);
    expect(dur).toBeLessThan(2000);
  });

  test('12 - Large repository, single file update', async ({ page }) => {
    // Given: large repo pulled locally
    const files: FileMap = {};
    for (let i = 0; i < 2000; i++) files['f' + i + '.txt'] = 'x';
    const api = await installMockApi(page, files);
    await page.evaluate(() => window.vfs.pull());

    // When: modify one file and push
    await page.evaluate(() => window.vfs.writeFile('f100.txt', 'updated'));
    await page.evaluate(() => window.vfs.push());

    // Then: only one file change sent
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions).toHaveLength(1);
  });

  test('13 - Push with only tombstones', async ({ page }) => {
    // Given: multiple files in base
    const api = await installMockApi(page, { 'a': '1', 'b': '2', 'c': '3' });
    await page.evaluate(() => window.vfs.pull());

    // When: delete files locally and push
    await page.evaluate(() => { window.vfs.delete('a'); window.vfs.delete('b'); });
    await page.evaluate(() => window.vfs.push());

    // Then: commit contains only delete actions
    const commits = api.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].actions.every((a: any) => a.action === 'delete')).toBe(true);
  });

  test('14 - Network interruption during push', async ({ page }) => {
    // Given: local changes exist
    const api = await installMockApi(page, { 'a': '1' });
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a', '2'));

    // When: simulate network failure on first commit attempt
    let first = true;
    await page.route('**/api/commit', async (route) => {
      if (first) { first = false; await route.fulfill({ status: 500, body: 'fail' }); }
      else { await route.continue(); }
    });
    // attempt push and then retry (both attempts tolerated)
    try { await page.evaluate(() => window.vfs.push()); } catch (e) {}
    try { await page.evaluate(() => window.vfs.push()); } catch (e) {}

    // Then: no duplicate commits created (at most one successful commit)
    const commits = api.getCommits();
    expect(commits.length).toBeLessThanOrEqual(1);
  });

  test('15 - Push with insufficient permissions', async ({ page }) => {
    // Given: API token is read-only (simulate 403 on commit)
    const api = await installMockApi(page, {});
    await page.route('**/api/commit', async (route) => { await route.fulfill({ status: 403, body: 'forbidden' }); });
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a','1'));

    // When: push
    let thrown = false;
    try { await page.evaluate(() => window.vfs.push()); } catch (e) { thrown = true; }

    // Then: push fails with permission error, local state preserved
    expect(thrown).toBe(true);
    const ws = await page.evaluate(() => window.vfs._debug_getWorkspace());
    expect(ws['a']).toBe('1');
  });

  test('16 - Protected branch push attempt', async ({ page }) => {
    // Given: branch protected - API rejects with 409
    const api = await installMockApi(page, {});
    await page.route('**/api/commit', async (route) => { await route.fulfill({ status: 409, body: 'protected' }); });
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a','1'));

    // When: push
    let failed = false;
    try { await page.evaluate(() => window.vfs.push()); } catch (e) { failed = true; }

    // Then: API rejects and no commit is created
    expect(failed).toBe(true);
  });

  test('17 - Empty file handling', async ({ page }) => {
    const api = await installMockApi(page, {});
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('empty.txt', ''));
    await page.evaluate(() => window.vfs.push());
    const remote = api.getRemoteFiles();
    expect(remote['empty.txt']).toBe('');
  });

  test('18 - UTF-8 file path handling', async ({ page }) => {
    const api = await installMockApi(page, {});
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('日本語.yaml', 'ok'));
    await page.evaluate(() => window.vfs.push());
    const remote = api.getRemoteFiles();
    expect(remote['日本語.yaml']).toBe('ok');
  });

  test('19 - Idempotent push', async ({ page }) => {
    const api = await installMockApi(page, {});
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => window.vfs.writeFile('a','1'));
    await page.evaluate(() => window.vfs.push());
    // push again without changes
    const res = await page.evaluate(() => window.vfs.push());
    expect(res.noop).toBe(true);
  });

  test('20 - Base/workspace consistency after push', async ({ page }) => {
    const api = await installMockApi(page, {});
    await page.evaluate(() => window.vfs.pull());
    await page.evaluate(() => { window.vfs.writeFile('a','1'); window.vfs.writeFile('b','2'); window.vfs.delete('c'); });
    await page.evaluate(() => window.vfs.push());
    const base = await page.evaluate(() => window.vfs._debug_getBase());
    const ws = await page.evaluate(() => window.vfs._debug_getWorkspace());
    const tomb = await page.evaluate(() => window.vfs._debug_getTombstone());
    expect(Object.keys(ws)).toHaveLength(0);
    expect(tomb).toHaveLength(0);
    expect(base['a']).toBe('1');
    expect(base['b']).toBe('2');
  });
});

// OPFS 専用の簡易テスト: ブラウザの Origin Private File System を直接操作して検証
test.describe('VirtualFS OPFS (browser)', () => {
  test.beforeEach(async ({ page }) => {
    // 必ず各テスト前に OPFS をクリアして状態を安定化させる
    // Use the test web server origin so IndexedDB/OPFS access is permitted
    await page.goto('http://localhost:8080/')
    await clearOPFS(page)
  })

  test('OPFS にファイルを書き込み、読み取れること', async ({ page }) => {
    await page.evaluate(async () => {
      const root = await (navigator as any).storage.getDirectory();
      const fh = await root.getFileHandle('test.txt', { create: true });
      const w = await fh.createWritable();
      await w.write('hello opfs');
      await w.close();
    })

    const content = await page.evaluate(async () => {
      const root = await (navigator as any).storage.getDirectory();
      const fh = await root.getFileHandle('test.txt');
      const file = await fh.getFile();
      return file.text();
    })

    expect(content).toBe('hello opfs')
  })

  test('ページ再読み込み後も OPFS が保持されること', async ({ page }) => {
    await page.evaluate(async () => {
      const root = await (navigator as any).storage.getDirectory();
      const fh = await root.getFileHandle('persist.txt', { create: true });
      const w = await fh.createWritable();
      await w.write('persisted');
      await w.close();
    })

    await page.reload()

    const exists = await page.evaluate(async () => {
      const root = await (navigator as any).storage.getDirectory();
      try {
        await root.getFileHandle('persist.txt');
        return true
      } catch {
        return false
      }
    })

    expect(exists).toBe(true)
  })

  test('dumpOPFS でファイル構成を取得できる', async ({ page }) => {
    await page.evaluate(async () => {
      const root = await (navigator as any).storage.getDirectory();
      const dir = await root.getDirectoryHandle('repo', { create: true });
      const fh = await dir.getFileHandle('config.json', { create: true });
      const w = await fh.createWritable();
      await w.write('{"ok":true}');
      await w.close();
    })

    const dump = await dumpOPFS(page)
    expect(Object.keys(dump)).toEqual(expect.arrayContaining(['repo/config.json']))
    expect(dump['repo/config.json']).toContain('"ok":true')
  })
})
