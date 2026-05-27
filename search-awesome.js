const https = require('https');
const fs = require('fs');

const allRepos = [];
const pageSize = 100;

function searchAwesome(page) {
  return new Promise((resolve, reject) => {
    const url = `/search/repositories?q=awesome+in:name+stars:>500&sort=stars&per_page=${pageSize}&page=${page}`;
    const opts = { hostname: 'api.github.com', path: url, headers: { 'User-Agent': 'awesome-index/1.0' } };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else reject(`HTTP ${res.statusCode}: ${data.substring(0,200)}`);
      });
    }).on('error', reject);
  });
}

async function main() {
  try {
    const first = await searchAwesome(1);
    const total = Math.min(first.total_count, 1000);
    console.log(`Found ${first.total_count} awesome repos. Fetching...`);
    
    for (const r of first.items) allRepos.push(r);
    const totalPages = Math.ceil(total / pageSize);
    
    for (let p = 2; p <= totalPages; p++) {
      await new Promise(r => setTimeout(r, 1500)); // 1.5s delay to avoid rate limit
      try {
        const page = await searchAwesome(p);
        for (const r of page.items) allRepos.push(r);
        console.log(`  Page ${p}/${totalPages}: +${page.items.length} repos (total ${allRepos.length})`);
      } catch(e) {
        console.log(`  Page ${p} failed: ${e.message || e}`);
        break;
      }
    }
  } catch(e) {
    console.error(`Search failed: ${e}`);
  }
  
  // Process into clean format
  const result = allRepos.map(r => ({
    repo: r.full_name,
    description: r.description,
    stars: r.stargazers_count,
    forks: r.forks_count,
    topics: r.topics || [],
    language: r.language,
    license: r.license?.spdx_id || null,
    updated: r.updated_at,
    pushed: r.pushed_at,
    openIssues: r.open_issues_count,
    url: r.html_url,
    created: r.created_at,
    category: r.topics?.includes('awesome') ? 'awesome-list' : 'tool'
  }));
  
  // Deduplicate
  const seen = new Set();
  const unique = result.filter(r => {
    if (seen.has(r.repo)) return false;
    seen.add(r.repo);
    return true;
  });
  
  fs.writeFileSync('awesome-repos.json', JSON.stringify(unique, null, 2));
  console.log(`\nDone! Saved ${unique.length} repos to awesome-repos.json`);
}

main().catch(console.error);
