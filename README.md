# Awesome Index

发现最好的 GitHub 精选资源列表。从 [sindresorhus/awesome](https://github.com/sindresorhus/awesome) 生态中收录 1000+ 仓库，一站式搜索、分类浏览。

🌐 **在线体验**：`https://你的用户名.github.io/awesome-index`

---

## 功能

- 🔍 **搜索** — 搜名称、描述、标签，实时过滤
- 📂 **分类** — AI/ML、前端、安全、Python、Go、Rust、DevOps…
- ⭐ **排序** — Stars / 最近更新 / 名称
- 🏷️ **元数据** — 语言、License、Topics、分类

## 本地运行

```bash
git clone https://github.com/你的用户名/awesome-index
cd awesome-index

# 任选一种
python3 -m http.server 8080
# 或
npx serve .
# 或
npx http-server .
```

然后打开 `http://localhost:8080`。

## 数据更新

两种方式：

### 自动（推荐）

项目已配置 GitHub Actions，每周日凌晨自动抓取最新数据、构建前端、部署 Pages。

### 手动

```bash
# 1. 抓取数据
export GITHUB_TOKEN=你的token  # 可选，不加也能跑但限速
node search-awesome.js          # 抓取 Top 1000

# 2. 分类 + 构建前端
node build.js

# 3. 本地预览
python3 -m http.server 8080
```

## GitHub Token（可选）

加上 token 后能抓更多数据（从 1000 扩展到全部），且不会被限速。

**在哪加：**

1. 去 [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token → Fine-grained token
2. 权限只需要 `public_repo`（公共仓库只读）或 `repo:public_repo`
3. 复制 token

**本地使用：**
```bash
export GITHUB_TOKEN=ghp_xxxxx
```

**GitHub Actions（自动）：**
- 不需要手动添加——`${{ secrets.GITHUB_TOKEN }}` 由 GitHub 自动注入
- 项目 workflow 文件已配置好

---

## 项目结构

```
awesome-index/
├── index.html                # 前端页面（数据内联）
├── awesome-repos.json        # 完整元数据
├── awesome-data-slim.json    # 前端用轻量数据
├── search-awesome.js         # API 抓取脚本
├── snapshots/                # 每周数据快照（用于趋势分析）
├── .github/workflows/
│   ├── update-data.yml       # 每周数据更新
│   └── deploy.yml            # GitHub Pages 部署
└── README.md
```

## 从零部署

1. Fork 或推送此仓库到 GitHub
2. 去仓库 Settings → Pages → Source: `GitHub Actions`
3. 等几分钟，Actions 跑完后自动上线
4. 之后每周自动更新
