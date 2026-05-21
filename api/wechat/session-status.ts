import {
  ACCESS_COOKIE,
  ACCESS_SESSION_COOKIE,
  ACCESS_VERSION,
  ACCESS_VERSION_COOKIE,
  issueFollowSession,
  parseAccessSessionCookie,
  setAccessCookie,
} from './_access';

type VercelReq = {
  method?: string;
  headers?: Record<string, unknown>;
};

type VercelRes = {
  statusCode: number;
  setHeader: (name: string, value: string | string[]) => void;
  end: (body?: string) => void;
};

const APPID = `${process.env.WECHAT_MP_APPID || ''}`.trim();
const SECRET = `${process.env.WECHAT_MP_SECRET || ''}`.trim();

let mpTokenCache: { token: string; expireAt: number } | null = null;

function firstHeader(v: unknown) {
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function sendJson(res: VercelRes, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
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

    const rawSession = cookies[ACCESS_SESSION_COOKIE] || '';
    const session = parseAccessSessionCookie(rawSession, true);
    if (session.v && session.v !== ACCESS_VERSION) throw new Error('session version mismatch');

    if (Number(session.e) < Date.now()) {
      setAccessCookie(res, false);
      sendJson(res, 401, { ok: false, error: '会话已过期，请重新验证' });
      return;
    }

    if (!session.o) throw new Error('missing openid');
    const subscribed = await checkFollowStatus(session.o);
    if (!subscribed) {
      setAccessCookie(res, false);
      sendJson(res, 403, { ok: false, error: '请先关注公众号后再进入', redirectToFollow: true });
      return;
    }

    const renewedSession = issueFollowSession(session.o);
    setAccessCookie(res, true, renewedSession);
    sendJson(res, 200, {
      ok: true,
      version: ACCESS_VERSION,
      accessType: 'follow',
      expiresAt: renewedSession.e,
    });
  } catch {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '会话校验失败，请重新验证' });
  }
}
