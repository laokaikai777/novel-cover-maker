// /api/edit
// 对话改图：用户自然语言修改要求 → 模板直出 edit prompt → 调 image2 改图
// Vercel Serverless Function

function humanizeError(raw, stage) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('no available channel')) return '画师暂时不在线，AI 服务通道还没开通（错误码：CH01）';
  if (s.includes('rate limit') || s.includes('429') || s.includes('too many')) return '当前排队的人有点多，等 1 分钟再试';
  if (s.includes('timeout') || s.includes('etimedout') || s.includes('timed out')) return '等太久没出来，换个简单点的修改要求再试试';
  if (s.includes('unauthorized') || s.includes('401') || s.includes('invalid api key')) return '服务端密钥失效，需要管理员检查';
  if (s.includes('insufficient') || s.includes('quota') || s.includes('balance')) return '今天的额度用完了';
  if (s.includes('content policy') || s.includes('safety') || s.includes('moderation')) return '修改要求触发了安全策略，换个说法试试';
  if (s.includes('http 5')) return 'AI 服务那边出了点问题，过会儿再试';
  if (s.includes('http 4')) return '请求被拒绝，检查修改要求是不是太短或有特殊字符';
  if (stage === 'prompt') return '理解你的修改要求时出了点问题，再说一遍试试';
  if (stage === 'image')  return '这一版没改成功，再试一次';
  return raw;
}

function getConfig() {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('服务器未配置 API：缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN');
  }
  return { baseUrl, token };
}

// ─────────────────────────────────────
// 模板直出 edit prompt（不再经过 Claude）
// ─────────────────────────────────────
function buildEditPrompt(input) {
  const title = input.title ? ` for "${input.title}"` : '';
  const author = input.author ? ` by ${input.author}` : '';

  return `Edit this book cover image${title}${author}. Modification request: ${input.instruction}. Apply only the requested changes. Preserve all other visual elements, composition, text placement, and overall style. Keep masterpiece quality, professional book cover design.`.trim();
}

// 调 image2 改图（multipart 上传 base64 转 buffer）
async function callImage2Edit(prompt, imageBase64, size) {
  const { baseUrl, token } = getConfig();
  const url = `${baseUrl}/v1/images/edits`;

  const boundary = '----CoverEditBoundary' + Date.now().toString(16);
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  const parts = [];
  const addField = (name, value) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  };
  const addFile = (name, filename, mime, data) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'));
    parts.push(data);
    parts.push(Buffer.from('\r\n', 'utf8'));
  };

  addField('model', 'gpt-image-2');
  addField('prompt', prompt);
  addField('response_format', 'b64_json');
  addField('n', '1');
  if (size) addField('size', size);
  addField('quality', 'medium');
  addField('output_format', 'png');
  addFile('image', 'cover.png', 'image/png', imageBuffer);
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  const body = Buffer.concat(parts);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${token}`,
      'Content-Length': body.length,
    },
    body,
  });

  if (!res.ok) {
    const t = await res.text();
    let msg = `改图失败: HTTP ${res.status}`;
    try {
      const j = JSON.parse(t);
      msg = j.error?.message || j.message || msg;
    } catch { msg += ' ' + t.slice(0, 200); }
    throw new Error(msg);
  }

  const data = await res.json();
  const item = data.data?.[0];
  if (!item) throw new Error('改图失败: 返回为空');
  if (item.b64_json) return item.b64_json;
  if (item.url && item.url.startsWith('data:')) {
    const m = item.url.match(/^data:[^;]+;base64,(.+)$/);
    if (m) return m[1];
  }
  throw new Error('改图失败: 返回中无 base64');
}

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
    if (!input.instruction) return res.status(400).json({ ok: false, error: '请告诉我要改什么' });
    if (!input.imageBase64) return res.status(400).json({ ok: false, error: '没有原图' });

    const prompt = buildEditPrompt(input);
    const imageBase64 = await callImage2Edit(prompt, input.imageBase64, input.size);

    return res.status(200).json({ ok: true, image: imageBase64, prompt });
  } catch (e) {
    const raw = e.message || String(e);
    const stage = raw.includes('提示词') ? 'prompt' : 'image';
    return res.status(500).json({ ok: false, error: humanizeError(raw, stage), raw });
  }
};
