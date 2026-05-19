import crypto from 'node:crypto';

const OAUTH_STATE_TTL_SECONDS = Number(process.env.WECHAT_OAUTH_STATE_TTL_SECONDS || 5 * 60);

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

export default function handler(req: VercelReq, res: VercelRes) {
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
  const next = safeNext(url.searchParams.get('next'));
  const appid = `${process.env.WECHAT_MP_APPID || ''}`.trim();

  if (!appid) {
    res.statusCode = 302;
    res.setHeader('Location', `${origin}${getAppBasePath()}/gate/wechat?next=${encodeURIComponent(next)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }

  const state = crypto.randomBytes(24).toString('hex');
  const store = getOauthStateStore();
  store.set(state, { next, expireAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000, used: false });
  for (const [key, value] of store.entries()) {
    if (value.used || value.expireAt <= Date.now()) store.delete(key);
  }

  const callback = `${origin}${getAppBasePath()}/api/wechat/oauth-callback`;
  const authUrl = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  authUrl.searchParams.set('appid', appid);
  authUrl.searchParams.set('redirect_uri', callback);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'snsapi_base');
  authUrl.searchParams.set('state', state);

  res.statusCode = 302;
  res.setHeader('Location', `${authUrl.toString()}#wechat_redirect`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
