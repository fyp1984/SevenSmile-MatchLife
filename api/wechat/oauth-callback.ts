import crypto from 'node:crypto';

function safeNext(next: string | null) {
  const v = (next || '/').trim();
  if (!v.startsWith('/')) return '/';
  return v;
}

function firstHeader(v: unknown) {
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

type VercelReq = {
  url?: string;
  method?: string;
  headers?: Record<string, unknown>;
};

type VercelRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_SESSION_COOKIE = 'matchlife_wechat_session';
const ACCESS_VERSION =
  `${process.env.WECHAT_ACCESS_VERSION || process.env.VITE_WECHAT_ACCESS_VERSION || ''}`.trim() ||
  new Date().toISOString().slice(0, 10);
const STRICT_FOLLOW_CHECK = process.env.WECHAT_STRICT_FOLLOW_CHECK === 'true';
const SIGNING_SECRET =
  process.env.WECHAT_ACCESS_LINK_SECRET ||
  process.env.WECHAT_MP_SECRET ||
  process.env.WECHAT_ACCESS_CODES ||
  'matchlife-dev-secret';

type WechatOauthResp = {
  errcode?: number;
  errmsg?: string;
  openid?: string;
};

type WechatTokenResp = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

function getOauthStateStore() {
  const key = '__MATCHLIFE_WECHAT_OAUTH_STATES__';
  const stateHolder = globalThis as unknown as Record<
    string,
    Map<string, { next: string; expireAt: number; used: boolean }>
  >;
  const store = stateHolder[key];
  if (store) return store;
  const created = new Map<string, { next: string; expireAt: number; used: boolean }>();
  (globalThis as unknown as Record<string, unknown>)[key] = created;
  return created;
}

function getOrigin(req: VercelReq) {
  const proto = firstHeader(req.headers?.['x-forwarded-proto']) || 'https';
  const host =
    firstHeader(req.headers?.['x-forwarded-host']) ||
    firstHeader(req.headers?.host);
  return `${proto}://${host}`;
}

function getAppBasePath() {
  const v = (process.env.APP_BASE_PATH || '/').trim();
  if (!v || v === '/') return '';
  return `/${v.replace(/^\/+|\/+$/g, '')}`;
}

function toAppUrl(origin: string, path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${getAppBasePath()}${normalizedPath}`;
}

function signValue(value: string) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(value).digest('hex');
}

function base64url(input: string) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function issueAccessSessionCookie(openid: string) {
  if (!openid) return '';
  const payload = {
    o: openid,
    v: ACCESS_VERSION,
    i: Date.now(),
    e: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signValue(encoded)}`;
}

function setAccessCookie(res: VercelRes, enabled: boolean, openid = '') {
  const maxAge = enabled ? 7 * 24 * 60 * 60 : 0;
  const value = enabled ? '1' : '';
  const version = enabled ? ACCESS_VERSION : '';
  const session = enabled ? issueAccessSessionCookie(openid) : '';
  const path = getAppBasePath() || '/';
  res.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_VERSION_COOKIE}=${version}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_SESSION_COOKIE}=${session}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
  ] as unknown as string);
}

let cachedMpToken: { token: string; expireAt: number } | null = null;

async function getMpAccessToken(appid: string, secret: string) {
  const now = Date.now();
  if (cachedMpToken && cachedMpToken.expireAt - now > 60_000) return cachedMpToken.token;
  const r = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid,
      secret,
      force_refresh: false,
    }),
  });
  const j = (await r.json()) as WechatTokenResp;
  if (!j?.access_token || !j?.expires_in) throw new Error(j?.errmsg || 'token');
  cachedMpToken = { token: j.access_token, expireAt: now + Number(j.expires_in) * 1000 };
  return cachedMpToken.token;
}

async function queryFollowStatus(token: string, openid: string) {
  const u = new URL('https://api.weixin.qq.com/cgi-bin/user/info');
  u.searchParams.set('access_token', token);
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

async function checkFollowStatus(appid: string, secret: string, openid: string) {
  const token = await getMpAccessToken(appid, secret);
  try {
    return await queryFollowStatus(token, openid);
  } catch (error) {
    if ((error as Error & { errcode?: number }).errcode !== 40001) throw error;
    cachedMpToken = null;
    const refreshedToken = await getMpAccessToken(appid, secret);
    return queryFollowStatus(refreshedToken, openid);
  }
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.end();
    return;
  }

  const origin = getOrigin(req);
  const url = new URL(req.url || '', origin);
  const appid = `${process.env.WECHAT_MP_APPID || ''}`.trim();
  const secret = `${process.env.WECHAT_MP_SECRET || ''}`.trim();
  const code = String(url.searchParams.get('code') || '').trim();
  const state = String(url.searchParams.get('state') || '').trim();
  const store = getOauthStateStore();
  const oauthState = store.get(state);
  const next = safeNext(oauthState?.next || url.searchParams.get('next'));

  if (!appid || !secret || !code || !oauthState || oauthState.used || oauthState.expireAt <= Date.now()) {
    res.statusCode = 302;
    setAccessCookie(res, false);
    res.setHeader('Location', `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }

  oauthState.used = true;

  try {
    const oauthUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    oauthUrl.searchParams.set('appid', appid);
    oauthUrl.searchParams.set('secret', secret);
    oauthUrl.searchParams.set('code', code);
    oauthUrl.searchParams.set('grant_type', 'authorization_code');
    const oauthRes = await fetch(oauthUrl.toString());
    const oauthJson = (await oauthRes.json()) as WechatOauthResp;
    const openid = String(oauthJson?.openid || '').trim();
    if (!oauthRes.ok || !openid || oauthJson?.errcode) throw new Error(oauthJson?.errmsg || 'oauth');

    let subscribed = true;
    try {
      subscribed = await checkFollowStatus(appid, secret, openid);
    } catch (error) {
      if (STRICT_FOLLOW_CHECK) throw error;
    }

    res.statusCode = 302;
    if (subscribed) {
      setAccessCookie(res, true, openid);
      res.setHeader('Location', `${toAppUrl(origin, '/wechat/complete')}?ok=1&next=${encodeURIComponent(next)}`);
    } else {
      setAccessCookie(res, false);
      res.setHeader('Location', `${toAppUrl(origin, '/follow')}?next=${encodeURIComponent(next)}`);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  } catch {
    res.statusCode = 302;
    setAccessCookie(res, false);
    res.setHeader('Location', `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }
}
