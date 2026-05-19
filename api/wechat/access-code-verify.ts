type VercelReq = {
  method?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  on?: (event: string, cb: (chunk?: Buffer) => void) => void;
};

type VercelRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_COOKIE_TTL = 7 * 24 * 60 * 60;
const ACCESS_VERSION =
  `${process.env.WECHAT_ACCESS_VERSION || process.env.VITE_WECHAT_ACCESS_VERSION || ''}`.trim() ||
  new Date().toISOString().slice(0, 10);
const STRICT_FOLLOW_CHECK = process.env.WECHAT_STRICT_FOLLOW_CHECK === 'true';

function getAppBasePath() {
  const v = (process.env.APP_BASE_PATH || '/').trim();
  if (!v || v === '/') return '';
  return `/${v.replace(/^\/+|\/+$/g, '')}`;
}

function safeNext(next: string | null | undefined) {
  const v = String(next || '/').trim();
  return v.startsWith('/') ? v : '/';
}

function setAccessCookie(res: VercelRes, enabled: boolean) {
  const maxAge = enabled ? ACCESS_COOKIE_TTL : 0;
  const value = enabled ? '1' : '';
  const version = enabled ? ACCESS_VERSION : '';
  const path = getAppBasePath() || '/';
  res.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_VERSION_COOKIE}=${version}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
  ] as unknown as string);
}

function sendJson(res: VercelRes, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function getCodes() {
  const raw = `${process.env.WECHAT_ACCESS_CODES || process.env.WECHAT_ACCESS_CODE || ''}`;
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

async function readBody(req: VercelReq): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (!req.on) return {};
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on?.('data', (chunk?: Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on?.('end', () => resolve());
  });
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  const body = await readBody(req);
  const code = String(body.code || '').trim().toUpperCase();
  const next = safeNext(String(body.next || '/'));
  const codes = getCodes();

  if (STRICT_FOLLOW_CHECK) {
    setAccessCookie(res, false);
    sendJson(res, 403, { ok: false, error: '当前环境必须先关注服务号，请使用微信内一键进入' });
    return;
  }

  if (!codes.length) {
    sendJson(res, 500, { ok: false, error: '服务端未配置访问码' });
    return;
  }

  if (!code || !codes.includes(code)) {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '访问码错误或已过期' });
    return;
  }

  setAccessCookie(res, true);
  sendJson(res, 200, { ok: true, next, version: ACCESS_VERSION });
}
