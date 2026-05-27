// Vercel serverless function: proxy for OpenRouter AI chat
// Deploy as /api/chat.js on Vercel

export default async function handler(req, res) {
  // CORS for GitHub Pages
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://awsome-ai.github.io/awesome-index',
        'X-Title': 'Awesome Index'
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'openrouter/free',
        messages: [
          { role: 'system', content: '你是 Awesome Index 的 AI 搜索助手。你手上有 657 个 GitHub 上最好的精选资源列表（awesome lists）。用户会问他们想找什么类型的资源，你需要根据这些 awesome lists 的元数据推荐最合适的仓库。回答要：1）给出具体的仓库名和链接 2）说明为什么适合 3）如果用户需求很具体，尽量缩小到 1-3 个最佳推荐。数据源：sindresorhus/awesome 生态中的所有子列表。' },
          ...messages
        ],
        stream: false,
        max_tokens: 1000
      })
    });
    const data = await r.json();
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
