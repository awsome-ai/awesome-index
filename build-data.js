const fs = require('fs');
const path = require('path');

const ROOT_REPO = 'sindresorhus/awesome';
const CACHE_DIR = '.cache/readmes';
const CHUNK_DIR = 'data/chunks';
const MAX_DEPTH = numberEnv('MAX_DEPTH', 3);
const MAX_NODES = numberEnv('MAX_NODES', 100000);

const SKIP_SECTIONS = new Set([
  'content',
  'contents',
  'table of contents',
  'index',
  'license',
  'contributing',
  'contribution',
  'footnotes',
  'legend'
]);

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'node';
}

function normalizeRepo(value) {
  const cleaned = String(value || '')
    .replace(/^https:\/\/github\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
  const match = cleaned.match(/^([a-z0-9_.-]+\/[a-z0-9_.-]+)$/i);
  if (!match) return '';
  const [owner] = match[1].split('/');
  if (['topics', 'collections', 'marketplace', 'orgs', 'features', 'trending', 'search', 'explore'].includes(owner)) {
    return '';
  }
  return match[1];
}

function githubUrl(repo) {
  return repo ? `https://github.com/${repo}` : '';
}

function cacheFile(repo) {
  const [owner, name] = normalizeRepo(repo).split('/');
  return path.join(CACHE_DIR, owner, `${name}.md`);
}

function cleanText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSkippedSection(title) {
  return SKIP_SECTIONS.has(cleanText(title).toLowerCase());
}

function resolveUrl(href, sourceRepo = '') {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (!sourceRepo) return href;
  if (href.startsWith('#')) return `${githubUrl(sourceRepo)}${href}`;
  return `${githubUrl(sourceRepo)}/blob/HEAD/${href.replace(/^\.\//, '')}`;
}

function parseBullet(line, sourceRepo = '') {
  const match = line.match(/^(\s*)-\s+(.+)$/);
  if (!match) return null;

  const indent = Math.floor(match[1].replace(/\t/g, '  ').length / 2);
  const raw = match[2].trim();
  const link = raw.match(/^\[([^\]]+)]\(([^)]+)\)(?:\s+-\s+(.+))?$/);

  if (link) {
    const href = link[2].trim();
    const github = href.match(/^https:\/\/github\.com\/([^/?#)]+\/[^/?#)]+)/i);
    const repo = github ? normalizeRepo(github[1]) : '';
    return {
      indent,
      title: cleanText(link[1]),
      repo,
      url: repo ? githubUrl(repo) : resolveUrl(href, sourceRepo),
      description: cleanText(link[3] || ''),
      external: !repo && /^https?:\/\//i.test(href)
    };
  }

  const plain = raw.match(/^(.+?)(?:\s+-\s+(.+))?$/);
  if (!plain) return null;
  return {
    indent,
    title: cleanText(plain[1]),
    repo: '',
    url: '',
    description: cleanText(plain[2] || ''),
    external: false
  };
}

function parseAwesomeReadme(readme, { idPrefix = '', sourceRepo = '', rootDepth = 0 } = {}) {
  const sections = [];
  let current = null;
  let headingStack = [];
  let listStack = [];
  const seenIds = new Map();

  function uniqueId(base) {
    const clean = slug(base);
    const count = seenIds.get(clean) || 0;
    seenIds.set(clean, count + 1);
    return count ? `${clean}-${count + 1}` : clean;
  }

  for (const line of String(readme || '').split(/\r?\n/)) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = cleanText(heading[2]);
      listStack = [];

      if (level === 1 || isSkippedSection(title)) {
        current = null;
        headingStack = [];
        continue;
      }

      const parentHeading = headingStack
        .slice()
        .reverse()
        .find(item => item.level < level);
      const pathBits = [...headingStack.filter(item => item.level < level).map(item => item.node.title), title];
      const node = {
        id: uniqueId(idPrefix ? `${idPrefix}-${pathBits.join('-')}` : pathBits.join('-')),
        title,
        kind: 'section',
        sourceRepo,
        depth: rootDepth + Math.max(0, level - 2),
        url: sourceRepo ? `${githubUrl(sourceRepo)}#${slug(title)}` : '',
        children: []
      };

      headingStack = headingStack.filter(item => item.level < level);
      if (level === 2 || !parentHeading) {
        current = node;
        sections.push(node);
      } else {
        parentHeading.node.children.push(node);
      }
      headingStack.push({ level, node });
      continue;
    }

    if (!current) continue;
    const bullet = parseBullet(line, sourceRepo);
    if (!bullet || !bullet.title) continue;

    const parentHeading = headingStack[headingStack.length - 1]?.node || current;
    listStack = listStack.slice(0, bullet.indent);
    const pathBits = [
      ...headingStack.map(item => item.node.title),
      ...listStack.map(item => item.title),
      bullet.title
    ];
    const node = {
      id: uniqueId(idPrefix ? `${idPrefix}-${pathBits.join('-')}` : pathBits.join('-')),
      title: bullet.title,
      kind: bullet.repo ? 'repo' : bullet.url ? 'link' : 'topic',
      repo: bullet.repo,
      url: bullet.url,
      description: bullet.description,
      external: bullet.external,
      sourceRepo,
      depth: parentHeading.depth + bullet.indent + 1,
      children: []
    };

    const parent = listStack[bullet.indent - 1];
    if (parent) parent.children.push(node);
    else parentHeading.children.push(node);
    listStack[bullet.indent] = node;
  }

  return sections;
}

