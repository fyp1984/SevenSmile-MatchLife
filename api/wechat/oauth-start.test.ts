import { afterEach, describe, expect, it, vi } from 'vitest';

function createRes() {
  return {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    setHeader(name: string, value: unknown) {
      this.headers[name] = value;
    },
    end: vi.fn(),
  };
}

describe('oauth-start api', () => {
  afterEach(() => {
    delete process.env.WECHAT_MP_APPID;
    delete process.env.APP_BASE_PATH;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('redirects to gate when appid is missing', async () => {
    process.env.WECHAT_MP_APPID = '';
    const { default: handler } = await import('./oauth-start');
    const res = createRes();
    handler(
      {
        method: 'GET',
        url: '/api/wechat/oauth-start?next=%2Fstats',
        headers: { host: 'tools.cheersai.cloud', 'x-forwarded-proto': 'https' },
      },
      res
    );
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.Location)).toContain('/gate/wechat?next=%2Fstats');
  });

  it('redirects to wechat oauth when appid exists', async () => {
    process.env.WECHAT_MP_APPID = 'wx123';
    process.env.APP_BASE_PATH = '/7smile-matchlife';
    const { default: handler } = await import('./oauth-start');
    const res = createRes();
    handler(
      {
        method: 'GET',
        url: '/api/wechat/oauth-start?next=%2Fleaderboard',
        headers: { host: 'tools.cheersai.cloud', 'x-forwarded-proto': 'https' },
      },
      res
    );
    expect(res.statusCode).toBe(302);
    const location = String(res.headers.Location);
    expect(location.startsWith('https://open.weixin.qq.com/connect/oauth2/authorize?')).toBe(true);
    expect(location).toContain('appid=wx123');
    expect(location).toContain('scope=snsapi_base');
    expect(location).toContain('#wechat_redirect');
  });
});
