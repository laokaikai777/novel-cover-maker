// /api/generate
// 首次生成封面：用户资料 → 模板直出 image2 prompt → 调 image2 出图
// Claude 仅用于可选的章节浓缩（失败不阻塞主流程）
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

// 题材 → 默认视觉元素
const GENRE_VISUALS = {
  xianxia: 'flowing Daoist robes, flying swords, mystical mountains shrouded in clouds, ancient temples, cranes, spiritual energy trails',
  oriental: 'colossal ancient beasts, primordial ruins, divine palaces, swirling elemental forces, heavenly tribulation lightning',
  western: 'wizard robes and staffs, medieval castles, dragons, ancient tomes, enchanted forests, magical circles',
  urban: 'modern city skyline, sleek office interiors, coffee shops, bustling streets at night, contemporary fashion',
  scifi: 'sleek starships, holographic interfaces, neon-lit cyberpunk streets, mecha, distant galaxies, advanced technology',
  mystery: 'shadowy figures, dimly lit alleys, crime scene elements, vintage detective aesthetics, psychological horror imagery',
  history: 'imperial throne rooms, ancient scrolls, palace intrigue settings, traditional armor, strategic map tables',
  apocalypse: 'ruined cityscapes, gas masks, radiation zones, fortified survivor camps, desolate wastelands, zombies',
  wuxia: 'flowing martial arts robes, swords and blades, bamboo forests, misty rivers, inns and teahouses, duel at sunset',
  esports: 'gaming arena stage, glowing keyboards, championship trophies, massive screens, cheering crowds',
  campus: 'school courtyards, cherry blossoms, classrooms, youthful uniforms, sports fields at golden hour',
};

// 题材 → 默认画风
const GENRE_DEFAULT_STYLE = {
  xianxia: 'guofeng_da', oriental: 'guofeng_da', wuxia: 'guofeng_da',
  history: 'guofeng_xi',
  western: 'cinematic', scifi: 'cinematic',
  mystery: 'dark', apocalypse: 'dark',
  urban: 'illust', esports: 'anime', campus: 'anime',
};

// 题材 → 默认字体
const GENRE_DEFAULT_FONT = {
  xianxia: 'maobi', oriental: 'kaishu', wuxia: 'wuxia_jin',
  history: 'kaishu',
  western: 'magic_deco', scifi: 'heiti',
  mystery: 'songti', apocalypse: 'heiti',
  urban: 'heiti', esports: 'heiti', campus: 'shouxie',
};

// ─────────────────────────────────────
// 错误翻译
// ─────────────────────────────────────
function humanizeError(raw, stage) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('no available channel')) return '画师暂时不在线，AI 服务通道还没开通（错误码：CH01）';
  if (s.includes('rate limit') || s.includes('429') || s.includes('too many')) return '当前排队的人有点多，等 1 分钟再试一次试试';
  if (s.includes('timeout') || s.includes('etimedout') || s.includes('timed out')) return '等太久没出来——可能是当前画面太复杂，简化一下简介或换个画风再来';
  if (s.includes('unauthorized') || s.includes('401') || s.includes('invalid api key') || s.includes('invalid token')) return '服务端密钥失效，需要管理员检查一下';
  if (s.includes('insufficient') || s.includes('quota') || s.includes('balance')) return '今天的额度用完了，明天再来吧';
  if (s.includes('content policy') || s.includes('safety') || s.includes('moderation')) return '内容触发了安全策略，试着换个表述或调整简介里的敏感内容';
  if (s.includes('http 5')) return 'AI 服务那边出了点问题，过会儿再试';
  if (s.includes('http 4')) return '请求被拒绝了，检查一下填的内容是不是太短或有特殊字符';
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
  if (!baseUrl || !token) throw new Error('服务器未配置 API：缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN');
  return { baseUrl, token };
}

// ─────────────────────────────────────
// 解析 Claude 响应（仅章节浓缩用）
// ─────────────────────────────────────
function parseClaudeResponse(text) {
  try {
    const j = JSON.parse(text);
    const content = j.choices?.[0]?.message?.content;
    if (content) return content.trim();
  } catch {}
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
// 关键词匹配：从简介/书名自动推断题材（纯 JS，不调 AI）
// ─────────────────────────────────────
const GENRE_KEYWORDS = {
  xianxia:    ['修仙', '修真', '仙侠', '飞剑', '道袍', '渡劫', '元婴', '金丹', '仙界', '灵根', '功法', '御剑', '仙门', '练气', '筑基', '长生'],
  oriental:   ['玄幻', '神魔', '洪荒', '上古', '异兽', '天帝', '神王', '万界', '吞噬', '血脉', '至尊', '诸天'],
  western:    ['魔法', '龙骑士', '精灵', '矮人', '地下城', '魔兽', '骑士', '巫师', '剑与魔法', '咒语', '巨龙', '魔杖'],
  urban:      ['都市', '总裁', '商战', '职场', '豪门', '现代都市', '言情', '霸总', '恋爱'],
  scifi:      ['科幻', '星际', '机甲', '赛博', '太空', '宇宙', '外星', '星舰', 'AI', '人工智能', '虚拟现实'],
  mystery:    ['悬疑', '推理', '破案', '恐怖', '灵异', '侦探', '凶手', '密室', '鬼', '惊悚'],
  history:    ['历史', '权谋', '朝堂', '帝王', '宫斗', '皇权', '官场', '王朝', '穿越古代'],
  apocalypse: ['末世', '丧尸', '废土', '辐射', '末日', '变异', '灾变'],
  wuxia:      ['武侠', '江湖', '刀剑', '少林', '武当', '门派', '侠客', '武林', '内功', '轻功'],
  esports:    ['电竞', '战队', '冠军', 'MOBA', 'FPS', '游戏竞技'],
  campus:     ['校园', '青春', '学院', '学霸', '校花', '同窗', '教室'],
};

function detectGenre(title, intro) {
  const text = `${title || ''} ${intro || ''}`;
  let bestGenre = 'xianxia'; // 默认
  let bestScore = 0;

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) {
        score += kw.length >= 3 ? 3 : 1; // 长关键词权重更高
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestGenre = genre;
    }
  }

  return bestScore > 0 ? bestGenre : 'xianxia';
}

