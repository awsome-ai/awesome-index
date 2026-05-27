const fs = require('fs');
const https = require('https');

const entries = JSON.parse(fs.readFileSync('awesome-entries.json', 'utf8'));

// Priority: awesome-* named repos first
const awesomeEntries = entries.filter(e => e.repo.includes('/awesome') || e.name.toLowerCase().includes('awesome'));
const output = [];
let done = 0;
let fails = 0;

function fetchRepo(repo, callback) {
  const url = `https://api.github.com/repos/${repo}`;
  const opts = {
    hostname: 'api.github.com', path: `/repos/${repo}`,
    headers: { 'User-Agent': 'awesome-index/1.0' }
  };
  https.get(opts, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode === 200) {
        try { callback(null, JSON.parse(data)); } catch(e) { callback(e); }
      } else if (res.statusCode === 403) {
        // Rate limited
        callback({ rateLimited: true, body: data });
      } else {
        callback({ status: res.statusCode });
      }
    });
  }).on('error', callback);
}

function processNext(idx) {
  if (idx >= awesomeEntries.length) {
    console.log(`Done. Fetched ${output.length}/${done + fails} (fails: ${fails})`);
    fs.writeFileSync('awesome-repos.json', JSON.stringify(output, null, 2));
    return;
  }

  const entry = awesomeEntries[idx];
  fetchRepo(entry.repo, (err, data) => {
    done++;
    if (err) {
      if (err.rateLimited) {
        console.log(`\n⚠️  Rate limited at ${idx}/${awesomeEntries.length}. Saving progress.`);
        fs.writeFileSync('awesome-repos.json', JSON.stringify(output, null, 2));
        fs.writeFileSync('_resume_idx.txt', String(idx));
        return;
      }
      fails++;
      processNext(idx + 1);
      return;
    }
    output.push({
      name: entry.name,
      repo: entry.repo,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      topics: data.topics || [],
      language: data.language,
      updated: data.updated_at,
      pushed: data.pushed_at,
      license: data.license?.spdx_id || null,
      openIssues: data.open_issues_count,
      url: data.html_url
    });
    process.stdout.write(`\r  [${idx + 1}/${awesomeEntries.length}] ${entry.repo} ⭐${data.stargazers_count}`);
    // Respect rate limit: 1 req/s
    setTimeout(() => processNext(idx + 1), 1200);
  });
}

console.log(`Starting fetch for ${awesomeEntries.length} awesome repos...`);
processNext(0);