function isAwesomeList(node) {
  const repo = normalizeRepo(node.repo);
  const title = String(node.title || '').toLowerCase();
  return !!repo && (repo.includes('/awesome') || repo.includes('awesome-') || title.includes('awesome'));
}

function loadRepoMeta() {
  if (!fs.existsSync('awesome-repos.json')) return new Map();
  const repos = JSON.parse(fs.readFileSync('awesome-repos.json', 'utf8'));
  return new Map(repos.map(repo => [normalizeRepo(repo.repo), repo]));
}

function enrichNode(node, metaByRepo) {
  const meta = node.repo ? metaByRepo.get(normalizeRepo(node.repo)) : null;
  if (meta) {
    node.stars = meta.stars || 0;
    node.forks = meta.forks || 0;
    node.language = meta.language || null;
    node.license = meta.license || null;
    node.topics = meta.topics || [];
    node.updated = meta.updated || null;
    node.pushed = meta.pushed || null;
    node.description = node.description || meta.description || '';
  } else {
    node.stars = 0;
    node.forks = 0;
    node.language = null;
    node.license = null;
    node.topics = [];
    node.updated = null;
    node.pushed = null;
  }
  node.awesome = isAwesomeList(node);
  for (const child of node.children || []) enrichNode(child, metaByRepo);
  return node;
}

function mergeChildren(existing, incoming) {
  const seen = new Set(existing.map(node => `${node.title.toLowerCase()}|${node.repo || node.url || ''}`));
  for (const child of incoming) {
    const key = `${child.title.toLowerCase()}|${child.repo || child.url || ''}`;
    if (!seen.has(key)) {
      existing.push(child);
      seen.add(key);
    }
  }
}

function expandRecursive(nodes, metaByRepo, stats, depth = 1) {
  if (stats.nodes >= MAX_NODES) return;

  for (const node of nodes) {
    stats.nodes += 1;
    if (node.repo) stats.repoNodes += 1;
    if (!node.children?.length) stats.leafNodes += 1;

    if (isAwesomeList(node) && depth < MAX_DEPTH) {
      const file = cacheFile(node.repo);
      if (fs.existsSync(file)) {
        const readme = fs.readFileSync(file, 'utf8');
        const sections = parseAwesomeReadme(readme, {
          idPrefix: node.id,
          sourceRepo: node.repo,
          rootDepth: depth
        });
        mergeChildren(node.children, sections);
        node.readmeStatus = sections.length ? 'expanded' : 'empty';
        stats.expandedReadmes += 1;
      } else {
        node.readmeStatus = 'missing';
        stats.missingReadmes += 1;
      }
    }

    for (const child of node.children || []) enrichNode(child, metaByRepo);
    expandRecursive(node.children || [], metaByRepo, stats, depth + 1);
  }
}

