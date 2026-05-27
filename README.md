# Awesome Index AI 后端服务

轻量 Node.js API 服务，为 Awesome Index 提供 AI 搜索助手能力。

## 配置

```bash
# 必填
export OPENROUTER_API_KEY=sk-or-...027d

# 可选，默认值如下
export AI_MODEL=openrouter/free
export PORT=3001
```

## 启动

```bash
node server.js
```

## API

### POST /api/chat

```json
{
  "messages": [
    { "role": "user", "content": "想学 Rust，有什么好的资源？" }
  ]
}
```

响应格式与 OpenRouter API 一致。

### GET /health

健康检查，返回 `{ "status": "ok" }`。
