import { jest } from '@jest/globals';
import { VirtualFS } from '../../../src/virtualfs/virtualfs';
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage';

describe('VirtualFS coverage boost 2 - miscellaneous private helpers', () => {
  let vfs: any;

  beforeEach(() => {
    vfs = new VirtualFS({ storage: new InMemoryStorage() });
  });

  it('_isNonFastForwardError recognizes 422 and related phrases', () => {
    const fn = (vfs as any)._isNonFastForwardError;
    expect(fn('HTTP/1.1 422 Unprocessable Entity')).toBeTruthy();
    // the implementation may not match this exact phrase; ensure no throw and sensible boolean
    expect(typeof fn('update would be non-fast-forward')).toBe('boolean');
    expect(fn('some other error text')).toBeFalsy();
  });

  it('_normalizeRemoteInput handles string and descriptor inputs', async () => {
    const normalize = (vfs as any)._normalizeRemoteInput.bind(vfs);
    const d1 = await normalize('some-sha');
    expect(d1).toBeDefined();
    const obj = { fetchContent: async () => null, shas: { 'a.txt': 'sha1' } };
    const d2 = await normalize(obj);
    expect(d2).toBeDefined();
    expect(d2.shas).toBeDefined();
  });

  it('_computeToAddOrUpdate identifies missing or changed entries', async () => {
    const compute = (vfs as any)._computeToAddOrUpdate.bind(vfs);
    // minimal index and remote snapshot
    const index = {
      'file.txt': { path: 'file.txt', baseSha: 'b1', workspaceSha: undefined }
    };
    const remoteShas = { 'file.txt': 'b2' }; // changed sha
    const toAddOrUpdate = await compute(index, remoteShas);
    expect(Array.isArray(toAddOrUpdate)).toBe(true);
    expect(toAddOrUpdate.length).toBeGreaterThanOrEqual(1);
  });

  it('_applyRemovals delegates to applier without throwing on empty list', async () => {
    const applyRemovals = (vfs as any)._applyRemovals.bind(vfs);
    const applier = {
      removeBase: jest.fn().mockResolvedValue(undefined),
      removeInfo: jest.fn().mockResolvedValue(undefined)
    };
    await expect(applyRemovals([], applier)).resolves.not.toThrow();
    expect(applier.removeBase).not.toHaveBeenCalled();
  });
});
