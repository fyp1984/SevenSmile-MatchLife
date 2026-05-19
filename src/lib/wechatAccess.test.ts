// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWechatNextPath,
  buildWechatOauthStartUrl,
  buildWechatSessionStatusUrl,
  clearWechatAccess,
  expectedWechatAccessVersion,
  hasWechatAccess,
  isWechatIntermediateRoute,
  markWechatAccess,
  sanitizeNextPath,
} from './wechatAccess';

describe('wechatAccess helpers', () => {
  afterEach(() => {
    sessionStorage.clear();
    document.cookie = 'matchlife_wechat_ok=; Max-Age=0; Path=/';
    document.cookie = 'matchlife_wechat_ver=; Max-Age=0; Path=/';
    vi.unstubAllGlobals();
  });

  it('builds oauth start url with encoded next path', () => {
    expect(buildWechatOauthStartUrl('/7smile-matchlife/', '/stats?sport=badminton')).toBe(
      '/7smile-matchlife/api/wechat/oauth-start?next=%2Fstats%3Fsport%3Dbadminton'
    );
  });

  it('builds session status url under the app base path', () => {
    expect(buildWechatSessionStatusUrl('/7smile-matchlife/')).toBe(
      '/7smile-matchlife/api/wechat/session-status'
    );
  });

  it('accepts matching session version', () => {
    vi.stubGlobal('window', { location: { hostname: 'tools.cheersai.cloud' } });
    markWechatAccess('2026-05-19');
    expect(hasWechatAccess('2026-05-19', 'production')).toBe(true);
  });

  it('rejects stale cookie version', () => {
    vi.stubGlobal('window', { location: { hostname: 'tools.cheersai.cloud' } });
    document.cookie = 'matchlife_wechat_ok=1';
    document.cookie = 'matchlife_wechat_ver=2026-05-18';
    expect(hasWechatAccess('2026-05-19', 'production')).toBe(false);
  });

  it('bypasses in development-like localhost mode', () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    expect(hasWechatAccess('2026-05-19', 'development')).toBe(true);
  });

  it('falls back to today-style access version string', () => {
    expect(expectedWechatAccessVersion('2026-05-19')).toBe('2026-05-19');
  });

  it('clears cached session marker', () => {
    markWechatAccess('2026-05-19');
    clearWechatAccess();
    expect(sessionStorage.getItem('matchlife_wechat_ok')).toBeNull();
  });

  it('unwraps nested gate redirect paths back to the original target', () => {
    expect(
      sanitizeNextPath('/gate/wechat?next=%2Fgate%2Fwechat%3Fnext%3D%252Fdata-sources')
    ).toBe('/data-sources');
  });

  it('unwraps recursive intermediate routes back to a safe target', () => {
    expect(isWechatIntermediateRoute('/gate/wechat/')).toBe(true);
    expect(buildWechatNextPath('/gate/wechat/', '?next=%2Fgate%2Fwechat%3Fnext%3D%252Fstats')).toBe('/stats');
  });

  it('rejects external next targets', () => {
    expect(sanitizeNextPath('https://evil.example/phish', '/stats')).toBe('/stats');
  });
});
