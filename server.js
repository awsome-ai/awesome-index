const http = require('http');

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.OPENROUTER_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'openrouter/free';

if (!API_KEY) {
  console.error('❌ 请设置环境变量 OPENROUTER_API_KEY');
  console.error('   export OPENROUTER_API_KEY=sk-or-...');
  process.exit(1);
}

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'https://awsome-ai.github.io',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
];

const server = http.createServer((req, res) => {
  // CORS
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok', model: AI_MODEL }));
    return;
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);
        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'messages required' }));
          return;
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://awsome-ai.github.io/awesome-index',
            'X-Title': 'Awesome Index'
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: [
              {
                role: 'system',
                content: '你是 Awesome Index 的 AI 搜索助手。你有 657 个 GitHub awesome 列表的数据。回答要简洁、推荐具体。给出仓库名（带链接）、Stars、一句话说明为什么适合。一次推荐 1-3 个。无关问题说"我是专门帮忙找技术资源的，这题我答不了😅"。回复用中文。'
              },
              ...messages
            ],
            max_tokens: 600
          })
        });

        const data = await response.json();
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`✅ Awesome Index AI server running on http://localhost:${PORT}`);
  console.log(`   Model: ${AI_MODEL}`);
  console.log(`   POST /api/chat`);
  console.log(`   GET  /health`);
});
