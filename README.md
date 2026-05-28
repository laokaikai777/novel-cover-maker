# 书的光 · 网文封面生成器

一个移动端的网文小说封面生成网页。用户填资料，AI 自动出封面；不满意就用对话改图。

## 它是什么

- **目标**：把小说的气质，变成一张像样的封面
- **用法**：填书名/作者/简介 → 选风格比例 → 一键生成 → 不满意用对话改
- **技术栈**：单页 HTML + Tailwind（前端），Vercel Serverless Functions（后端）
- **AI 服务**：调 Claude（写提示词）+ gpt-image-2（出图）

## 文件结构

```
小说封面生成/
├─ index.html          ← 整个网页，包含所有 UI 和交互
├─ api/
│  ├─ generate.js      ← 首次生成接口
│  └─ edit.js          ← 对话改图接口
├─ vercel.json         ← Vercel 配置
├─ package.json
└─ README.md
```

## 本地预览（不需要装任何东西）

直接双击 `index.html` 用浏览器打开就能看页面。**但**：
- 双击打开**只能看页面**，点"生成封面"会失败（因为 `/api/*` 接口需要后端跑起来）
- 想完整测试，要么部署到 Vercel，要么本地装 Vercel CLI 跑（见下面）

## 部署到 Vercel（让朋友能用）

老板这一步是上线的关键，跟着做：

### 第 1 步：把代码推到 GitHub

1. 去 https://github.com/new 建一个仓库（设成 Private 私有），名字随便起，比如 `novel-cover-maker`
2. 仓库建好后，GitHub 会给你一段命令，**先别用它的**，按下面这段在项目目录里执行：

```bash
cd "F:/新开始/凯凯是个AI/软件/小说封面生成"
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/你的用户名/novel-cover-maker.git
git push -u origin main
```

### 第 2 步：导入 Vercel

1. 去 https://vercel.com 用 GitHub 登录
2. 点 **Add New → Project** → 选你刚推的仓库 → 点 **Import**
3. 配置页**别动 Build/Output 设置**，直接往下拉到 **Environment Variables**

### 第 3 步：配环境变量（关键！）

在 Environment Variables 里加两条：

| Name | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://gpt-cloud.cn` |
| `ANTHROPIC_AUTH_TOKEN` | 你的 API Key（即 `settings.json` 里的那个 `sk-...`） |

加完点 **Deploy**，等 1-2 分钟。

### 第 4 步：拿到链接

部署成功后 Vercel 会给你一个域名，类似 `https://novel-cover-maker.vercel.app`，直接发给朋友就能用。

## 注意事项

- **额度消耗**：朋友每生成一张图，都会扣你 API Key 的额度（image2 + Claude）。如果朋友太多，关注下你的 gpt-cloud.cn 账户余额。
- **需要 image2 通道**：你的 API 服务（gpt-cloud.cn）必须开通 `gpt-image-2` 模型权限，不然接口会报"No available channel"。
- **生成时长**：一张图 1-3 分钟，Vercel 函数 maxDuration 已设到 300 秒。
- **章节文件**：上传 `.txt` 格式，每章节限制 8000 字（前端切），后端只取前 4 章每章 1500 字。

## 开发说明（给后续维护参考）

- 前端 `index.html` 单文件就是全部，无构建过程
- 提示词转化逻辑全在 `api/generate.js` 的 `buildPromptWithClaude` 函数里，要改提示词模板改这里
- image2 调用的固定参数：`quality=medium`, `output_format=png`, `n=1`
- 改图走 `multipart/form-data` 上传原图 base64
