import { test, expect } from '@playwright/test';
import { clearOPFS } from './helpers/opfs'
import fs from 'fs/promises'
import path from 'path'

test.describe('Examples UI smoke', () => {
  test.beforeEach(async ({ page }) => {
    await clearOPFS(page)
  })
  test('connect, initVfs, listAdapters', async ({ page }) => {
    const messages: string[] = []
    page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`))

    await page.goto('http://127.0.0.1:8080')
    await page.waitForSelector('#repoInput')

    // load GitHub config (owner/repo/token) from test/conf/github.config.json
    const candidates = [
      path.resolve(process.cwd(), 'test', 'conf', 'github.config.json'),
      path.resolve(process.cwd(), '..', 'test', 'conf', 'github.config.json')
    ]
    let cfg: { owner: string; repo: string; token: string } | undefined
    for (const p of candidates) {
      try {
        const txt = await fs.readFile(p, 'utf8')
        cfg = JSON.parse(txt)
        break
      } catch (e) {
        // ignore and try next candidate
      }
    }
    if (!cfg) throw new Error('test/conf/github.config.json が見つかりません')
    const repoUrl = `https://github.com/${cfg.owner}/${cfg.repo}`
    await page.fill('#repoInput', repoUrl)
    await page.fill('#tokenInput', cfg.token)
    await page.click('#connectBtn')
    await page.waitForTimeout(500)

    await page.click('#connectIndexedDb')
    await page.waitForTimeout(700)

    await page.click('#listAdapters')
    await page.waitForTimeout(300)

    const out = await page.locator('#output').innerText()

    console.log('--- PAGE OUTPUT ---')
    console.log(out)
    console.log('--- CONSOLE MESSAGES ---')
    for (const m of messages) console.log(m)

    // Basic assertions: output contains adapter creation and vfs init attempt
    expect(out).toContain('GitHubAdapter 作成')
    expect(out).toContain('VirtualFS 作成')
  })
})
