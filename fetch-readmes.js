const fs = require('fs');
const https = require('https');
const path = require('path');
const { parseAwesomeReadme, normalizeRepo, isAwesomeList, slug } = require('./build-data');

const ROOT_REPO = 'sindresorhus/awesome';
const CACHE_DIR = '.cache/readmes';
const MANIFEST_PATH = 'awesome-readmes.json';
const META_PATH = 'awesome-repos.json';
const ROOT_README_PATH = 'awesome-readme.md';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const MAX_DEPTH = numberEnv('MAX_DEPTH', 3);
const MAX_REPOS = numberEnv('MAX_REPOS', 1500);
const CONCURRENCY = numberEnv('CONCURRENCY', 12);
const REQUEST_TIMEOUT_MS = numberEnv('REQUEST_TIMEOUT_MS', 10000);

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cacheFile(repo) {
  const [owner, name] = normalizeRepo(repo).split('/');
  return path.join(CACHE_DIR, owner, `${name}.md`);
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function request(url, { accept = 'application/vnd.github+json', retries = 1 } = {}) {
  return new Promise(resolve => {
    const headers = {
      'User-Agent': 'awesome-index/2.0',
      Accept: accept
    };
    if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

    const req = https.get(url, { headers, timeout: REQUEST_TIMEOUT_MS }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        request(res.headers.location, { accept, retries }).then(resolve);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, body, headers: res.headers });
          return;
        }
        if (retries > 0 && [403, 429, 500, 502, 503, 504].includes(res.statusCode)) {
          await sleep(1200);
          resolve(request(url, { accept, retries: retries - 1 }));
          return;
        }
        resolve({ ok: false, status: res.statusCode, body, headers: res.headers });
      });
    });

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', async error => {
      if (retries > 0 && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'timeout'].includes(error.code || error.message)) {
        await sleep(1200);
        resolve(request(url, { accept, retries: retries - 1 }));
        return;
      }
      resolve({ ok: false, status: 0, body: error.message, headers: {} });
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchReadme(repo) {
  const normalized = normalizeRepo(repo);
  const target = cacheFile(normalized);
  if (fs.existsSync(target)) {
    return { repo: normalized, status: 'cached', path: target, bytes: fs.statSync(target).size };
  }

  const api = await request(`https://api.github.com/repos/${normalized}/readme`, {
    accept: 'application/vnd.github.raw',
    retries: GITHUB_TOKEN ? 2 : 0
  });
  if (api.ok && api.body.trim()) {
    ensureDir(target);
    fs.writeFileSync(target, api.body, 'utf8');
    return { repo: normalized, status: 'fetched', path: target, bytes: Buffer.byteLength(api.body) };
  }

  for (const branch of ['main', 'master']) {
    for (const file of ['README.md', 'readme.md', 'Readme.md']) {
      const raw = await request(`https://raw.githubusercontent.com/${normalized}/${branch}/${file}`, {
        accept: 'text/plain',
        retries: 0
      });
      if (raw.ok && raw.body.trim()) {
        ensureDir(target);
        fs.writeFileSync(target, raw.body, 'utf8');
        return { repo: normalized, status: 'fetched', path: target, bytes: Buffer.byteLength(raw.body) };
      }
    }
  }

  return { repo: normalized, status: 'missing', error: `README not found (${api.status})` };
}

async function fetchRepoMeta(repo) {
  const normalized = normalizeRepo(repo);
  const res = await request(`https://api.github.com/repos/${normalized}`, { retries: GITHUB_TOKEN ? 2 : 0 });
  if (!res.ok) return null;

  const data = JSON.parse(res.body);
  return {
    repo: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    topics: data.topics || [],
    language: data.language,
    license: data.license?.spdx_id || null,
    updated: data.updated_at,
    pushed: data.pushed_at,
    openIssues: data.open_issues_count,
    url: data.html_url,
    created: data.created_at
  };
}

async function fetchRootReadme() {
  const result = await fetchReadme(ROOT_REPO);
  if (result.status === 'missing') {
    throw new Error(`Unable to fetch root README for ${ROOT_REPO}`);
  }
  fs.copyFileSync(result.path, ROOT_README_PATH);
  return result;
}

function collectAwesomeReposFromReadme(readme, sourceRepo, depth) {
  const sections = parseAwesomeReadme(readme, {
    idPrefix: slug(sourceRepo),
    sourceRepo,
    rootDepth: depth
  });
  const repos = [];

  function visit(nodes) {
    for (const node of nodes) {
      if (node.repo && isAwesomeList(node)) {
        repos.push({ repo: node.repo, depth: depth + 1 });
      }
      if (node.children?.length) visit(node.children);
    }
  }

  visit(sections.flatMap(section => section.children));
  return repos;
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const startedAt = new Date().toISOString();
  const root = await fetchRootReadme();
  const queue = [{ repo: ROOT_REPO, depth: 0 }];
  const seen = new Set();
  const readmes = [];
  const metadata = new Map();
  const failures = [];

  console.log(`Root README: ${root.status} ${ROOT_REPO}`);

  for (let cursor = 0; cursor < queue.length && cursor < MAX_REPOS; cursor++) {
    const item = queue[cursor];
    const repo = normalizeRepo(item.repo);
    if (seen.has(repo)) continue;
    seen.add(repo);

    const result = repo === ROOT_REPO ? root : await fetchReadme(repo);
    readmes.push({ ...result, depth: item.depth });
    console.log(`[${readmes.length}] ${result.status}: ${repo} depth=${item.depth}`);

    if (result.status === 'missing') {
      failures.push(result);
      continue;
    }

    if (repo !== ROOT_REPO) {
      const meta = await fetchRepoMeta(repo);
      if (meta) metadata.set(normalizeRepo(meta.repo), meta);
    }

    if (item.depth >= MAX_DEPTH - 1) continue;
    const readme = fs.readFileSync(result.path, 'utf8');
    for (const child of collectAwesomeReposFromReadme(readme, repo, item.depth)) {
      if (!seen.has(child.repo) && queue.length < MAX_REPOS) queue.push(child);
    }
  }

  const existing = fs.existsSync(META_PATH)
    ? JSON.parse(fs.readFileSync(META_PATH, 'utf8'))
    : [];
  for (const meta of existing) {
    if (!metadata.has(normalizeRepo(meta.repo))) metadata.set(normalizeRepo(meta.repo), meta);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    startedAt,
    rootRepo: ROOT_REPO,
    maxDepth: MAX_DEPTH,
    maxRepos: MAX_REPOS,
    total: readmes.length,
    fetched: readmes.filter(item => item.status === 'fetched').length,
    cached: readmes.filter(item => item.status === 'cached').length,
    missing: readmes.filter(item => item.status === 'missing').length,
    readmes,
    failures
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(META_PATH, JSON.stringify([...metadata.values()], null, 2) + '\n');

  console.log(`Done. readmes=${manifest.total}, fetched=${manifest.fetched}, cached=${manifest.cached}, missing=${manifest.missing}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { fetchReadme, fetchRepoMeta, collectAwesomeReposFromReadme };
