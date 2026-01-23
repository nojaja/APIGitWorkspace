import { describe, it, expect } from '@jest/globals'

// Tests depending on internal in-memory caches (base/index) were removed
// because VirtualFS now delegates base/index management to StorageBackend.
// Keep a skipped placeholder to avoid reintroducing fragile internal assumptions.

describe.skip('VirtualFS classify & base read flows (skipped - removed)', () => {
  it('skipped', () => { expect(true).toBe(true) })
})
