const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_SESSION_KEY = 'matchlife_wechat_ok';
const INTERMEDIATE_ROUTES = new Set(['/gate/wechat', '/follow', '/wechat/complete']);

function normalizePathname(pathname?: string | null) {
  const raw = (pathname || '').trim() || '/';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  if (collapsed.length === 1) return collapsed;
  return collapsed.replace(/\/+$/g, '') || '/';
}

export function readCookie(name: string) {
  if (typeof document === 'undefined') return '';
  const found = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}

export function isBypassWechatAccess(envVersion?: string) {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return envVersion === 'development' || host === 'localhost' || host === '127.0.0.1';
}

export function isWechatUA() {
  if (typeof navigator === 'undefined') return false;
  return navigator.userAgent.toLowerCase().includes('micromessenger');
}

export function expectedWechatAccessVersion(configuredVersion?: string) {
  return `${configuredVersion || new Date().toISOString().slice(0, 10)}`;
}

export function hasWechatAccess(configuredVersion?: string, mode?: string) {
  if (typeof window === 'undefined') return true;
  if (isBypassWechatAccess(mode)) return true;
  const expected = expectedWechatAccessVersion(configuredVersion);
  const session = sessionStorage.getItem(ACCESS_SESSION_KEY);
  const accessCookie = readCookie(ACCESS_COOKIE) === '1';
  const versionCookie = readCookie(ACCESS_VERSION_COOKIE);
  return session === expected || (accessCookie && (!versionCookie || versionCookie === expected));
}

export function buildWechatOauthStartUrl(baseUrl: string, next: string) {
  return `${baseUrl}api/wechat/oauth-start?next=${encodeURIComponent(next)}`;
}

export function buildWechatSessionStatusUrl(baseUrl: string) {
  return `${baseUrl}api/wechat/session-status`;
}

export function isWechatIntermediateRoute(pathname?: string | null) {
  return INTERMEDIATE_ROUTES.has(normalizePathname(pathname));
}

export function buildWechatNextPath(pathname: string, search = '', fallback = '/') {
  return sanitizeNextPath(`${normalizePathname(pathname)}${search || ''}`, fallback);
}

function decodeMaybe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function sanitizeNextPath(rawNext?: string | null, fallback = '/') {
  let candidate = (rawNext || '').trim() || fallback;

  for (let i = 0; i < 5; i += 1) {
    const decoded = decodeMaybe(candidate);
    if (decoded) candidate = decoded;

    let normalized = candidate;
    if (/^https?:\/\//i.test(normalized)) {
      return fallback;
    }

    if (!normalized.startsWith('/') || normalized.startsWith('//')) {
      return fallback;
    }

    try {
      const url = new URL(normalized, 'https://matchlife.local');
      const nextPath = `${normalizePathname(url.pathname)}${url.search}${url.hash}`;
      if (!isWechatIntermediateRoute(url.pathname)) {
        return nextPath;
      }
      const nestedNext = url.searchParams.get('next');
      if (!nestedNext) return fallback;
      candidate = nestedNext;
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function markWechatAccess(version: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(ACCESS_SESSION_KEY, version);
}

export function clearWechatAccess() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ACCESS_SESSION_KEY);
}
