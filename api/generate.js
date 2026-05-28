// /api/generate
// 首次生成封面：用户资料 → Claude 翻译成 image2 prompt → 调 image2 出图
// Vercel Serverless Function

const AUTO = '__auto__';

const GENRE_LABEL = {
  xianxia: '古风仙侠（修真问道、御剑飞升、上古传说）',
  oriental: '东方玄幻（异兽神魔、洪荒上古、东方神话）',
  western: '西方魔幻（魔法学院、巨龙骑士、地下城与精灵）',
  urban: '都市言情（现代都市、爱情故事、商战职场）',
  scifi: '科幻未来（星际、机甲、赛博朋克、AI）',
  mystery: '悬疑惊悚（推理破案、灵异恐怖、心理博弈）',
  history: '历史权谋（朝堂权斗、帝王将相、宫廷秘史）',
  apocalypse: '末世废土（丧尸、辐射荒原、生存博弈）',
  wuxia: '武侠江湖（刀剑如梦、快意恩仇、江湖儿女）',
  esports: '游戏电竞（电竞比赛、虚拟竞技、热血少年）',
  campus: '校园青春（学院日常、青春恋爱、热血少年）',
};

// 注：guofeng_da / guofeng_xi 特指中国风（"国风"=Chinese national style，绝不是 Western/Japanese 风格）
const STYLE_LABEL = {
  cinematic:   'cinematic photorealistic CG with dramatic lighting and film-grain depth',
  illust:      'modern Chinese web-novel CG illustration style, semi-realistic, clean lineart, painterly textures',
  guofeng_da:  'Chinese guofeng (Chinese national style) grand epic illustration, sweeping cinematic composition, majestic landscapes (mountains/seas/clouds/palaces), rich crimson-gold-cyan palette, traditional Chinese motifs (dragons, phoenix, mythological beasts), heroic atmosphere — DO NOT use Japanese anime or Western fantasy aesthetics',
  guofeng_xi:  'Chinese guofeng (Chinese national style) refined delicate illustration in gongbi 工笔 fine-line tradition, intricate ornamental details, elegant Chinese figures in hanfu, delicate flora (peonies/lotus/plum), soft mist, restrained palette of pale jade/ivory/blush, poetic and lyrical — DO NOT use Japanese anime or Western fantasy aesthetics',
  anime:       'Japanese anime illustration style, vibrant colors, cel-shading, expressive faces',
  ink:         'Chinese ink-wash painting (shui-mo 水墨) merged with subtle modern illustration, ample negative space, monochromatic black ink with occasional accent color',
  dark:        'dark gothic art with low-key lighting, deep shadows, ominous atmosphere, muted desaturated palette',
  watercolor:  'soft watercolor illustration, gentle pastel tones, flowing brush strokes, dreamy and warm',
};

const FONT_LABEL = {
  maobi:       'Chinese brush calligraphy (毛笔书法), bold expressive ink strokes, traditional and powerful',
  kaishu:      'Chinese Kaishu regular script (楷书), classical balanced strokes, elegant and dignified',
  songti:      'refined Chinese Song serif typeface (宋体), graceful and literary, sharp triangular serifs',
  heiti:       'modern Chinese Heiti sans-serif typeface (黑体), bold geometric, strong and contemporary',
  zhuanshu:    'ancient Chinese Zhuanshu seal script (篆书), archaic mystical curves, used for primordial/mythic themes',
  shouxie:     'casual Chinese handwritten style (手写体), warm and personal, slightly imperfect',
  wuxia_jin:   'rugged forceful Chinese calligraphy with sword-like sharp strokes, evoking wuxia martial spirit',
  magic_deco:  'ornate fantasy decorative typography with magical flourishes, suitable for Western fantasy themes',
};

// ─────────────────────────────────────
// 把后端原始错误翻译成对用户友好的中文
// ─────────────────────────────────────
function humanizeError(raw, stage) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('no available channel')) {
    return '画师暂时不在线，AI 服务通道还没开通（错误码：CH01）';
  }
  if (s.includes('rate limit') || s.includes('429') || s.includes('too many')) {
    return '当前排队的人有点多，等 1 分钟再试一次试试';
  }
  if (s.includes('timeout') || s.includes('etimedout') || s.includes('timed out')) {
    return '等太久没出来——可能是当前画面太复杂，简化一下简介或换个画风再来';
  }
  if (s.includes('unauthorized') || s.includes('401') || s.includes('invalid api key') || s.includes('invalid token')) {
    return '服务端密钥失效，需要管理员检查一下';
  }
  if (s.includes('insufficient') || s.includes('quota') || s.includes('balance')) {
    return '今天的额度用完了，明天再来吧';
  }
  if (s.includes('content policy') || s.includes('safety') || s.includes('moderation')) {
    return '内容触发了安全策略，试着换个表述或调整简介里的敏感内容';
  }
  if (s.includes('http 5')) {
    return 'AI 服务那边出了点问题，过会儿再试';
  }
  if (s.includes('http 4')) {
    return '请求被拒绝了，检查一下填的内容是不是太短或有特殊字符';
  }
  if (stage === 'prompt') return '出图前的准备没做完，可能是网不太稳，再来一次';
  if (stage === 'image')  return 'AI 这次没画出来，再试一次试试';
  return raw;
}

// ─────────────────────────────────────
// 读环境变量
// ─────────────────────────────────────
function getConfig() {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('服务器未配置 API：缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN');
  }
  return { baseUrl, token };
}

