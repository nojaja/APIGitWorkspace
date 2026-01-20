const fs = require('fs');
const { setTimeout: wait } = require('timers/promises');

const GITLAB_URL = process.env.GITLAB_URL || 'http://gitlab';
let ROOT_PASSWORD = process.env.ROOT_PASSWORD;
if (!ROOT_PASSWORD) {
  try {
    const initPath = '/etc/gitlab/initial_root_password';
    if (fs.existsSync(initPath)) {
      const txt = fs.readFileSync(initPath, 'utf8');
      const m = txt.match(/^Password:\s*(.+)$/m);
      if (m) ROOT_PASSWORD = m[1].trim();
    }
  } catch (e) {
    // ignore, fallback below
  }
  if (!ROOT_PASSWORD) ROOT_PASSWORD = 'password';
}
const PROJECT_NAME = process.env.PROJECT_NAME || 'test-repo';
const path = require('path');
const OUTPUT_FILE = process.env.OUTPUT_FILE || path.join('test', 'conf', 'gitlab.config.json');

const GITLAB_HOST_HEADER = process.env.GITLAB_HOST_HEADER || 'localhost:8929';

function fetchWithHost(url, opts = {}) {
  opts.headers = opts.headers || {};
  // Ensure Host header matches external_url (nginx requirement)
  if (!opts.headers.Host && !opts.headers.host) opts.headers.Host = GITLAB_HOST_HEADER;
  return fetch(url, opts);
}

async function waitForGitLab() {
  const probes = [
    '/-/readiness',
    '/-/health',
    '/help',
    '/api/v4/version'
  ];

  for (let i = 0; i < 200; i++) {
    for (const p of probes) {
      const url = `${GITLAB_URL}${p}`;
      try {
        const res = await fetchWithHost(url, { method: 'GET' });
        // treat 200 as ready; some endpoints may return 401 until fully configured
        if (res.ok) return;
      } catch (e) {
        // ignore and try next probe
      }
    }
    await wait(3000);
  }
  throw new Error('GitLab did not become ready in time');
}

async function createSession() {
  const url = `${GITLAB_URL}/api/v4/session`;
  const body = JSON.stringify({ login: 'root', password: ROOT_PASSWORD });
  const res = await fetchWithHost(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (res.status === 404) {
    throw new Error('Session endpoint not found (404). GitLab API may be unavailable or changed. Consider creating a personal access token for `root` and set PRIVATE_TOKEN in the setup container.');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.private_token) throw new Error('No private_token in session response');
  return data.private_token;
}

async function createProject(token) {
  const url = `${GITLAB_URL}/api/v4/projects`;
  const res = await fetchWithHost(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
    },
    body: JSON.stringify({ name: PROJECT_NAME, path: PROJECT_NAME, initialize_with_readme: true }),
  });
  if (res.status === 400) {
    const list = await fetchWithHost(`${GITLAB_URL}/api/v4/projects?search=${encodeURIComponent(PROJECT_NAME)}`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (list.ok) {
      const arr = await list.json();
      const found = arr.find((p) => p.path === PROJECT_NAME || p.path_with_namespace.endsWith('/' + PROJECT_NAME));
      if (found) return found;
    }
    const txt = await res.text();
    throw new Error(`Failed to create project (400): ${txt}`);
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to create project: ${res.status} ${txt}`);
  }
  return await res.json();
}

async function main() {
  console.log('Waiting for GitLab to be ready at', GITLAB_URL);
  await waitForGitLab();
  console.log('GitLab ready — creating session');
  const token = process.env.PRIVATE_TOKEN || await createSession();
  console.log('Obtained token (length):', token.length);
  const project = await createProject(token);
  console.log('Project created:', project.path_with_namespace);

  const config = {
    projectId: encodeURIComponent(project.path_with_namespace),
    token: token,
    host: GITLAB_URL,
  };

  // Ensure parent directory exists when not running in container
  try {
    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore directory creation errors, write will fail later if necessary
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(config, null, 2), { encoding: 'utf8' });
  console.log('Wrote config to', OUTPUT_FILE);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
