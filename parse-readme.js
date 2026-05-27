const fs = require('fs');
const https = require('https');
const readme = fs.readFileSync('awesome-readme.md', 'utf8');

// Parse all markdown links: [text](url)
const linkRegex = /\[([^\]]+)\]\(https:\/\/github\.com\/([^\/]+\/[^\/\)]+)\)/g;
const repos = new Map();
let match;

while ((match = linkRegex.exec(readme)) !== null) {
  const name = match[1].trim();
  const repo = match[2].replace(/\/$/, '');
  // Filter: only unique, only actual awesome repos, skip anchors
  if (repo.includes('/awesome') || name.toLowerCase().includes('awesome')) {
    if (!repos.has(repo)) {
      repos.set(repo, { name, repo, status: 'pending' });
    }
  }
}

// Also get all repos even if not awesome-named (anything under github.com)
linkRegex.lastIndex = 0;
while ((match = linkRegex.exec(readme)) !== null) {
  const name = match[1].trim();
  const repo = match[2].replace(/\/$/, '');
  if (!repos.has(repo) && !name.startsWith('#') && !name.startsWith('awesome-')) {
    repos.set(repo, { name, repo, status: 'pending' });
  }
}

let entries = Array.from(repos.values());
// Filter out non-list items (single project links usually aren't in sections)
const sectionHeaders = readme.match(/^## \w+/gm) || [];
entries = entries.filter(e => {
  // Find which section this link appears in
  const idx = readme.indexOf(e.name);
  if (idx < 0) return true;
  const before = readme.substring(0, idx);
  const section = before.split('\n').filter(l => l.startsWith('## ')).pop() || '';
  // Skip things under ## Contents, ## License, ## Contribution
  if (/Contents|License|Contribution|Footnotes|Legend/i.test(section)) return false;
  return true;
});

console.log(`Found ${entries.length} potential sub-list entries`);
fs.writeFileSync('awesome-entries.json', JSON.stringify(entries, null, 2));
console.log('Saved to awesome-entries.json');
