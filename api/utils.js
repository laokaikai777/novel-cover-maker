// api/utils.js
// 两个 Serverless Function 共享的工具函数

function humanizeError(raw, stage) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('no available channel')) return '画师暂时不在线，AI 服务通道还没开通（错误码：CH01）';
  if (s.includes('rate limit') || s.includes('429') || s.includes('too many')) return '当前排队的人有点多，等 1 分钟再试';
  if (s.includes('timeout') || s.includes('etimedout') || s.includes('timed out')) return '等太久没出来——可能是当前画面太复杂，简化一下简介或换个画风再来';
  if (s.includes('unauthorized') || s.includes('401') || s.includes('invalid api key') || s.includes('invalid token')) return '服务端密钥失效，需要管理员检查';
  if (s.includes('insufficient') || s.includes('quota') || s.includes('balance')) return '今天的额度用完了，明天再来吧';
  if (s.includes('content policy') || s.includes('safety') || s.includes('moderation')) return '内容触发了安全策略，试着换个表述或调整简介里的敏感内容';
  if (s.includes('http 5')) return 'AI 服务那边出了点问题，过会儿再试';
  if (s.includes('http 4')) return '请求被拒绝了，检查一下填的内容是不是太短或有特殊字符';
  if (stage === 'prompt') return '提示词生成时出了点问题，再来一次试试';
  if (stage === 'image')  return 'AI 这次没画出来，再试一次试试';
  return raw;
}

function getConfig() {
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) throw new Error('服务器未配置 API：缺少 ANTHROPIC_BASE_URL 或 ANTHROPIC_AUTH_TOKEN');
  return { baseUrl, token };
}

function sanitizeTitle(str) {
  return (str || '').replace(/[《》〈〉「」『』""'']/g, '').trim();
}

const RATIO_SIZE_MAP = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
  '9:21': '1024x1792',
  '21:9': '1792x1024',
};

function resolveImageSize(size) {
  return RATIO_SIZE_MAP[size] || size || '1024x1536';
}

module.exports = { humanizeError, getConfig, sanitizeTitle, resolveImageSize };
