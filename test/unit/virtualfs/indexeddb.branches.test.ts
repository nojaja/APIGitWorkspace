// Given（前提）: IndexedDbStorage の未カバー分岐（openDb失敗、tx非InvalidStateErrorリスロー、segment別read/delete）
// When（操作）: 各エラーパス・分岐を実行
// Then（期待）: 期待通りの挙動・エラー処理が行われる
import { jest } from '@jest/globals';

// IndexedDbStorage のインポート前に global.indexedDB を差し替えて、各テストで制御する
let IndexedDbStorage: any;

beforeAll(async () => {
  const mod = await import('../../../src/virtualfs/indexedDbStorage');
  IndexedDbStorage = mod.IndexedDbStorage;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('IndexedDbStorage openDb failure and tx branches', () => {
  // Given（前提）: indexedDB が存在しない環境
  // When（操作）: IndexedDbStorage を構築してから init() を呼ぶ
  // Then（期待）: openDb が reject し、init() もエラーになる
  it('init rejects when openDb fails due to missing indexedDB', async () => {
    // openDb 内部で indexedDB チェックするので、実行時に undefined にする
    const originalIndexedDB = (globalThis as any).indexedDB;
    delete (globalThis as any).indexedDB;
    
    const storage = new IndexedDbStorage();
    await expect(storage.init()).rejects.toThrow('IndexedDB is not available');
    
    // 元に戻す
    if (originalIndexedDB !== undefined) {
      (globalThis as any).indexedDB = originalIndexedDB;
    }
  });

  // Given（前提）: DB open が onerror を発火
  // When（操作）: IndexedDbStorage を構築
  // Then（期待）: dbPromise が reject される
  it('openDb rejects when IDBOpenDBRequest.onerror fires', async () => {
    const fakeOpen = jest.fn(() => {
      const req: any = {
        error: new Error('DB open failed'),
        result: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      // onerror を即座に呼ぶ
      setTimeout(() => {
        if (req.onerror) req.onerror();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await expect(storage.init()).rejects.toThrow('DB open failed');

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: DB transaction が InvalidStateError 以外の例外を投げる
  // When（操作）: tx を呼び出す
  // Then（期待）: 例外がそのまま再throw される（再試行されない）
  it('tx rethrows non-InvalidStateError exceptions without retry', async () => {
    const fakeDB: any = {
      transaction: jest.fn(() => {
        const err: any = new Error('UnknownError');
        err.name = 'UnknownError';
        throw err;
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    // writeIndex 内部で tx を呼ぶが、transaction() が UnknownError を投げるので tx は再試行せず rethrow
    await expect(storage.writeIndex({ version: 1, files: {} })).rejects.toThrow('UnknownError');

    delete (globalThis as any).indexedDB;
  });
});

describe('IndexedDbStorage readBlob segment branches', () => {
  // Given（前提）: base segment に値が存在し、workspace には無い
  // When（操作）: segment 指定なしで readBlob を呼ぶ
  // Then（期待）: workspace を先に見て null、次に base を見て値を返す
  it('readBlob returns value from base when workspace is null', async () => {
    const fakeDB: any = {
      transaction: jest.fn((storeName: string) => {
        const fakeStore: any = {
          get: jest.fn((key: string) => {
            const fakeReq: any = {
              result: storeName === 'git-base' && key === 'test.txt' ? 'base content' : undefined,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              if (fakeReq.onsuccess) fakeReq.onsuccess();
            }, 0);
            return fakeReq;
          }),
        };
        return {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    const content = await storage.readBlob('test.txt');
    expect(content).toBe('base content');

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: conflict segment に値が存在し、workspace/base には無い
  // When（操作）: segment 指定なしで readBlob を呼ぶ
  // Then（期待）: workspace → base を見て両方 null なので null を返す（conflict は参照しない）
  it('readBlob returns null when workspace and base are null (conflict not checked)', async () => {
    const fakeDB: any = {
      transaction: jest.fn((storeName: string) => {
        const fakeStore: any = {
          get: jest.fn((key: string) => {
            const fakeReq: any = {
              result: storeName === 'git-conflict' && key === 'test.txt' ? 'conflict content' : undefined,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              if (fakeReq.onsuccess) fakeReq.onsuccess();
            }, 0);
            return fakeReq;
          }),
        };
        return {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    const content = await storage.readBlob('test.txt');
    expect(content).toBe(null);

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: segment を明示的に 'base' 指定
  // When（操作）: readBlob を呼ぶ
  // Then（期待）: base ストアからのみ読み出す
  it('readBlob with explicit segment=base reads only from base store', async () => {
    const fakeDB: any = {
      transaction: jest.fn((storeName: string) => {
        const fakeStore: any = {
          get: jest.fn((key: string) => {
            const fakeReq: any = {
              result: storeName === 'git-base' && key === 'test.txt' ? 'only base' : undefined,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              if (fakeReq.onsuccess) fakeReq.onsuccess();
            }, 0);
            return fakeReq;
          }),
        };
        return {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    const content = await storage.readBlob('test.txt', 'base');
    expect(content).toBe('only base');

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: segment を明示的に 'conflict' 指定
  // When（操作）: readBlob を呼ぶ
  // Then（期待）: conflict ストアからのみ読み出す
  it('readBlob with explicit segment=conflict reads only from conflict store', async () => {
    const fakeDB: any = {
      transaction: jest.fn((storeName: string) => {
        const fakeStore: any = {
          get: jest.fn((key: string) => {
            const fakeReq: any = {
              result: storeName === 'git-conflict' && key === 'test.txt' ? 'only conflict' : undefined,
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              if (fakeReq.onsuccess) fakeReq.onsuccess();
            }, 0);
            return fakeReq;
          }),
        };
        return {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    const content = await storage.readBlob('test.txt', 'conflict');
    expect(content).toBe('only conflict');

    delete (globalThis as any).indexedDB;
  });
});

describe('IndexedDbStorage deleteBlob segment branches', () => {
  // Given（前提）: segment を 'base' 指定
  // When（操作）: deleteBlob を呼ぶ
  // Then（期待）: base ストアからのみ削除（_deleteFromStore が base で1回だけ呼ばれる）
  it('deleteBlob with segment=base deletes only from base store', async () => {
    let deleteCalls: string[] = [];

    const fakeDB: any = {
      transaction: jest.fn((storeName: string, mode: string) => {
        const fakeStore: any = {
          delete: jest.fn((key: string) => {
            deleteCalls.push(`${storeName}:${key}`);
          }),
        };
        const tx: any = {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
        setTimeout(() => {
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    await storage.deleteBlob('test.txt', 'base');
    expect(deleteCalls).toEqual(['git-base:test.txt']);

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: segment を 'conflict' 指定
  // When（操作）: deleteBlob を呼ぶ
  // Then（期待）: conflict ストアからのみ削除
  it('deleteBlob with segment=conflict deletes only from conflict store', async () => {
    let deleteCalls: string[] = [];

    const fakeDB: any = {
      transaction: jest.fn((storeName: string, mode: string) => {
        const fakeStore: any = {
          delete: jest.fn((key: string) => {
            deleteCalls.push(`${storeName}:${key}`);
          }),
        };
        const tx: any = {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
        setTimeout(() => {
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    await storage.deleteBlob('test.txt', 'conflict');
    expect(deleteCalls).toEqual(['git-conflict:test.txt']);

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: segment 指定なし
  // When（操作）: deleteBlob を呼ぶ
  // Then（期待）: workspace, base, conflict の全ストアから削除
  it('deleteBlob without segment deletes from all stores', async () => {
    let deleteCalls: string[] = [];

    const fakeDB: any = {
      transaction: jest.fn((storeName: string, mode: string) => {
        const fakeStore: any = {
          delete: jest.fn((key: string) => {
            deleteCalls.push(`${storeName}:${key}`);
          }),
        };
        const tx: any = {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
        setTimeout(() => {
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return tx;
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    await storage.deleteBlob('test.txt');
    expect(deleteCalls).toContain('workspace:test.txt');
    expect(deleteCalls).toContain('git-base:test.txt');
    expect(deleteCalls).toContain('git-conflict:test.txt');

    delete (globalThis as any).indexedDB;
  });
});

describe('IndexedDbStorage _getFromStore error branches', () => {
  // Given（前提）: transaction() 呼び出しが例外を投げる
  // When（操作）: _getFromStore を呼ぶ
  // Then（期待）: try-catch で null を返す
  it('_getFromStore returns null when transaction() throws', async () => {
    const fakeDB: any = {
      transaction: jest.fn(() => {
        throw new Error('Transaction creation failed');
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    // readBlob は内部で _getFromStore を呼び、例外を吞んで null を返すはず
    const content = await storage.readBlob('test.txt');
    expect(content).toBeNull();

    delete (globalThis as any).indexedDB;
  });

  // Given（前提）: IDBRequest.onerror が発火
  // When（操作）: _getFromStore を呼ぶ
  // Then（期待）: onerror ハンドラで null を返す
  it('_getFromStore returns null when IDBRequest.onerror fires', async () => {
    const fakeDB: any = {
      transaction: jest.fn((storeName: string) => {
        const fakeStore: any = {
          get: jest.fn(() => {
            const fakeReq: any = {
              result: undefined,
              error: new Error('Get failed'),
              onsuccess: null,
              onerror: null,
            };
            setTimeout(() => {
              if (fakeReq.onerror) fakeReq.onerror();
            }, 0);
            return fakeReq;
          }),
        };
        return {
          objectStore: () => fakeStore,
          oncomplete: null,
          onerror: null,
        };
      }),
      objectStoreNames: { contains: () => true },
      onversionchange: null,
    };

    const fakeOpen = jest.fn(() => {
      const req: any = {
        result: fakeDB,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    });

    (globalThis as any).indexedDB = { open: fakeOpen };

    const storage = new IndexedDbStorage();
    await storage.init();

    const content = await storage.readBlob('test.txt');
    expect(content).toBeNull();

    delete (globalThis as any).indexedDB;
  });
});
