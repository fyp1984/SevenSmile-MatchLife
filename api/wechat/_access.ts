import crypto from 'node:crypto';

export const ACCESS_COOKIE = 'matchlife_wechat_ok';
export const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
export const ACCESS_SESSION_COOKIE = 'matchlife_wechat_session';
export const FOLLOW_SESSION_TTL_SECONDS = Number(process.env.WECHAT_SESSION_TTL_SECONDS || 12 * 60 * 60);
export const ACCESS_VERSION =
  `${process.env.WECHAT_ACCESS_VERSION || process.env.VITE_WECHAT_ACCESS_VERSION || ''}`.trim() ||
  new Date().toISOString().slice(0, 10);
export const SIGNING_SECRET =
  process.env.WECHAT_ACCESS_LINK_SECRET ||
  process.env.WECHAT_MP_SECRET ||
  process.env.WECHAT_ACCESS_CODES ||
  process.env.WECHAT_ACCESS_CODE ||
  'matchlife-dev-secret';

export type AccessSessionPayload = {
  o?: string;
  t: 'follow';
  v: string;
  i: number;
  e: number;
};

export function getAppBasePath() {
  const value = (process.env.APP_BASE_PATH || '/').trim();
  if (!value || value === '/') return '';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

export function signValue(value: string) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(value).digest('hex');
}

function base64urlEncode(input: string) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input: string) {
  const pad = input.length % 4 ? '='.repeat(4 - (input.length % 4)) : '';
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function issueAccessSessionCookie(payload: AccessSessionPayload) {
  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${signValue(encoded)}`;
}

export function parseAccessSessionCookie(value: string, allowExpired = false) {
  if (!value || !value.includes('.')) throw new Error('invalid session cookie');
  const [encoded, sig] = value.split('.', 2);
  if (signValue(encoded) !== sig) throw new Error('bad session signature');
  const payload = JSON.parse(base64urlDecode(encoded)) as Partial<AccessSessionPayload>;
  if (!payload?.t || !payload?.v || !payload?.e) throw new Error('bad session payload');
  if (!allowExpired && Number(payload.e) < Date.now()) throw new Error('expired session');
  return payload as AccessSessionPayload;
}

export function issueFollowSession(openid: string) {
  return {
    t: 'follow' as const,
    o: openid,
    v: ACCESS_VERSION,
    i: Date.now(),
    e: Date.now() + FOLLOW_SESSION_TTL_SECONDS * 1000,
  };
}

function getCookieMaxAgeSeconds(session?: AccessSessionPayload) {
  if (!session) return 0;
  return Math.max(0, Math.ceil((Number(session.e) - Date.now()) / 1000));
}

export function setAccessCookie(
  res: { setHeader: (name: string, value: string | string[]) => void },
  enabled: boolean,
  session?: AccessSessionPayload,
) {
  const maxAge = enabled ? getCookieMaxAgeSeconds(session) : 0;
  const value = enabled ? '1' : '';
  const version = enabled ? session?.v || ACCESS_VERSION : '';
  const sessionCookie = enabled && session ? issueAccessSessionCookie(session) : '';
  const path = getAppBasePath() || '/';
  res.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_VERSION_COOKIE}=${version}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
    `${ACCESS_SESSION_COOKIE}=${sessionCookie}; Max-Age=${maxAge}; Path=${path}; SameSite=Lax; Secure`,
  ]);
}
