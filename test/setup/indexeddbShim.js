// Minimal IndexedDB shim for Jest/node tests (very small subset)
(function () {
  if (typeof globalThis.indexedDB !== 'undefined') return;

  function createDB() {
    const stores = new Map()
    const db = {
      _stores: stores,
      createObjectStore(name) {
        if (!stores.has(name)) stores.set(name, new Map())
        return {}
      },
      objectStoreNames: {
        contains(name) { return stores.has(name) },
        item(i) { return Array.from(stores.keys())[i] || null },
        get length() { return stores.size }
      },
      transaction(storeNames) {
        // simple tx object that tracks pending requests and fires oncomplete
        const tx = { oncomplete: null, onerror: null }
        const pending = { count: 0 }
        const makeStore = (name) => {
          const store = stores.get(name) || new Map()
          return {
            put(value, key) {
              pending.count++
              const req = { onsuccess: null, onerror: null, result: null }
              setTimeout(() => {
                store.set(key, value)
                req.result = value
                if (req.onsuccess) req.onsuccess({ target: req })
                pending.count--
                if (pending.count === 0 && typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx })
              }, 0)
              return req
            },
            get(key) {
              pending.count++
              const req = { onsuccess: null, onerror: null, result: store.get(key) }
              setTimeout(() => {
                if (req.onsuccess) req.onsuccess({ target: req })
                pending.count--
                if (pending.count === 0 && typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx })
              }, 0)
              return req
            },
            delete(key) {
              pending.count++
              const req = { onsuccess: null, onerror: null }
              setTimeout(() => {
                store.delete(key)
                if (req.onsuccess) req.onsuccess({ target: req })
                pending.count--
                if (pending.count === 0 && typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx })
              }, 0)
              return req
            },
            openKeyCursor() {
              const keys = Array.from(store.keys())
              let idx = 0
              const req = { onsuccess: null }
              const callNext = () => {
                setTimeout(() => {
                  if (idx >= keys.length) {
                    if (req.onsuccess) req.onsuccess({ target: { result: null } })
                    if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx })
                    return
                  }
                  const key = keys[idx++]
                  const cursor = { key, continue: callNext }
                  if (req.onsuccess) req.onsuccess({ target: { result: cursor } })
                }, 0)
              }
              callNext()
              return req
            },
            openCursor() {
              const entries = Array.from(store.entries()).map(([k, v]) => ({ key: k, value: v }))
              let idx = 0
              const req = { onsuccess: null }
              const callNext = () => {
                setTimeout(() => {
                  if (idx >= entries.length) {
                    if (req.onsuccess) req.onsuccess({ target: { result: null } })
                    if (typeof tx.oncomplete === 'function') tx.oncomplete({ target: tx })
                    return
                  }
                  const cur = { key: entries[idx].key, value: entries[idx].value, continue: callNext }
                  idx++
                  if (req.onsuccess) req.onsuccess({ target: { result: cur } })
                }, 0)
              }
              callNext()
              return req
            }
          }
        }
        return {
          objectStore(name) {
            return makeStore(name)
          }
        }
      },
      close() {}
    }
    return db
  }

  globalThis.indexedDB = {
    open(dbName, version) {
      const req = { onsuccess: null, onupgradeneeded: null, onerror: null, result: null };
      setTimeout(() => {
        const db = createDB();
        req.result = db;
        if (typeof req.onupgradeneeded === 'function') req.onupgradeneeded({ target: { result: db } });
        if (typeof req.onsuccess === 'function') req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
})();
