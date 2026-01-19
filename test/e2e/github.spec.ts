import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import GitHubAdapter from '../../src/git/githubAdapter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cfgPath = path.join(__dirname, 'github.config.json')

test('github adapter smoke (skips if config missing)', async () => {
  if (!fs.existsSync(cfgPath)) {
    test.skip(true, 'github.config.json not found — fill test/e2e/github.config.json based on example')
    return
  }
  const raw = fs.readFileSync(cfgPath, 'utf8')
  const cfg = JSON.parse(raw)
  if (!cfg.token || cfg.token.startsWith('ghp_replace')) {
    test.skip(true, 'github token not set in config')
    return
  }

  const adapter = new GitHubAdapter({ owner: cfg.owner, repo: cfg.repo, token: cfg.token })

  // simple smoke: create a small blob and then delete it via a simulated tree/commit flow
  const tmpPath = `e2e-test-${Date.now()}.txt`
  const changes = [{ type: 'create', path: tmpPath, content: 'playwright test content' }]

  const blobMap = await adapter.createBlobs(changes, 2)
  expect(blobMap[tmpPath]).toBeTruthy()

  // create tree and commit require a parent SHA — attempt to get default branch ref
  // fetch default branch ref
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' } })
  expect(res.ok).toBeTruthy()
  const repoInfo = await res.json()
  const defaultBranch = repoInfo.default_branch || 'main'

  // get commit sha of default branch
  const refRes = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${defaultBranch}`, { headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' } })
  expect(refRes.ok).toBeTruthy()
  const refInfo = await refRes.json()
  const parentSha = refInfo.object.sha

  const treeSha = await adapter.createTree([{ ...changes[0], blobSha: blobMap[tmpPath] }], undefined)
  expect(treeSha).toBeTruthy()

  const commitSha = await adapter.createCommit('playwright e2e test', parentSha, treeSha)
  expect(commitSha).toBeTruthy()

  // cleanup: attempt to update ref back to parentSha (do not force)
  await adapter.updateRef(`heads/${defaultBranch}`, commitSha, false)
})
