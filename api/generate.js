// /api/generate
// 首次生成封面：用户资料 → 模板直出 image2 prompt → 调 image2 出图
// Claude 仅用于可选的章节浓缩（失败不阻塞主流程）
// Vercel Serverless Function

const { humanizeError, getConfig, sanitizeTitle, resolveImageSize } = require('./utils.js');

const AUTO = '__auto__';

const RATIO_DESCRIPTIONS = {
  '1:1': 'square 1:1 aspect ratio',
  '2:3': 'vertical portrait 2:3 aspect ratio',
  '3:2': 'landscape 3:2 aspect ratio',
  '3:4': 'vertical portrait 3:4 aspect ratio',
  '4:3': 'landscape 4:3 aspect ratio',
  '9:16': 'vertical portrait 9:16 aspect ratio',
  '16:9': 'wide landscape 16:9 aspect ratio',
  '9:21': 'ultra-tall vertical 9:21 aspect ratio',
  '21:9': 'ultra-wide cinematic 21:9 aspect ratio',
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

const GENRE_DEFAULT_STYLE = {
  xianxia: 'guofeng_da', oriental: 'guofeng_da', wuxia: 'guofeng_da',
  history: 'guofeng_xi',
  western: 'cinematic', scifi: 'cinematic',
  mystery: 'dark', apocalypse: 'dark',
  urban: 'illust', esports: 'anime', campus: 'anime',
};

const GENRE_DEFAULT_FONT = {
  xianxia: 'maobi', oriental: 'kaishu', wuxia: 'wuxia_jin',
  history: 'kaishu',
  western: 'magic_deco', scifi: 'heiti',
  mystery: 'songti', apocalypse: 'heiti',
  urban: 'heiti', esports: 'heiti', campus: 'shouxie',
};

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

function resolveGenre(genre, title, intro) {
  if (genre && genre !== AUTO) return genre;
  const text = `${title || ''} ${intro || ''}`;
  let best = 'xianxia';
  let bestScore = 0;
  for (const [g, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += kw.length >= 3 ? 3 : 1;
    }
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return bestScore > 0 ? best : 'xianxia';
}

function resolveStyle(style, genre) {
  if (!style || style === AUTO) {
    const key = GENRE_DEFAULT_STYLE[genre] || 'illust';
    return STYLE_LABEL[key];
  }
  // 预设键 → 展开为英文描述；自定义字符串 → 直接作为画风描述
  return STYLE_LABEL[style] || style;
}

function resolveFont(font, genre) {
  if (!font || font === AUTO) {
    const key = GENRE_DEFAULT_FONT[genre] || 'heiti';
    return FONT_LABEL[key];
  }
  return FONT_LABEL[font] || font;
}

function resolveVisuals(genre) {
  return GENRE_VISUALS[genre] || '';
}

function resolveRatioDesc(ratio) {
  return RATIO_DESCRIPTIONS[ratio] || RATIO_DESCRIPTIONS['3:4'];
}

function formatAuthorCredit(author) {
  const name = (author || '').trim();
  if (!name) return '';
  return /著$/u.test(name) ? name : `${name} 著`;
}

function buildPrompt({ title: rawTitle, author, intro, genre, style, font, ratio, extra, chapterSummary }) {
  const title = sanitizeTitle(rawTitle);
  const authorCredit = formatAuthorCredit(author);
  const resolvedGenre = resolveGenre(genre, rawTitle, intro);
  const styleText = resolveStyle(style, resolvedGenre);
  const fontText = resolveFont(font, resolvedGenre);
  const genreVisual = resolveVisuals(resolvedGenre);
  const mood = chapterSummary || '';
  const extraLine = extra ? `Additional requirements: ${extra}.` : '';
  const ratioDesc = resolveRatioDesc(ratio);

  return `Create a professional book cover illustration, ${ratioDesc}.

Novel genre: ${resolvedGenre}.
Visible cover text: book title "${title}" and author credit "${authorCredit}".
Synopsis: ${intro}

Style: ${styleText}.
${genreVisual ? `Key visual elements: ${genreVisual}.` : ''}
Typography: ${fontText}. Place the book title "${title}" prominently with large, eye-catching typography matching the font style. Include the author credit "${authorCredit}" clearly in smaller secondary text, positioned naturally according to the overall composition.

The main character should have East Asian features, wearing attire appropriate to the genre.
${mood ? `Mood and atmosphere: ${mood}` : ''}
${extraLine}

Composition: Professional book cover layout with a strong focal illustration and balanced typography. Masterpiece quality, ultra detailed, professional book cover design.`.trim();
}

// ─────────────────────────────────────
// 可选：调 Claude 做章节轻量浓缩（失败不阻塞）
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

async function summarizeChapters(input) {
  const snippets = (input.chapters || [])
    .slice(0, 3)
    .map((c, i) => `Ch${i + 1}: ${(c.content || '').slice(0, 100)}`)
    .join(' ');

  if (!snippets.trim()) return '';

  const { baseUrl, token } = getConfig();
  const userPrompt = `Describe this web novel's atmosphere in 40 English words for a book cover artist. Title: ${sanitizeTitle(input.title)}. Excerpts: ${snippets}`;

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 120,
        stream: false,
        messages: [{ role: 'user', content: userPrompt }],
      }),
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

  const count = Math.max(1, Math.min(4, parseInt(n, 10) || 1));
  const outputSize = resolveImageSize(size);

  if (process.env.NODE_ENV !== 'production') {
    console.info('[image2] request', { size: outputSize, n: count, promptChars: prompt.length });
  }

  const res = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      response_format: 'b64_json',
      n: count,
      size: outputSize,
      quality: 'medium',
      output_format: 'png',
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.warn('[image2] failed', {
      status: res.status,
      statusText: res.statusText,
      size: outputSize,
      n: count,
      bodyPreview: t.slice(0, 500),
    });
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

    const chapterSummary = (input.chapters && input.chapters.length > 0)
      ? await summarizeChapters(input)
      : '';

    const prompt = buildPrompt({
      title: input.title,
      author: input.author,
      intro: input.intro,
      extra: input.extra,
      genre: input.genre,
      style: input.style,
      font: input.font,
      ratio: input.ratio,
      chapterSummary,
    });
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
