import crypto from 'node:crypto';
import {
  ACCESS_VERSION,
  issueFollowSession,
  setAccessCookie,
  signValue,
} from './_access';

type VercelReq = {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
};

type VercelRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const APPID = `${process.env.WECHAT_MP_APPID || ''}`.trim();
const SECRET = `${process.env.WECHAT_MP_SECRET || ''}`.trim();
const STRICT_FOLLOW_CHECK = process.env.WECHAT_STRICT_FOLLOW_CHECK === 'true';

let mpTokenCache: { token: string; expireAt: number } | null = null;
const usedTickets = new Map<string, number>();
const followCache = new Map<string, { subscribed: boolean; checkedAt: number }>();

function firstHeader(v: unknown) {
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function getOrigin(req: VercelReq) {
  const proto = firstHeader(req.headers?.['x-forwarded-proto']) || 'https';
  const host = firstHeader(req.headers?.['x-forwarded-host']) || firstHeader(req.headers?.host);
  return `${proto}://${host}`;
}

function safeNext(next: string | null | undefined) {
  const v = String(next || '/').trim();
  return v.startsWith('/') ? v : '/';
}

function sendJson(res: VercelRes, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function base64urlDecode(input: string) {
  const pad = input.length % 4 ? '='.repeat(4 - (input.length % 4)) : '';
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function cleanupMaps() {
  const now = Date.now();
  for (const [nonce, expireAt] of usedTickets.entries()) {
    if (expireAt <= now) usedTickets.delete(nonce);
  }
  for (const [openid, data] of followCache.entries()) {
    if ((data?.checkedAt || 0) + 5 * 60 * 1000 <= now) followCache.delete(openid);
  }
}

function parseTicket(ticket: string) {
  cleanupMaps();
  if (!ticket.includes('.')) throw new Error('invalid');
  const [encoded, sig] = ticket.split('.', 2);
  if (signValue(encoded) !== sig) throw new Error('signature');
  const payload = JSON.parse(base64urlDecode(encoded));
  if (!payload?.o || !payload?.n || !payload?.e) throw new Error('payload');
  if (Number(payload.e) < Date.now()) throw new Error('expired');
  if (usedTickets.has(payload.n)) throw new Error('used');
  return payload as { o: string; n: string; e: number; p?: string; v?: string };
}

async function getMpAccessToken() {
  if (!APPID || !SECRET) return null;
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
  if (!j?.access_token || !j?.expires_in) throw new Error('token');
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

async function checkFollowStatus(openid: string, options?: { force?: boolean }) {
  cleanupMaps();
  const force = options?.force === true;
  const cached = followCache.get(openid);
  if (!force && cached && cached.checkedAt + 5 * 60 * 1000 > Date.now()) return cached.subscribed;
  const token = await getMpAccessToken();
  if (!token) throw new Error('missing mp secret');
  let subscribed: boolean;
  try {
    subscribed = await queryFollowStatus(openid, token);
  } catch (error) {
    if ((error as Error & { errcode?: number }).errcode !== 40001) throw error;
    mpTokenCache = null;
    const refreshedToken = await getMpAccessToken();
    if (!refreshedToken) throw error;
    subscribed = await queryFollowStatus(openid, refreshedToken);
  }
  followCache.set(openid, { subscribed, checkedAt: Date.now() });
  return subscribed;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }
  const origin = getOrigin(req);
  const url = new URL(req.url || '', origin);
  try {
    const payload = parseTicket(String(url.searchParams.get('ticket') || ''));
    let subscribed = true;
    try {
      subscribed = await checkFollowStatus(payload.o, { force: true });
    } catch {
      if (STRICT_FOLLOW_CHECK) throw new Error('follow check failed');
    }
    if (!subscribed) {
      setAccessCookie(res, false);
      sendJson(res, 403, { ok: false, error: '请先关注公众号后再进入', redirectToFollow: true });
      return;
    }
    usedTickets.set(payload.n, Number(payload.e));
    setAccessCookie(res, true, issueFollowSession(payload.o));
    sendJson(res, 200, { ok: true, next: safeNext(payload.p), version: ACCESS_VERSION });
  } catch {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '链接无效、已过期或已使用' });
  }
}