// ─────────────────────────────────────
// 模板直出 image2 prompt（核心改动）
// ─────────────────────────────────────
function buildPrompt(input) {
  const ratioDesc = input.ratio === '2:3'
    ? 'vertical portrait 2:3 aspect ratio'
    : 'vertical portrait 3:4 aspect ratio';

  // 清理书名：去掉《》书名号和多余空格，避免 image2 把标点画上去
  const title = (input.title || '').replace(/[《》〈〉「」『』""'']/g, '').trim();
  const author = (input.author || '').trim();

  // 题材：AUTO 时从简介关键词推断
  const genre = (input.genre && input.genre !== AUTO) ? input.genre : detectGenre(input.title, input.intro);

  // 画风：用户选了就用，没选根据题材自动匹配
  let styleText;
  if (input.style && input.style !== AUTO && STYLE_LABEL[input.style]) {
    styleText = STYLE_LABEL[input.style];
  } else {
    const defaultKey = GENRE_DEFAULT_STYLE[genre] || 'illust';
    styleText = STYLE_LABEL[defaultKey];
  }

  // 字体：同上
  let fontText;
  if (input.font && input.font !== AUTO && FONT_LABEL[input.font]) {
    fontText = FONT_LABEL[input.font];
  } else {
    const defaultKey = GENRE_DEFAULT_FONT[genre] || 'heiti';
    fontText = FONT_LABEL[defaultKey];
  }

  // 题材视觉元素
  const genreVisual = (genre && genre !== AUTO && GENRE_VISUALS[genre])
    ? GENRE_VISUALS[genre]
    : '';

  // 章节浓缩结果（可选）
  const chapterSummary = input.chapterSummary || '';

  // 特别要求
  const extra = input.extra ? `Additional requirements: ${input.extra}.` : '';

  const prompt = `Create a professional book cover illustration, ${ratioDesc}.

Book title: "${title}" by ${author}.
Genre and synopsis: ${input.intro}

Style: ${styleText}.
${genreVisual ? `Key visual elements: ${genreVisual}.` : ''}
Typography: ${fontText}. Place the book title "${title}" prominently in the top 25% area with large, eye-catching typography matching the font style. Place the author name "${author}" at the bottom 10% in smaller text.

The main character should have East Asian features, wearing attire appropriate to the genre.
${chapterSummary ? `Mood and atmosphere: ${chapterSummary}` : ''}
${extra}

Composition: Vertical portrait book cover layout — title at top, main illustration scene in center, author name at bottom. Masterpiece quality, ultra detailed, professional book cover design.`;

  return prompt.trim();
}

// ─────────────────────────────────────
// 可选：调 Claude 做章节轻量浓缩
// 失败返回空字符串，不阻塞主流程
// ─────────────────────────────────────
async function summarizeChapters(input) {
  const chapterText = (input.chapters || [])
    .slice(0, 3)
    .map((c, i) => `Ch${i + 1}: ${(c.content || '').slice(0, 500)}`)
    .join(' ');

  if (!chapterText.trim()) return '';

  const { baseUrl, token } = getConfig();

  // 极短 prompt，控制在 relay 限制内（全英文，~150 字符）
  const userPrompt = `Describe this web novel's atmosphere in 40 English words for a book cover artist. Title: ${input.title}. Excerpts: ${chapterText.slice(0, 200)}`;

  try {
    const url = `${baseUrl}/v1/chat/completions`;
    const body = {
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 120,
      stream: false,
      messages: [{ role: 'user', content: userPrompt }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return '';

    const text = await res.text();
    const summary = parseClaudeResponse(text);
    return summary || '';
  } catch {
    return '';
  }
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

    // 可选：章节浓缩（失败不阻塞，返回空字符串）
    let chapterSummary = '';
    if (input.chapters && input.chapters.length > 0) {
      chapterSummary = await summarizeChapters(input);
    }

    const prompt = buildPrompt({ ...input, chapterSummary });
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
