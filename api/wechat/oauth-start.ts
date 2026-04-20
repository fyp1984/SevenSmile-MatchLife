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

  res.statusCode = 302;
  res.setHeader('Location', `${origin}${getAppBasePath()}/gate/wechat?next=${encodeURIComponent(next)}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
