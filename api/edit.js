// /api/edit
// 对话改图：用户用自然语言描述要改什么 → Claude 翻译成 edit prompt → 调 image2 改图

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

// 解析 Claude 响应（先试纯 JSON，再试 SSE）
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

function getConfig() {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('服务器未配置 API：缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN');
  }
  return { baseUrl, token };
}

// 让 Claude 把用户的中文修改要求翻译成精准的英文 edit prompt
async function buildEditPromptWithClaude(input) {
  const { baseUrl, token } = getConfig();

  const systemPrompt = `你是一位资深的中文网文封面策划师，正在指导 gpt-image-2 模型对一张已生成的封面进行修改。
任务：把用户的中文修改要求，翻译成精准、可执行的英文图像编辑指令。

【输出格式严格遵守】
直接输出英文 edit prompt，不要任何解释、不要 markdown、不要前后缀。

【关键规则】
- 只描述【需要改动】的部分，明确告诉模型保留其他元素
- 如果修改涉及书名、作者名等中文文字，原文用引号照搬
- 保持封面整体气质（题材氛围、构图比例）不被破坏
- 措辞要具体：不要"更好看"，要"更暖的金色调、加强月光辉光、放大主角"
- 包含质量后缀：keep masterpiece quality, professional book cover style`;

  const userPrompt = `这是一张网文小说封面，书名 "${input.title}"，作者 "${input.author}"。
原小说简介：${input.intro || '（用户未提供）'}

用户的修改要求（中文）：
"""
${input.instruction}
"""

请输出英文 edit prompt：`;

  const url = `${baseUrl}/v1/chat/completions`;
  const body = {
    model: 'claude-3-7-sonnet-20250219',
    max_tokens: 800,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
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
    throw new Error(`改图提示词生成失败: HTTP ${res.status} ${t.slice(0, 200)}`);
  }

  const text = await res.text();
  const prompt = parseClaudeResponse(text);
  if (!prompt) throw new Error(`改图提示词生成失败: 返回为空 (原始 ${text.length} 字符)`);
  return prompt;
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

    const prompt = await buildEditPromptWithClaude(input);
    const imageBase64 = await callImage2Edit(prompt, input.imageBase64, input.size);

    return res.status(200).json({ ok: true, image: imageBase64, prompt });
  } catch (e) {
    const raw = e.message || String(e);
    const stage = raw.includes('提示词') ? 'prompt' : 'image';
    return res.status(500).json({ ok: false, error: humanizeError(raw, stage), raw });
  }
};
