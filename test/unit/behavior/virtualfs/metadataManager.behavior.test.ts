/**
 * @test-type behavior
 * @purpose Requirement or design guarantee
 * @policy DO NOT MODIFY
 */

import { jest } from '@jest/globals'
import metadataManager from '../../../../src/virtualfs/metadataManager'

const { updateInfoForWrite } = metadataManager as any

describe('metadataManager.updateInfoForWrite', () => {
  let store: any
  let origCrypto: any

  beforeEach(() => {
    store = { infoBlobs: new Map<string, string>() }
    origCrypto = (globalThis as any).crypto
    jest.clearAllMocks()
  })

  afterEach(() => {
    ;(globalThis as any).crypto = origCrypto
  })

  it('writes parsed JSON when seg is info (valid JSON)', async () => {
    await updateInfoForWrite(store, '/a.txt', 'info', JSON.stringify({ x: 1 }))
    const txt = store.infoBlobs.get('/a.txt')
    expect(txt).toBe(JSON.stringify({ x: 1 }))
  })

  it('writes raw text when seg is info (invalid JSON)', async () => {
    await updateInfoForWrite(store, '/b.txt', 'info', 'not-json')
    const txt = store.infoBlobs.get('/b.txt')
    expect(txt).toBe('not-json')
  })

  it('workspace write without existing uses fallback sha (no WebCrypto)', async () => {
    delete (globalThis as any).crypto
    await updateInfoForWrite(store, '/w1.txt', 'workspace', 'hello')
    const saved = JSON.parse(store.infoBlobs.get('/w1.txt'))
    expect(saved.path).toBe('/w1.txt')
    expect(saved.workspaceSha).toMatch(/^[0-9a-f]{40}$/)
    expect(saved.state).toBe('added')
  })

  it('workspace write preserves baseSha and becomes modified', async () => {
    store.infoBlobs.set('/w2.txt', JSON.stringify({ baseSha: 'base123' }))
    delete (globalThis as any).crypto
    await updateInfoForWrite(store, '/w2.txt', 'workspace', 'content')
    const entry = JSON.parse(store.infoBlobs.get('/w2.txt'))
    expect(entry.baseSha).toBe('base123')
    expect(entry.state).toBe('modified')
    expect(entry.workspaceSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('base write keeps existing workspaceSha and sets baseSha', async () => {
    store.infoBlobs.set('/b.txt', JSON.stringify({ workspaceSha: 'ws' }))
    delete (globalThis as any).crypto
    await updateInfoForWrite(store, '/b.txt', 'base', 'basecontent')
    const entry = JSON.parse(store.infoBlobs.get('/b.txt'))
    expect(entry.workspaceSha).toBe('ws')
    expect(entry.baseSha).toMatch(/^[0-9a-f]{40}$/)
    expect(entry.state).toBe('base')
  })

  it('conflict write preserves fields and sets state conflict', async () => {
    store.infoBlobs.set(
      '/c.txt',
      JSON.stringify({ baseSha: 'b', workspaceSha: 'w', remoteSha: 'r' })
    )
    delete (globalThis as any).crypto
    await updateInfoForWrite(store, '/c.txt', 'conflict', 'ignored')
    const entry = JSON.parse(store.infoBlobs.get('/c.txt'))
    expect(entry.state).toBe('conflict')
    expect(entry.baseSha).toBe('b')
    expect(entry.workspaceSha).toBe('w')
    expect(entry.remoteSha).toBe('r')
  })

  it('unknown segment writes minimal info', async () => {
    delete (globalThis as any).crypto
    await updateInfoForWrite(store, '/u.txt', 'weird', 'x')
    const entry = JSON.parse(store.infoBlobs.get('/u.txt'))
    expect(entry.path).toBe('/u.txt')
    expect(typeof entry.updatedAt).toBe('number')
  })

  it('uses WebCrypto when available to compute sha', async () => {
    // create a fake 20-byte digest [1..20]
    const bytes = new Uint8Array(20)
    for (let i = 0; i < 20; i++) bytes[i] = i + 1
    const ab = bytes.buffer
    ;(globalThis as any).crypto = { subtle: { digest: jest.fn().mockResolvedValue(ab) } }

    await updateInfoForWrite(store, '/wc.txt', 'workspace', 'anything')
    const entry = JSON.parse(store.infoBlobs.get('/wc.txt'))
    const expected = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    expect(entry.workspaceSha).toBe(expected)
  })
})