function flattenTree(categories) {
  const rows = [];
  function visit(node, category, pathParts, parentId) {
    const path = [...pathParts, node.title];
    const childCount = countDescendants(node);
    node.path = path;
    node.parentId = parentId;
    rows.push({
      id: node.id,
      parentId,
      title: node.title,
      kind: node.kind,
      category,
      path,
      repo: node.repo || '',
      url: node.url || '',
      description: node.description || '',
      stars: node.stars || 0,
      language: node.language || null,
      license: node.license || null,
      topics: node.topics || [],
      awesome: !!node.awesome,
      readmeStatus: node.readmeStatus || '',
      childCount,
      directChildren: node.children?.length || 0,
      depth: path.length
    });
    for (const child of node.children || []) visit(child, category, path, node.id);
  }

  for (const category of categories) {
    for (const child of category.children) visit(child, category.title, [], category.id);
  }
  return rows;
}

function countDescendants(node) {
  return (node.children || []).reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function categoryStats(category, flatRows) {
  const rows = flatRows.filter(row => row.category === category.title);
  return {
    id: category.id,
    title: category.title,
    count: rows.length,
    repos: rows.filter(row => row.repo).length,
    awesomeLists: rows.filter(row => row.awesome).length,
    leaves: rows.filter(row => row.directChildren === 0).length,
    stars: rows.reduce((sum, row) => sum + (row.stars || 0), 0),
    chunk: `data/chunks/${category.id}.json`
  };
}

function compactForSearch(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    path: row.path,
    repo: row.repo,
    url: row.url,
    description: row.description,
    stars: row.stars,
    language: row.language,
    topics: row.topics,
    awesome: row.awesome,
    childCount: row.childCount,
    depth: row.depth
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function build() {
  const metaByRepo = loadRepoMeta();
  const rootReadme = fs.readFileSync('awesome-readme.md', 'utf8');
  const categories = parseAwesomeReadme(rootReadme, { idPrefix: 'root', sourceRepo: ROOT_REPO, rootDepth: 0 })
    .map(category => enrichNode(category, metaByRepo));

  const stats = {
    maxDepth: MAX_DEPTH,
    maxNodes: MAX_NODES,
    nodes: 0,
    repoNodes: 0,
    leafNodes: 0,
    expandedReadmes: 0,
    missingReadmes: 0
  };

  for (const category of categories) expandRecursive(category.children, metaByRepo, stats, 1);

  const flat = flattenTree(categories);
  const categorySummaries = categories.map(category => categoryStats(category, flat));
  const readmeManifest = fs.existsSync('awesome-readmes.json')
    ? JSON.parse(fs.readFileSync('awesome-readmes.json', 'utf8'))
    : null;

  fs.rmSync(CHUNK_DIR, { recursive: true, force: true });
  fs.mkdirSync(CHUNK_DIR, { recursive: true });
  for (const category of categories) {
    writeJson(path.join(CHUNK_DIR, `${category.id}.json`), category);
  }

  const appStats = {
    generatedAt: new Date().toISOString(),
    rootRepo: ROOT_REPO,
    categories: categorySummaries,
    totals: {
      categories: categories.length,
      nodes: flat.length,
      repos: flat.filter(row => row.repo).length,
      awesomeLists: flat.filter(row => row.awesome).length,
      leaves: flat.filter(row => row.directChildren === 0).length,
      stars: flat.reduce((sum, row) => sum + (row.stars || 0), 0),
      maxTreeDepth: Math.max(...flat.map(row => row.depth), 0),
      maxRecursionDepth: MAX_DEPTH,
      expandedReadmes: stats.expandedReadmes,
      missingReadmes: stats.missingReadmes
    },
    readmes: readmeManifest
      ? {
          total: readmeManifest.total,
          fetched: readmeManifest.fetched,
          cached: readmeManifest.cached,
          missing: readmeManifest.missing
        }
      : null
  };

  writeJson('awesome-tree.json', categories);
  writeJson('awesome-index.json', flat.map(compactForSearch));
  writeJson('awesome-stats.json', appStats);
  writeJson('awesome-data-slim.json', flat.map(compactForSearch));
  fs.writeFileSync('index.html', renderHtml(), 'utf8');

  console.log(`OK: ${categories.length} categories, ${flat.length} nodes, ${stats.expandedReadmes} README expansions`);
}

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Awesome Index - Recursive Knowledge Map</title>
<style>
:root{--bg:#f5f1e8;--paper:#fffdf7;--ink:#20211d;--muted:#6b655a;--line:#d9cfbb;--accent:#0b7568;--accent2:#c74e2b;--gold:#a96f10;--soft:#eee7d8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,"Times New Roman","Noto Serif SC",serif}
button,input,select{font:inherit}
a{color:inherit}
.shell{max-width:1480px;margin:0 auto;padding:24px 22px 42px}
.hero{display:grid;grid-template-columns:minmax(0,1fr) 460px;gap:28px;align-items:end;border-bottom:1px solid var(--line);padding:18px 0 24px}
.eyebrow{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:900}
h1{font-size:clamp(44px,7vw,92px);line-height:.94;margin:14px 0 16px;letter-spacing:0}
.lead{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:18px;line-height:1.75;color:#4f493f;max-width:780px;margin:0}
.summary{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:16px;box-shadow:0 18px 42px rgba(52,44,31,.12)}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.metric{background:#fff8ea;border:1px solid var(--line);border-radius:8px;padding:13px}
.metric span{display:block;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--muted);font-size:12px;margin-bottom:8px}
.metric strong{font-size:28px}
.topbar{display:grid;grid-template-columns:minmax(240px,1fr) auto auto;gap:10px;margin:18px 0}
.search{width:100%;border:1px solid var(--line);background:#fffaf0;border-radius:8px;padding:12px 13px;outline:none;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}
.search:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(11,117,104,.12)}
select,.btn{border:1px solid var(--line);background:#fffaf0;border-radius:8px;padding:10px 12px;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;cursor:pointer}
.layout{display:grid;grid-template-columns:285px minmax(0,1fr) 360px;gap:16px;align-items:start}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:14px}
.sticky{position:sticky;top:14px}
.label{margin:0 0 11px;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:12px;font-weight:900;color:#343129}
.cats{display:grid;gap:8px}
.cat{width:100%;display:grid;grid-template-columns:1fr auto;gap:8px;border:1px solid transparent;background:transparent;border-radius:8px;padding:10px;text-align:left;cursor:pointer;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}
.cat:hover,.cat.active{background:var(--soft);border-color:var(--line)}
.cat.active{color:var(--accent);font-weight:900}
.cat small{color:var(--muted)}
.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
.toolbar h2{font-size:28px;margin:0}
.hint{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--muted);font-size:13px}
.tree{background:var(--paper);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.node{border-top:1px solid var(--line)}
.node:first-child{border-top:0}
.node-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:52px;padding:10px 12px}
.node-row:hover{background:#fff8ea}
.twisty{width:26px;height:26px;border:1px solid var(--line);border-radius:6px;background:#fffaf0;color:var(--accent);font-weight:900;cursor:pointer}
.twisty.blank{visibility:hidden}
.node-main{min-width:0}
.node-title{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.node-title button,.node-title a{font-weight:900;text-decoration:none;border:0;background:transparent;padding:0;text-align:left;cursor:pointer;color:var(--ink)}
.node-title a:hover{text-decoration:underline}
.path{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
.desc{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:13px;color:#615b50;line-height:1.55;margin-top:5px}
.pill{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:3px 7px;background:#fffaf0;color:#5e584e}
.stars{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--gold);font-size:13px;font-weight:900;white-space:nowrap}
.children{display:none}
.node.open>.children{display:block}
.level-1 .node-row{padding-left:28px}.level-2 .node-row{padding-left:48px}.level-3 .node-row{padding-left:68px}.level-4 .node-row{padding-left:88px}.level-5 .node-row{padding-left:108px}
.detail-title{font-size:23px;margin:0 0 8px}
.detail-path{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--accent);font-size:13px;font-weight:900;line-height:1.5;margin-bottom:12px}
.detail-desc{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:#575147;font-size:14px;line-height:1.7;margin:0 0 12px}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.detail-metric{border:1px solid var(--line);border-radius:8px;background:#fffaf0;padding:10px}
.detail-metric span{display:block;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--muted);font-size:11px}
.detail-metric strong{font-size:18px}
.child-links{display:grid;gap:7px;margin-top:10px;max-height:320px;overflow:auto}
.child-links button{border:1px solid var(--line);background:#fffaf0;border-radius:8px;padding:8px;text-align:left;cursor:pointer;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}
.results{display:grid;gap:8px}
.result{border:1px solid var(--line);background:#fffaf0;border-radius:8px;padding:10px;text-align:left;cursor:pointer}
.empty{padding:34px;text-align:center;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;color:var(--muted)}
.footer{border-top:1px solid var(--line);margin-top:24px;padding-top:16px;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:12px;color:var(--muted)}
@media(max-width:1100px){.hero,.layout{grid-template-columns:1fr}.sticky{position:static}.topbar{grid-template-columns:1fr}}
@media(max-width:640px){.shell{padding:16px 12px 32px}.metrics,.detail-grid{grid-template-columns:1fr}.node-row{grid-template-columns:28px 1fr}.stars{grid-column:2}.level-1 .node-row,.level-2 .node-row,.level-3 .node-row,.level-4 .node-row,.level-5 .node-row{padding-left:12px}}
</style>
</head>
<body>
<main class="shell">
  <section class="hero">
    <div>
      <div class="eyebrow">sindresorhus/awesome recursive knowledge map</div>
      <h1>Awesome Index</h1>
      <p class="lead">从 <strong>sindresorhus/awesome</strong> 出发，递归读取子 awesome 仓库 README，把平台、语言、前后端、工具和真正的叶子项目组织成一张可探索的开源知识地图。</p>
    </div>
    <aside class="summary">
      <div class="metrics">
        <div class="metric"><span>官方分类</span><strong id="mCategories">0</strong></div>
        <div class="metric"><span>树节点</span><strong id="mNodes">0</strong></div>
        <div class="metric"><span>Awesome 列表</span><strong id="mAwesome">0</strong></div>
        <div class="metric"><span>README 展开</span><strong id="mReadmes">0</strong></div>
      </div>
    </aside>
  </section>

  <section class="topbar">
    <input class="search" id="search" type="search" placeholder="搜索标题、路径、仓库、描述、topics">
    <select id="mode">
      <option value="all">全部节点</option>
      <option value="awesome">只看 awesome 列表</option>
      <option value="leaf">只看叶子项目</option>
      <option value="popular">只看高 star 节点</option>
    </select>
    <button class="btn" id="clearSearch">清空</button>
  </section>

  <section class="layout">
    <aside class="panel sticky">
      <p class="label">官方分类</p>
      <div class="cats" id="cats"></div>
    </aside>
    <section>
      <div class="toolbar">
        <div>
          <h2 id="viewTitle">加载中</h2>
          <div class="hint" id="viewHint">正在读取数据分片...</div>
        </div>
        <div>
          <button class="btn" onclick="expandVisible()">展开</button>
          <button class="btn" onclick="collapseVisible()">折叠</button>
        </div>
      </div>
      <div class="tree" id="tree"></div>
    </section>
    <aside class="panel sticky" id="detail">
      <p class="label">节点详情</p>
      <h3 class="detail-title">选择一个节点</h3>
      <p class="detail-desc">点击树节点或搜索结果，这里会显示路径、README 来源、GitHub 元数据和直接子节点。</p>
    </aside>
  </section>

  <footer class="footer">数据由 GitHub Actions 抓取 README 后生成。缓存目录不提交，只发布结构化 JSON 和静态页面。</footer>
</main>

<script>
let STATS = null;
let SEARCH = [];
let activeCategory = null;
let activeTree = null;
let flatCache = new Map();
let selectedId = null;

function fmt(n){if(!n)return'0';if(n>=1e6)return(n/1e6).toFixed(1).replace(/\\.0$/,'')+'m';if(n>=1e3)return(n/1e3).toFixed(1).replace(/\\.0$/,'')+'k';return n.toLocaleString()}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function loadJson(url){const r=await fetch(url);if(!r.ok)throw new Error(url+' '+r.status);return r.json()}
function flatten(nodes,path=[],category=''){return nodes.flatMap(n=>{const p=[...path,n.title];return[{...n,path:p,category},...flatten(n.children||[],p,category)]})}
function currentRows(){return activeTree?flatten(activeTree.children||[],[],activeTree.title):[]}
function passMode(row){const m=document.getElementById('mode').value;if(m==='awesome')return row.awesome;if(m==='leaf')return !row.children?.length;if(m==='popular')return (row.stars||0)>=1000;return true}
function match(row,q){if(!q)return true;return[row.title,row.repo,row.description,row.category,...(row.path||[]),...(row.topics||[])].join(' ').toLowerCase().includes(q)}
function filterNode(node,q){const children=(node.children||[]).map(c=>filterNode(c,q)).filter(Boolean);const row={...node,children};if((match({...node,path:[]},q)&&passMode(node))||children.length)return row;return null}

function renderStats(){document.getElementById('mCategories').textContent=STATS.totals.categories;document.getElementById('mNodes').textContent=STATS.totals.nodes.toLocaleString();document.getElementById('mAwesome').textContent=STATS.totals.awesomeLists.toLocaleString();document.getElementById('mReadmes').textContent=STATS.totals.expandedReadmes.toLocaleString()}
function renderCats(){const el=document.getElementById('cats');el.innerHTML=STATS.categories.map(c=>'<button class="cat '+(activeCategory===c.id?'active':'')+'" onclick="selectCategory(\\''+c.id+'\\')"><span>'+esc(c.title)+'</span><small>'+c.count.toLocaleString()+'</small></button>').join('')}
async function selectCategory(id){activeCategory=id;renderCats();const meta=STATS.categories.find(c=>c.id===id);document.getElementById('viewTitle').textContent=meta.title;document.getElementById('viewHint').textContent='正在加载 '+meta.count.toLocaleString()+' 个节点';document.getElementById('tree').innerHTML='<div class="empty">正在加载分类分片...</div>';activeTree=await loadJson(meta.chunk);flatCache.set(id,currentRows());renderTree();const first=activeTree.children?.[0];if(first)selectNode(first.id)}
function renderTree(){if(!activeTree)return;const q=document.getElementById('search').value.trim().toLowerCase();const mode=document.getElementById('mode').value;if(q){renderResults(q);return}const children=(activeTree.children||[]).map(n=>filterNode(n,'')).filter(Boolean);document.getElementById('viewHint').textContent='显示 '+children.length.toLocaleString()+' 个顶层节点 · 模式：'+mode;document.getElementById('tree').innerHTML=children.length?children.map(n=>renderNode(n,1)).join(''):'<div class="empty">当前筛选没有结果。</div>'}
function renderResults(q){const rows=SEARCH.filter(r=>match(r,q)&&passMode(r)).slice(0,80);document.getElementById('viewHint').textContent='搜索结果 '+rows.length.toLocaleString()+' / '+SEARCH.length.toLocaleString();document.getElementById('tree').innerHTML=rows.length?'<div class="results">'+rows.map(r=>'<button class="result" onclick="openSearchResult(\\''+r.id+'\\',\\''+r.category.replace(/'/g,"\\\\'")+'\\')"><strong>'+esc(r.title)+'</strong><div class="path">'+esc([r.category,...r.path].join(' / '))+'</div><div class="desc">'+esc(r.description||r.repo||r.url||'')+'</div></button>').join('')+'</div>':'<div class="empty">没有匹配结果。</div>'}
function renderNode(node,level){const has=(node.children||[]).length>0;const open=level<4?' open':'';return'<div class="node level-'+Math.min(level,5)+open+'" data-id="'+esc(node.id)+'">'+renderRow(node,has)+(has?'<div class="children">'+node.children.map(c=>renderNode(c,level+1)).join('')+'</div>':'')+'</div>'}
function renderRow(node,has){const meta=[node.awesome?'awesome':'',node.language,node.license,has?node.children.length+' 子节点':''].filter(Boolean);const title=node.url&&node.kind!=='section'?'<a href="'+esc(node.url)+'" target="_blank" rel="noopener">'+esc(node.title)+'</a>':'<button onclick="selectNode(\\''+node.id+'\\')">'+esc(node.title)+'</button>';return'<div class="node-row" onclick="selectNode(\\''+node.id+'\\')"><button class="twisty '+(has?'':'blank')+'" onclick="toggleNode(event,this)">'+(has?'▾':'')+'</button><div class="node-main"><div class="node-title">'+title+meta.map(m=>'<span class="pill">'+esc(m)+'</span>').join('')+'</div>'+(node.description?'<div class="desc">'+esc(node.description)+'</div>':'')+'</div><div class="stars">'+(node.stars?fmt(node.stars)+' stars':'')+'</div></div>'}
function allVisibleRows(){return currentRows()}
function findNode(id){return allVisibleRows().find(r=>r.id===id)}
function selectNode(id){selectedId=id;const n=findNode(id);if(!n)return;const children=n.children||[];document.getElementById('detail').innerHTML='<p class="label">节点详情</p><h3 class="detail-title">'+esc(n.title)+'</h3><div class="detail-path">'+esc([activeTree.title,...(n.path||[])].join(' / '))+'</div><p class="detail-desc">'+esc(n.description||n.repo||n.url||'暂无描述')+'</p><div class="detail-grid"><div class="detail-metric"><span>Stars</span><strong>'+fmt(n.stars||0)+'</strong></div><div class="detail-metric"><span>子节点</span><strong>'+children.length+'</strong></div><div class="detail-metric"><span>类型</span><strong>'+esc(n.kind||'-')+'</strong></div><div class="detail-metric"><span>README</span><strong>'+esc(n.readmeStatus||'-')+'</strong></div></div>'+(n.url?'<a class="btn" href="'+esc(n.url)+'" target="_blank" rel="noopener">打开链接</a>':'')+(children.length?'<p class="label" style="margin-top:16px">直接子节点</p><div class="child-links">'+children.slice(0,24).map(c=>'<button onclick="selectNode(\\''+c.id+'\\')">'+esc(c.title)+'</button>').join('')+'</div>':'')}
function revealNode(id){const el=document.querySelector('[data-id="'+CSS.escape(id)+'"]');if(!el)return;let parent=el.parentElement?.closest('.node');while(parent){parent.classList.add('open');const twisty=parent.querySelector(':scope > .node-row .twisty:not(.blank)');if(twisty)twisty.textContent='▾';parent=parent.parentElement?.closest('.node')}el.scrollIntoView({block:'center'})}
async function openSearchResult(id,categoryTitle){const meta=STATS.categories.find(c=>c.title===categoryTitle);if(meta&&activeCategory!==meta.id)await selectCategory(meta.id);document.getElementById('search').value='';renderTree();selectNode(id);revealNode(id)}
function toggleNode(e,b){e.stopPropagation();const n=b.closest('.node');n.classList.toggle('open');b.textContent=n.classList.contains('open')?'▾':'▸'}
function expandVisible(){document.querySelectorAll('#tree .node').forEach(n=>n.classList.add('open'));document.querySelectorAll('#tree .twisty:not(.blank)').forEach(b=>b.textContent='▾')}
function collapseVisible(){document.querySelectorAll('#tree .node').forEach(n=>{if(!n.classList.contains('level-1'))n.classList.remove('open')});document.querySelectorAll('#tree .twisty:not(.blank)').forEach(b=>b.textContent='▸')}
async function init(){document.getElementById('tree').innerHTML='<div class="empty">正在加载知识地图...</div>';[STATS,SEARCH]=await Promise.all([loadJson('awesome-stats.json'),loadJson('awesome-index.json')]);renderStats();activeCategory=STATS.categories[0]?.id;renderCats();document.getElementById('search').addEventListener('input',renderTree);document.getElementById('mode').addEventListener('change',renderTree);document.getElementById('clearSearch').addEventListener('click',()=>{document.getElementById('search').value='';renderTree()});if(activeCategory)await selectCategory(activeCategory)}
init().catch(e=>{document.getElementById('tree').innerHTML='<div class="empty">数据加载失败：'+esc(e.message)+'。请通过 GitHub Pages 或本地 HTTP 服务打开。</div>'})
</script>
</body>
</html>`;
}

module.exports = {
  slug,
  normalizeRepo,
  parseAwesomeReadme,
  parseBullet,
  isAwesomeList,
  cacheFile,
  build
};

if (require.main === module) build();
