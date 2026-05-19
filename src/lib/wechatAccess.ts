const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_SESSION_KEY = 'matchlife_wechat_ok';

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

