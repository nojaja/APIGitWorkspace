import { Page } from '@playwright/test'

export async function clearOPFS(page: Page) {
  // Ensure an OPFS polyfill exists in new pages (IndexedDB-backed) so tests can run
  await page.addInitScript(() => {
    // Prefer library-provided canUse when available in the page context
    try {
      // @ts-ignore - check for OpfsStorage.canUse
      if (typeof (window as any).OpfsStorage === 'function' && typeof (window as any).OpfsStorage.canUse === 'function') {
        // call and if true, skip polyfill
        const res = (window as any).OpfsStorage.canUse()
        if (res && typeof res.then === 'function') return res.then((v: any) => !!v).catch(() => false)
        if (res) return
      }
    } catch (_) {
      // fallthrough to navigator check
    }
    if ((navigator as any).storage && (navigator as any).storage.getDirectory) return;
    const DB_NAME = 'opfs_mock';

    function openDb(): Promise<IDBDatabase> {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        };
        req.onsuccess = () => resolve(req.result as IDBDatabase);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open error'));
      });
    }

    function makeFileHandle(path: string) {
      return {
        kind: 'file',
        async getFile() {
          const db = await openDb();
          return new Promise<Blob>((resolve) => {
            const tx = db.transaction('files', 'readonly');
            const store = tx.objectStore('files');
            const r = store.get(path);
            r.onsuccess = () => resolve(new Blob([r.result || '']));
            r.onerror = () => resolve(new Blob(['']));
          });
        },
        async createWritable() {
          const chunks: string[] = [];
          return {
            async write(data: BlobPart) { chunks.push(typeof data === 'string' ? data : String(data)); },
            async close() {
              const content = chunks.join('');
              const db = await openDb();
              return new Promise<void>((resolve) => {
                const tx = db.transaction('files', 'readwrite');
                const store = tx.objectStore('files');
                store.put(content, path);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
              });
            }
          };
        }
      };
    }

    function makeDirHandle(prefix: string) {
      return {
        kind: 'directory',
        async getFileHandle(name: string, opts?: { create?: boolean }) {
          const p = prefix ? prefix + '/' + name : name;
          if (opts && opts.create) {
            const db = await openDb();
            await new Promise<void>((resolve) => {
              const tx = db.transaction('files', 'readwrite');
              tx.objectStore('files').put('', p);
              tx.oncomplete = () => resolve();
              tx.onerror = () => resolve();
            });
          }
          return makeFileHandle(p);
        },
        async getDirectoryHandle(name: string, _opts?: { create?: boolean }) {
          const p = prefix ? prefix + '/' + name : name;
          return makeDirHandle(p);
        },
        async *entries() {
          const db = await openDb();
          const tx = db.transaction('files', 'readonly');
          const store = tx.objectStore('files');
          const req = store.openCursor();
          const seen = new Set();
          const prefixPath = prefix ? prefix + '/' : '';
          const results: Array<[string, ReturnType<typeof makeFileHandle> | ReturnType<typeof makeDirHandle>]> = [];
          await new Promise<void>((resolve) => {
            req.onsuccess = (ev: Event) => {
              const cur = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
              if (!cur) { resolve(); return; }
              const key = String(cur.key);
              if (!key.startsWith(prefixPath)) { cur.continue(); return; }
              const rel = key.substring(prefixPath.length);
              const first = rel.split('/')[0];
              if (!seen.has(first)) {
                seen.add(first);
                const isFile = !rel.includes('/');
                const handle = isFile ? makeFileHandle(prefix ? prefix + '/' + first : first) : makeDirHandle(prefix ? prefix + '/' + first : first);
                results.push([first, handle]);
              }
              cur.continue();
            };
            req.onerror = () => resolve();
          });
          for (const r of results) yield r;
        },
        async removeEntry(name: string, _opts?: { recursive?: boolean }) {
          const db = await openDb();
          const keyPrefix = prefix ? prefix + '/' + name : name;
          return new Promise<void>((resolve) => {
            const tx = db.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            const req = store.openCursor();
            req.onsuccess = (ev: Event) => {
              const cur = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
              if (!cur) { resolve(); return; }
              const key = String(cur.key);
              if (key === keyPrefix || key.startsWith(keyPrefix + '/')) cur.delete();
              cur.continue();
            };
            req.onerror = () => resolve();
          });
        }
      };
    }

    (navigator as any).storage = (navigator as any).storage || {};
    (navigator as any).storage.getDirectory = async function() {
      return makeDirHandle('');
    };
    (globalThis as any).originPrivateFileSystem = (globalThis as any).originPrivateFileSystem || { getDirectory: async () => makeDirHandle('') };
  });

  // Remove any previous mock DB so tests start with clean state
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase('opfs_mock');
        req.onsuccess = () => resolve(null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  });
}

export async function dumpOPFS(page: Page) {
  return await page.evaluate(async () => {
    let root: any
    if ((navigator as any).storage && (navigator as any).storage.getDirectory) {
      root = await (navigator as any).storage.getDirectory();
    } else if ((globalThis as any).originPrivateFileSystem && (globalThis as any).originPrivateFileSystem.getDirectory) {
      root = await (globalThis as any).originPrivateFileSystem.getDirectory();
    } else {
      return {}
    }
    const result: Record<string, string> = {};

    async function walk(dir: any, base: string) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') {
          try {
            const file = await handle.getFile();
            result[(base ? base + '/' : '') + name] = await file.text();
          } catch (e) {
            result[(base ? base + '/' : '') + name] = '<read-error>'
          }
        } else if (handle.kind === 'directory') {
          await walk(handle, (base ? base + '/' : '') + name);
        }
      }
    }

    await walk(root, '');
    return result;
  })
}
