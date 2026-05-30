// /api/edit
// 对话改图：用户自然语言修改要求 → 模板直出 edit prompt → 调 image2 改图
// Vercel Serverless Function

const { humanizeError, getConfig, sanitizeTitle, resolveImageSize } = require('./utils.js');

function buildEditPrompt(input) {
  const title = sanitizeTitle(input.title);
  const titlePart = title ? ` for "${title}"` : '';
  const author = (input.author || '').trim();
  const authorPart = author ? ` by ${author}` : '';

  return `Edit this book cover image${titlePart}${authorPart}. Modification request: ${input.instruction}. Apply only the requested changes. Preserve all other visual elements, composition, text placement, and overall style. Keep masterpiece quality, professional book cover design.`.trim();
}

async function callImage2Edit(prompt, imageBase64, size) {
  const { baseUrl, token } = getConfig();

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
  if (size) addField('size', resolveImageSize(size));
  addField('quality', 'medium');
  addField('output_format', 'png');
  addFile('image', 'cover.png', 'image/png', imageBuffer);
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  const body = Buffer.concat(parts);

  const res = await fetch(`${baseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${token}`,
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
