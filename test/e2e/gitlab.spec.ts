import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import GitLabAdapter from '../../src/git/gitlabAdapter.clean'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cfgPath = path.join(__dirname, 'gitlab.config.json')

test('gitlab adapter smoke (skips if config missing)', async () => {
  if (!fs.existsSync(cfgPath)) {
    test.skip(true, 'gitlab.config.json not found — fill test/e2e/gitlab.config.json based on example')
    return
  }
  const raw = fs.readFileSync(cfgPath, 'utf8')
  const cfg = JSON.parse(raw)
  if (!cfg.token || cfg.token.startsWith('glpat_replace')) {
    test.skip(true, 'gitlab token not set in config')
    return
  }

  const adapter = new GitLabAdapter({ projectId: cfg.projectId, token: cfg.token, host: cfg.host })

  const tmpPath = `e2e-gitlab-${Date.now()}.txt`
  const changes = [{ type: 'create', path: tmpPath, content: 'gitlab e2e test content' }]

  // create commit that adds the file
  const branch = 'main' // default; could be parameterized
  const commit = await adapter.createCommitWithActions(branch, 'playwright gitlab e2e create', changes)
  expect(commit).toBeTruthy()

  // cleanup: delete the file in another commit
  const del = await adapter.createCommitWithActions(branch, 'playwright gitlab e2e delete', [{ type: 'delete', path: tmpPath }])
  expect(del).toBeTruthy()
})
