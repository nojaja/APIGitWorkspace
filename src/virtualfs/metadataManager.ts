
/* eslint-disable jsdoc/require-jsdoc */
/**
 * Compute SHA-1 hex digest for a string.
 * Prefer Web Crypto (`crypto.subtle.digest`) when available; otherwise
 * fall back to a bundled implementation.
 * @param message input string
 * @returns lower-case hex-encoded SHA-1 digest
 */
async function shaOf(message: string): Promise<string> {
  // Try Web Crypto first (works in browsers and Node 19+/22+ via globalThis.crypto)
  const webcrypto: any = (globalThis as any).crypto
  if (webcrypto && webcrypto.subtle && typeof webcrypto.subtle.digest === 'function') {
    const buf = new TextEncoder().encode(message)
    const digest = await webcrypto.subtle.digest('SHA-1', buf)
    const array = Array.from(new Uint8Array(digest))
    return array.map(b => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback to bundled synchronous implementation when Web Crypto not available.
  return computeSha1Fallback(message)
}

/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Synchronous SHA-1 fallback implementation.
 * Kept as a separate function so `shaOf` remains simple for linting.
 * @param message input string
 * @returns lower-case hex-encoded SHA-1 digest
 */
function computeSha1Fallback(message: string): string {
  const encoder = new TextEncoder()
  const bytes = Array.from(encoder.encode(message))
  const l = bytes.length * 8
  bytes.push(0x80)
  while ((bytes.length % 64) !== 56) bytes.push(0)
  for (let byteIndex = 7; byteIndex >= 0; byteIndex--) bytes.push((l >>> (byteIndex * 8)) & 0xff)

  const words: number[] = []
  for (let index = 0; index < bytes.length; index += 4) {
    words.push((bytes[index] << 24) | (bytes[index + 1] << 16) | (bytes[index + 2] << 8) | (bytes[index + 3]))
  }

  let h0 = 0x67452301
  let h1 = 0xEFCDAB89
  let h2 = 0x98BADCFE
  let h3 = 0x10325476
  let h4 = 0xC3D2E1F0

  for (let index = 0; index < words.length; index += 16) {
    const w = new Array(80) as number[]
    for (let t = 0; t < 16; t++) w[t] = words[index + t] >>> 0
    for (let t = 16; t < 80; t++) {
      const temporary = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]
      w[t] = ((temporary << 1) | (temporary >>> 31)) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, errorReg = h4
    for (let t = 0; t < 80; t++) {
      let f: number, k: number
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }
      const temporaryValue = (((a << 5) | (a >>> 27)) + f + errorReg + k + (w[t] >>> 0)) >>> 0
      errorReg = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temporaryValue
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + errorReg) >>> 0
  }

  const toHex = (n: number) => n.toString(16).padStart(8, '0')
  return (toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4)).toLowerCase()
}
/* eslint-enable sonarjs/cognitive-complexity */

/**
 * Parse existing info JSON stored in the in-memory store.
 * @param store In-memory storage object
 * @param filepath path key
 * @returns parsed info object or undefined when not present/invalid
 */
function parseExistingInfo(store: any, filepath: string): any | undefined {
  const existingTxt = store.infoBlobs.has(filepath) ? store.infoBlobs.get(filepath) : null
  if (!existingTxt) return undefined
  try {
    return JSON.parse(existingTxt)
  } catch (_error) {
    return undefined
  }
}

/**
 * Build info entry for a workspace write.
 * @param existing existing parsed info
 * @param filepath path key
 * @param sha workspace blob sha
 * @param now timestamp
 * @returns info entry object
 */
function buildWorkspaceEntry(existing: any, filepath: string, sha: string, now: number): any {
  const entry: any = { path: filepath, updatedAt: now }
  if (existing && existing.baseSha) entry.baseSha = existing.baseSha
  entry.workspaceSha = sha
  entry.state = entry.baseSha ? 'modified' : 'added'
  if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
  return entry
}

/**
 * Build info entry for a base write.
 * @param existing existing parsed info
 * @param filepath path key
 * @param sha base blob sha
 * @param now timestamp
 * @returns info entry object
 */
function buildBaseEntry(existing: any, filepath: string, sha: string, now: number): any {
  const entry: any = { path: filepath, updatedAt: now }
  if (existing && existing.workspaceSha) entry.workspaceSha = existing.workspaceSha
  entry.baseSha = sha
  entry.state = 'base'
  if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
  return entry
}

/**
 * Build info entry for a conflict write.
 * @param existing existing parsed info
 * @param filepath path key
 * @param now timestamp
 * @returns info entry object
 */
function buildConflictEntry(existing: any, filepath: string, now: number): any {
  const entry: any = { path: filepath, updatedAt: now }
  if (existing && existing.baseSha) entry.baseSha = existing.baseSha
  if (existing && existing.workspaceSha) entry.workspaceSha = existing.workspaceSha
  if (existing && existing.remoteSha) entry.remoteSha = existing.remoteSha
  entry.state = 'conflict'
  return entry
}

/**
 * Update in-memory info metadata when a blob is written to a segment.
 * This is a best-effort helper used by `InMemoryStorage` for tests.
 */
/**
 * Update in-memory info metadata when a blob is written to a segment.
 * @param store in-memory store object
 * @param filepath path key
 * @param seg segment name ('workspace'|'base'|'conflict'|'info')
 * @param content blob content
 * @returns Promise<void>
 */
export async function updateInfoForWrite(store: any, filepath: string, seg: string, content: string): Promise<void> {
  try {
    const now = Date.now()
    const existing = parseExistingInfo(store, filepath)
    if (seg === 'info') {
      // writing info directly: try to parse JSON and store; fallback to raw text
      try {
        const parsed = JSON.parse(content)
        store.infoBlobs.set(filepath, JSON.stringify(parsed))
        return
      } catch (_error) {
        store.infoBlobs.set(filepath, String(content))
        return
      }
    }

    const sha = await shaOf(content)
    let entry: any
    if (seg === 'workspace') {
      entry = buildWorkspaceEntry(existing, filepath, sha, now)
    } else if (seg === 'base') {
      entry = buildBaseEntry(existing, filepath, sha, now)
    } else if (seg === 'conflict') {
      entry = buildConflictEntry(existing, filepath, now)
    } else {
      // unknown segment: write a minimal info
      entry = { path: filepath, updatedAt: now }
    }

    store.infoBlobs.set(filepath, JSON.stringify(entry))
  } catch (_error) {
    // best-effort: swallow errors for in-memory metadata updates
    return
  }
}

export default { updateInfoForWrite }
