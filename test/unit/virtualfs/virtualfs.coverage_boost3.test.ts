import { jest } from '@jest/globals';
import { VirtualFS } from '../../../src/virtualfs/virtualfs';
import { InMemoryStorage } from '../../../src/virtualfs/inmemoryStorage';

describe('VirtualFS coverage boost 3 - broader helper permutations', () => {
  let vfs: any;

  beforeEach(() => {
    vfs = new VirtualFS({ storage: new InMemoryStorage() });
  });

  it('_isEntryConsidered handles empty and deleted entries', () => {
    const fn = (vfs as any)._isEntryConsidered.bind(vfs);
    expect(fn({})).toBe(false);
    expect(fn({ state: 'deleted' })).toBe(false);
    expect(fn({ baseSha: 'b1' })).toBe(false);
    expect(fn({ workspaceSha: 'w1' })).toBe(true);
  });

  it('_changesFromIndexEntry returns arrays for various index shapes', () => {
    const fn = (vfs as any)._changesFromIndexEntry.bind(vfs);
    const r1 = fn({ path: 'a', baseSha: undefined, workspaceSha: 'w1' });
    const r2 = fn({ path: 'b', baseSha: 'b1', workspaceSha: undefined });
    const r3 = fn({ path: 'c', baseSha: 'b2', workspaceSha: 'w2' });
    expect(Array.isArray(r1)).toBe(true);
    expect(Array.isArray(r2)).toBe(true);
    expect(Array.isArray(r3)).toBe(true);
  });

  it('_applyAddsOrUpdates handles empty list without error', async () => {
    const apply = (vfs as any)._applyAddsOrUpdates.bind(vfs);
    const applier = {
      writeBase: jest.fn().mockResolvedValue(undefined),
      writeInfo: jest.fn().mockResolvedValue(undefined)
    };
    await expect(apply([], applier)).resolves.not.toThrow();
  });

  it('_computeRemoteShas accepts empty and populated snapshots', async () => {
    const compute = (vfs as any)._computeRemoteShas.bind(vfs);
    const empty = await compute([]);
    expect(typeof empty).toBe('object');
    const populated = await compute([{ path: 'a', sha: 's' }, { path: 'b', sha: 't' }]);
    // ensure returned object has same number of keys as input
    expect(Object.keys(populated).length).toBe(2);
  });
});