// AI 自决 / 预设 / 自定义 三种来源的解析
function resolveDimension(value, labelMap, kind) {
  if (!value || value === AUTO) {
    return { mode: 'auto', text: `AI 自决（请你根据小说内容判断最合适的${kind}并应用）` };
  }
  if (labelMap[value]) {
    return { mode: 'preset', text: labelMap[value] };
  }
  return { mode: 'custom', text: `用户自定义${kind}：「${value}」（请你理解并妥当应用）` };
}

// ─────────────────────────────────────
// 解析 Claude 响应（先试纯 JSON，再试 SSE）
// ─────────────────────────────────────
function parseClaudeResponse(text) {
  // 先试直接 JSON 解析（大部分情况）
  try {
    const j = JSON.parse(text);
    const content = j.choices?.[0]?.message?.content;
    if (content) return content.trim();
  } catch {}
  // 再试 SSE 流式解析
  const chunks = text.split('\n\n');
  let content = '';
  for (const chunk of chunks) {
    const line = chunk.replace(/^data: /, '').trim();
    if (!line || line === '[DONE]') continue;
    try {
      const j = JSON.parse(line);
      content += j.choices?.[0]?.message?.content || j.choices?.[0]?.delta?.content || '';
    } catch {}
  }
  return content.trim();
}

// ─────────────────────────────────────
// 调 Claude，把用户资料翻译成 image2 prompt
// ─────────────────────────────────────
async function buildPromptWithClaude(input) {
  const { baseUrl, token } = getConfig();

  const genre = resolveDimension(input.genre, GENRE_LABEL, '题材');
  const style = resolveDimension(input.style, STYLE_LABEL, '画风');
  const font  = resolveDimension(input.font,  FONT_LABEL,  '字体风格');

  // 章节摘选拼接（最多 4 章，每章 1500 字，避免 prompt 过长）
  const chapterText = (input.chapters || [])
    .slice(0, 4)
    .map((c, i) => `【第${i + 1}章节选 · ${c.name || ''}】\n${(c.content || '').slice(0, 1500)}`)
    .join('\n\n');

  const userPrompt = `你是网文封面策划师。直接输出英文image2 prompt，不要解释、markdown、前后缀。

规则：
- 竖版${input.ratio}，留顶部25%给书名、底部10%给作者名
- 主角东亚相貌，衣着符合题材
- 画风用中国国风≠日漫西幻；国风大气=宏大山河龙凤宫阙朱金赤云；国风细腻=工笔花鸟汉服淡雅烟雨
- 题材落具体视觉元素（仙侠→道袍飞剑云海；末世→废墟防毒面具；玄幻→异兽神魔；都市→现代街景）
- 书名"${input.title}"作者"${input.author}"原文照搬，title text at top + author below in smaller variant
- 含：主体、场景、构图、画风、文字排版、masterpiece ultra detailed professional book cover

${input.genre === '__auto__' ? '题材自决：从简介判断小说类型。' : ''}${input.style === '__auto__' ? '画风自决：配合题材选最合适画风。' : ''}${input.font === '__auto__' ? '字体自决：配合题材选最合适字体。' : ''}
小说信息：
书名《${input.title}》作者 ${input.author}
题材：${genre.text}
画风：${style.text}
字体：${font.text}
简介：${input.intro}
${input.extra ? '特别要求：' + input.extra : ''}
${chapterText ? '章节节选（仅供理解氛围，勿复述）：\n' + chapterText : ''}

输出英文prompt：`;

  const url = `${baseUrl}/v1/chat/completions`;
  const body = {
    model: 'claude-3-7-sonnet-20250219',
    max_tokens: 1500,
    stream: false,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`提示词生成失败: HTTP ${res.status} ${t.slice(0, 200)}`);
  }

  const text = await res.text();
  const prompt = parseClaudeResponse(text);
  if (!prompt) throw new Error(`提示词生成失败: 返回为空`);
  return prompt;
}

// ─────────────────────────────────────
// 调 image2 生成图片
// ─────────────────────────────────────
async function callImage2(prompt, size, n) {
  const { baseUrl, token } = getConfig();
  const url = `${baseUrl}/v1/images/generations`;

  const count = Math.max(1, Math.min(4, parseInt(n, 10) || 1));

  const payload = {
    model: 'gpt-image-2',
    prompt,
    response_format: 'b64_json',
    n: count,
    size: size || '1024x1536',
    quality: 'medium',
    output_format: 'png',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text();
    let msg = `图像生成失败: HTTP ${res.status}`;
    try {
      const j = JSON.parse(t);
      msg = j.error?.message || j.message || msg;
    } catch { msg += ' ' + t.slice(0, 200); }
    throw new Error(msg);
  }

  const data = await res.json();
  const items = data.data || [];
  if (!items.length) throw new Error('图像生成失败: 返回为空');

  const images = items.map(item => {
    if (item.b64_json) return item.b64_json;
    if (item.url && item.url.startsWith('data:')) {
      const m = item.url.match(/^data:[^;]+;base64,(.+)$/);
      if (m) return m[1];
    }
    return null;
  }).filter(Boolean);

  if (!images.length) throw new Error('图像生成失败: 返回中无 base64');
  return images;
}

// ─────────────────────────────────────
// 主入口
// ─────────────────────────────────────
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: '只支持 POST' });
  }

  try {
    const input = req.body || {};
    if (!input.title || !input.author || !input.intro) {
      return res.status(400).json({ ok: false, error: '书名、作者、简介都必填' });
    }

    const prompt = await buildPromptWithClaude(input);
    const images = await callImage2(prompt, input.size, input.n);

    return res.status(200).json({
      ok: true,
      images,
      image: images[0],
      prompt,
    });
  } catch (e) {
    const raw = e.message || String(e);
    const stage = raw.includes('提示词') ? 'prompt' : 'image';
    return res.status(500).json({ ok: false, error: humanizeError(raw, stage), raw });
  }
};
