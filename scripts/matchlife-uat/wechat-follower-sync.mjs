import fs from 'node:fs/promises';
import path from 'node:path';

const APPID = `${process.env.WECHAT_MP_APPID || ''}`.trim();
const SECRET = `${process.env.WECHAT_MP_SECRET || ''}`.trim();
const OUTPUT = process.env.WECHAT_FOLLOWER_CACHE_FILE || path.join(process.cwd(), 'wechat-followers.json');

if (!APPID || !SECRET) {
  throw new Error('Missing WECHAT_MP_APPID or WECHAT_MP_SECRET');
}

async function getAccessToken() {
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
  if (!j?.access_token) {
    throw new Error(`get token failed: ${JSON.stringify(j)}`);
  }
  return j.access_token;
}

async function fetchFollowerOpenids(accessToken) {
  const openids = [];
  let nextOpenid = '';
  while (true) {
    const u = new URL('https://api.weixin.qq.com/cgi-bin/user/get');
    u.searchParams.set('access_token', accessToken);
    if (nextOpenid) u.searchParams.set('next_openid', nextOpenid);
    const r = await fetch(u.toString());
    const j = await r.json();
    const list = Array.isArray(j?.data?.openid) ? j.data.openid : [];
    openids.push(...list);
    nextOpenid = `${j?.next_openid || ''}`.trim();
    const count = Number(j?.count || 0);
    const total = Number(j?.total || 0);
    if (!count || !nextOpenid || openids.length >= total) break;
  }
  return openids;
}

async function main() {
  const token = await getAccessToken();
  const openids = await fetchFollowerOpenids(token);
  const dir = path.dirname(OUTPUT);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    OUTPUT,
    JSON.stringify({ refreshedAt: Date.now(), total: openids.length, openids }, null, 2),
    'utf8'
  );
  console.log(JSON.stringify({ ok: true, output: OUTPUT, total: openids.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
