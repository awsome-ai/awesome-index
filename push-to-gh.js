const fs = require('fs');
const https = require('https');
const token = process.argv[2]; // pass token as arg

const files = [
  'README.md', 'index.html', 'search-awesome.js',
  'awesome-repos.json', 'awesome-data-slim.json',
  '.github/workflows/update-data.yml', '.github/workflows/deploy.yml'
];

const repo = 'awsome-ai/awesome-index';

function uploadFile(filePath, retries = 3) {
  return new Promise((resolve) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    
    const postData = JSON.stringify({
      message: `Add ${filePath}`,
      content: encoded
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${repo}/contents/${filePath}`,
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'awesome-index/1.0',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          console.log(`✅ ${filePath}`);
        } else {
          console.log(`❌ ${filePath} (${res.statusCode}): ${data.substring(0,100)}`);
        }
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.write(postData);
    req.end();
  });
}

async function main() {
  for (const f of files) {
    try {
      await uploadFile(f);
      await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      console.log(`❌ ${f}: ${e.message}`);
    }
  }
  console.log('\nDone!');
}

main();
