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

function setAccessCookie(res: VercelRes, enabled: boolean) {
  const maxAge = enabled ? 7 * 24 * 60 * 60 : 0;
  const value = enabled ? '1' : '';
  const path = getAppBasePath() || '/';
  res.setHeader(
    'Set-Cookie',
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`
  );
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
  let next = '/';
  next = safeNext(url.searchParams.get('next'));
  res.statusCode = 302;
  setAccessCookie(res, false);
  res.setHeader('Location', `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
