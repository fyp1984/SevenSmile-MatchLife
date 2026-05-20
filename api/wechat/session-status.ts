import crypto from 'node:crypto';

type VercelReq = {
  method?: string;
  headers?: Record<string, unknown>;
};

type VercelRes = {
  statusCode: number;
  setHeader: (name: string, value: string | string[]) => void;
  end: (body?: string) => void;
};

const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_SESSION_COOKIE = 'matchlife_wechat_session';
const ACCESS_COOKIE_TTL = Number(process.env.WECHAT_SESSION_TTL_SECONDS || 12 * 60 * 60);
const ACCESS_VERSION =
  `${process.env.WECHAT_ACCESS_VERSION || process.env.VITE_WECHAT_ACCESS_VERSION || ''}`.trim() ||
  new Date().toISOString().slice(0, 10);
const SESSION_FORCE_CHECK_GRACE_MS = Number(process.env.WECHAT_SESSION_FORCE_CHECK_GRACE_MS || 60 * 1000);
const APPID = `${process.env.WECHAT_MP_APPID || ''}`.trim();
const SECRET = `${process.env.WECHAT_MP_SECRET || ''}`.trim();
const SIGNING_SECRET =
  process.env.WECHAT_ACCESS_LINK_SECRET ||
  process.env.WECHAT_MP_SECRET ||
  process.env.WECHAT_ACCESS_CODES ||
  'matchlife-dev-secret';

let mpTokenCache: { token: string; expireAt: number } | null = null;

function firstHeader(v: unknown) {
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function getAppBasePath() {
  const v = (process.env.APP_BASE_PATH || '/').trim();
  if (!v || v === '/') return '';
  return `/${v.replace(/^\/+|\/+$/g, '')}`;
}

function sendJson(res: VercelRes, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function signValue(value: string) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(value).digest('hex');
}

function base64urlDecode(input: string) {
  const pad = input.length % 4 ? '='.repeat(4 - (input.length % 4)) : '';
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function parseCookies(req: VercelReq) {
  const raw = firstHeader(req.headers?.cookie);
  const result: Record<string, string> = {};
  raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
  return result;
}

function setAccessCookie(res: VercelRes, enabled: boolean, openid = '') {
  const maxAge = enabled ? ACCESS_COOKIE_TTL : 0;
  const value = enabled ? '1' : '';
  const version = enabled ? ACCESS_VERSION : '';
  const session = enabled && openid ? issueAccessSessionCookie(openid) : '';
  const path = getAppBasePath() || '/';
  res.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_VERSION_COOKIE}=${version}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_SESSION_COOKIE}=${session}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
  ]);
}

function issueAccessSessionCookie(openid: string) {
  const payload = {
    o: openid,
    v: ACCESS_VERSION,
    i: Date.now(),
    e: Date.now() + ACCESS_COOKIE_TTL * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${encoded}.${signValue(encoded)}`;
}

function parseAccessSessionCookie(value: string) {
  if (!value || !value.includes('.')) throw new Error('invalid session cookie');
  const [encoded, sig] = value.split('.', 2);
  if (signValue(encoded) !== sig) throw new Error('bad session signature');
  const payload = JSON.parse(base64urlDecode(encoded));
  if (!payload?.o || !payload?.e) throw new Error('bad session payload');
  if (Number(payload.e) < Date.now()) throw new Error('expired session');
  return payload as { o: string; v?: string; e: number };
}

async function getMpAccessToken() {
  if (!APPID || !SECRET) throw new Error('missing mp secret');
  const now = Date.now();
  if (mpTokenCache && mpTokenCache.expireAt - now > 60_000) return mpTokenCache.token;
  const r = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: APPID,
      secret: SECRET,
      force_refresh: false,
    }),
  });
  const j = await r.json();
  if (!j?.access_token || !j?.expires_in) throw new Error(j?.errmsg || 'token');
  mpTokenCache = { token: j.access_token as string, expireAt: now + Number(j.expires_in) * 1000 };
  return mpTokenCache.token;
}

async function queryFollowStatus(openid: string, accessToken: string) {
  const u = new URL('https://api.weixin.qq.com/cgi-bin/user/info');
  u.searchParams.set('access_token', accessToken);
  u.searchParams.set('openid', openid);
  u.searchParams.set('lang', 'zh_CN');
  const r = await fetch(u.toString());
  const j = await r.json();
  if (!r.ok || j?.errcode) {
    const error = new Error(j?.errmsg || 'follow-check');
    (error as Error & { errcode?: number }).errcode = Number(j?.errcode || 0);
    throw error;
  }
  return Number(j?.subscribe || 0) === 1;
}

async function checkFollowStatus(openid: string) {
  const token = await getMpAccessToken();
  try {
    return await queryFollowStatus(openid, token);
  } catch (error) {
    if ((error as Error & { errcode?: number }).errcode !== 40001) throw error;
    mpTokenCache = null;
    const refreshedToken = await getMpAccessToken();
    return queryFollowStatus(openid, refreshedToken);
  }
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const cookies = parseCookies(req);
    if (cookies[ACCESS_COOKIE] !== '1' || cookies[ACCESS_VERSION_COOKIE] !== ACCESS_VERSION) {
      setAccessCookie(res, false);
      sendJson(res, 401, { ok: false, error: '未登录或会话已过期' });
      return;
    }

    const session = parseAccessSessionCookie(cookies[ACCESS_SESSION_COOKIE] || '');
    if (session.v && session.v !== ACCESS_VERSION) throw new Error('session version mismatch');
    const issuedAt = Number((session as { i?: number }).i || 0);
    const subscribed = await checkFollowStatus(session.o);
    if (!subscribed) {
      setAccessCookie(res, false);
      sendJson(res, 403, { ok: false, error: '请先关注公众号后再进入', redirectToFollow: true });
      return;
    }

    setAccessCookie(res, true, session.o);
    sendJson(res, 200, { ok: true, version: ACCESS_VERSION });
  } catch {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '会话校验失败，请重新验证' });
  }
}
