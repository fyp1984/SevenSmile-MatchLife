import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 18765);
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://tools.cheersai.cloud';
const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '/7smile-matchlife');
const LEGACY_API_BASE_PATH = '/api/wechat';
const API_BASE_PATH = `${APP_BASE_PATH || ''}/api/wechat`;
const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_COOKIE_TTL = Number(process.env.WECHAT_SESSION_TTL_SECONDS || 12 * 60 * 60);
const ACCESS_VERSION = String(process.env.WECHAT_ACCESS_VERSION || '').trim() || new Date().toISOString().slice(0, 10);
const ACCESS_LINK_KEYWORD = String(process.env.WECHAT_ACCESS_KEYWORD || '比赛生涯').trim();
const ACCESS_LINK_SIGNING_SECRET =
  process.env.WECHAT_ACCESS_LINK_SECRET ||
  process.env.WECHAT_MP_SECRET ||
  process.env.WECHAT_ACCESS_CODES ||
  'matchlife-dev-secret';
const ACCESS_LINK_TTL_SECONDS = Number(process.env.WECHAT_ACCESS_LINK_TTL_SECONDS || 10 * 60);
const FOLLOW_CACHE_TTL_MS = Number(process.env.WECHAT_FOLLOW_CACHE_TTL_MS || 5 * 60 * 1000);
const FOLLOWER_LIST_CACHE_FILE = process.env.WECHAT_FOLLOWER_CACHE_FILE || '';
const STRICT_FOLLOW_CHECK = process.env.WECHAT_STRICT_FOLLOW_CHECK === 'true';
const MP_TOKEN = String(process.env.WECHAT_MP_TOKEN || '').trim();
const APPID = String(process.env.WECHAT_MP_APPID || '').trim();
const SECRET = String(process.env.WECHAT_MP_SECRET || '').trim();
const SYNC_RUNTIME_DIR = String(process.env.MATCHLIFE_SYNC_RUNTIME_DIR || '/home/sevensmile/release/runtime/7smile-matchlife-sync').trim();
const SYNC_ONCE_SCRIPT = String(process.env.MATCHLIFE_SYNC_ONCE_SCRIPT || `${SYNC_RUNTIME_DIR}/run-sync-once.mjs`).trim();
const SYNC_COOLDOWN_MS = Number(process.env.MATCHLIFE_SYNC_COOLDOWN_MS || 10_000);
const SYNC_HEARTBEAT_FILE = String(process.env.MATCHLIFE_HEARTBEAT_FILE || `${SYNC_RUNTIME_DIR}/heartbeat.json`).trim();
const DEFAULT_SYNC_RACE_ID = Number(process.env.SYNC_RACE_ID || 38653);
const DEFAULT_SYNC_TOURNAMENT_NAME = String(
  process.env.SYNC_TOURNAMENT_NAME || '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛',
).trim();

let mpTokenCache = null;
const usedTickets = new Map();
const followCache = new Map();
let lastSyncTriggeredAt = 0;
let activeSyncProcess = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function firstHeader(v) {
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function safeDecodeURIComponent(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseRaceIdFromUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    const fromSearch = u.searchParams.get('game_id') || u.searchParams.get('raceId') || u.searchParams.get('race_id');
    const hash = (u.hash || '').replace(/^#/, '');
    let fromHash = '';
    if (hash.includes('?')) {
      const query = hash.slice(hash.indexOf('?') + 1);
      const hp = new URLSearchParams(query);
      fromHash = hp.get('game_id') || hp.get('raceId') || hp.get('race_id') || '';
    }
    const n = Number(fromSearch || fromHash || '');
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function getOrigin(req) {
  const proto = firstHeader(req.headers['x-forwarded-proto']) || 'https';
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  return `${proto}://${host}`;
}

function safeNext(next) {
  const v = String(next || '/').trim();
  return v.startsWith('/') ? v : '/';
}

function normalizeBasePath(input) {
  const v = String(input || '/').trim();
  if (!v || v === '/') return '';
  return `/${v.replace(/^\/+|\/+$/g, '')}`;
}

function toAppUrl(origin, appPath) {
  const path = appPath.startsWith('/') ? appPath : `/${appPath}`;
  return `${origin}${APP_BASE_PATH}${path}`;
}

function isApiPath(pathname, suffix) {
  return pathname === `${API_BASE_PATH}${suffix}` || pathname === `${LEGACY_API_BASE_PATH}${suffix}`;
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function logLine(message) {
  process.stdout.write(`[manual-sync] ${new Date().toISOString()} ${message}\n`);
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function setAccessCookie(res, enabled) {
  const maxAge = enabled ? ACCESS_COOKIE_TTL : 0;
  const value = enabled ? '1' : '';
  const version = enabled ? ACCESS_VERSION : '';
  res.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${APP_BASE_PATH || '/'}; SameSite=Lax; Secure`,
    `${ACCESS_VERSION_COOKIE}=${version}; Max-Age=${maxAge}; Path=${APP_BASE_PATH || '/'}; SameSite=Lax; Secure`,
  ]);
}

function parseCookies(req) {
  const raw = firstHeader(req.headers.cookie);
  const result = {};
  raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      result[key] = decodeURIComponent(value);
    });
  return result;
}

function hasAccessSession(req) {
  const cookies = parseCookies(req);
  return cookies[ACCESS_COOKIE] === '1' && cookies[ACCESS_VERSION_COOKIE] === ACCESS_VERSION;
}

function isTrustedManualSyncRequest(req) {
  const marker = firstHeader(req.headers['x-matchlife-sync']);
  return marker === '1';
}

function getCodes() {
  const raw = `${process.env.WECHAT_ACCESS_CODES || process.env.WECHAT_ACCESS_CODE || ''}`;
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function base64url(input) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(input) {
  const pad = input.length % 4 ? '='.repeat(4 - (input.length % 4)) : '';
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function signValue(value) {
  return crypto.createHmac('sha256', ACCESS_LINK_SIGNING_SECRET).update(value).digest('hex');
}

function cleanupMaps() {
  const now = Date.now();
  for (const [nonce, expireAt] of usedTickets.entries()) {
    if (expireAt <= now) usedTickets.delete(nonce);
  }
  for (const [openid, data] of followCache.entries()) {
    if ((data?.checkedAt || 0) + FOLLOW_CACHE_TTL_MS <= now) followCache.delete(openid);
  }
}

function readFollowerListCache() {
  if (!FOLLOWER_LIST_CACHE_FILE) return null;
  try {
    const raw = fs.readFileSync(FOLLOWER_LIST_CACHE_FILE, 'utf8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json?.openids)) return null;
    return {
      refreshedAt: Number(json?.refreshedAt || 0),
      openids: new Set(json.openids),
    };
  } catch {
    return null;
  }
}

function issueMagicTicket({ openid, next = '/' }) {
  cleanupMaps();
  const payload = {
    o: openid,
    n: crypto.randomBytes(8).toString('hex'),
    v: ACCESS_VERSION,
    e: Date.now() + ACCESS_LINK_TTL_SECONDS * 1000,
    p: safeNext(next),
  };
  const encoded = base64url(JSON.stringify(payload));
  const sig = signValue(encoded);
  return `${encoded}.${sig}`;
}

function parseMagicTicket(ticket) {
  cleanupMaps();
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) {
    throw new Error('invalid ticket');
  }
  const [encoded, sig] = ticket.split('.', 2);
  if (signValue(encoded) !== sig) throw new Error('bad signature');
  const payload = JSON.parse(base64urlDecode(encoded));
  if (!payload?.o || !payload?.n || !payload?.e) throw new Error('bad payload');
  if (Number(payload.e) < Date.now()) throw new Error('expired');
  if (usedTickets.has(payload.n)) throw new Error('used');
  return payload;
}

async function getMpAccessToken() {
  if (!APPID || !SECRET) return null;
  const now = Date.now();
  if (mpTokenCache && mpTokenCache.expireAt - now > 60_000) return mpTokenCache.token;
  const u = new URL('https://api.weixin.qq.com/cgi-bin/token');
  u.searchParams.set('grant_type', 'client_credential');
  u.searchParams.set('appid', APPID);
  u.searchParams.set('secret', SECRET);
  const r = await fetch(u.toString());
  const j = await r.json();
  if (!j?.access_token || !j?.expires_in) throw new Error(`mp token failed: ${JSON.stringify(j)}`);
  mpTokenCache = { token: j.access_token, expireAt: now + Number(j.expires_in) * 1000 };
  return mpTokenCache.token;
}

async function checkFollowStatus(openid) {
  cleanupMaps();
  const cached = followCache.get(openid);
  if (cached && cached.checkedAt + FOLLOW_CACHE_TTL_MS > Date.now()) return cached.subscribed;
  const followerListCache = readFollowerListCache();
  if (
    followerListCache &&
    followerListCache.refreshedAt + FOLLOW_CACHE_TTL_MS > Date.now()
  ) {
    const subscribed = followerListCache.openids.has(openid);
    followCache.set(openid, { subscribed, checkedAt: Date.now() });
    return subscribed;
  }
  const token = await getMpAccessToken();
  if (!token) throw new Error('missing mp app credentials');
  const userUrl = new URL('https://api.weixin.qq.com/cgi-bin/user/info');
  userUrl.searchParams.set('access_token', token);
  userUrl.searchParams.set('openid', openid);
  userUrl.searchParams.set('lang', 'zh_CN');
  const userRes = await fetch(userUrl.toString());
  const userJson = await userRes.json();
  const subscribed = Number(userJson?.subscribe || 0) === 1;
  followCache.set(openid, { subscribed, checkedAt: Date.now() });
  return subscribed;
}

function verifyWechatSignature(signature, timestamp, nonce) {
  if (!MP_TOKEN || !signature || !timestamp || !nonce) return false;
  const arr = [MP_TOKEN, timestamp, nonce].sort();
  const check = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return check === signature;
}

function extractXmlValue(xml, tag) {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`));
  if (cdata?.[1] != null) return cdata[1];
  const plain = xml.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
  return plain?.[1] || '';
}

function xmlTextReply(toUser, fromUser, content) {
  return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
}

async function handleOauthStart(req, res, url) {
  const origin = getOrigin(req);
  const next = safeNext(url.searchParams.get('next'));
  redirect(res, `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
}

async function handleOauthCallback(req, res, url) {
  const origin = getOrigin(req) || APP_ORIGIN;
  const next = safeNext(url.searchParams.get('next'));
  setAccessCookie(res, false);
  redirect(res, `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
}

async function handleAccessCodeVerify(req, res) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    body = {};
  }

  const code = String(body?.code || '').trim().toUpperCase();
  const next = safeNext(body?.next || '/');
  const codes = getCodes();

  if (!codes.length) {
    sendJson(res, 500, { ok: false, error: '服务端未配置访问码' });
    return;
  }

  if (!code || !codes.includes(code)) {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '访问码错误或已过期' });
    return;
  }

  setAccessCookie(res, true);
  sendJson(res, 200, { ok: true, next, version: ACCESS_VERSION });
}

async function handleMagicLinkConsume(req, res, url) {
  try {
    const ticket = String(url.searchParams.get('ticket') || '');
    const payload = parseMagicTicket(ticket);
    let subscribed = true;
    try {
      subscribed = await checkFollowStatus(payload.o);
    } catch (error) {
      if (STRICT_FOLLOW_CHECK) throw error;
      log('follow check degraded', error instanceof Error ? error.message : String(error));
    }
    if (!subscribed) {
      setAccessCookie(res, false);
      sendJson(res, 403, { ok: false, error: '请先关注公众号后再进入' });
      return;
    }
    usedTickets.set(payload.n, Number(payload.e));
    setAccessCookie(res, true);
    sendJson(res, 200, { ok: true, next: safeNext(payload.p || '/'), version: ACCESS_VERSION });
  } catch (error) {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '链接无效、已过期或已使用' });
  }
}

async function handleMpCallbackGet(res, url) {
  const signature = url.searchParams.get('signature') || '';
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';
  const echostr = url.searchParams.get('echostr') || '';
  if (!verifyWechatSignature(signature, timestamp, nonce)) {
    sendJson(res, 401, { ok: false, error: 'bad signature' });
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(echostr);
}

async function handleMpCallbackPost(req, res) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const xml = Buffer.concat(chunks).toString('utf8');
  const toUser = extractXmlValue(xml, 'ToUserName');
  const fromUser = extractXmlValue(xml, 'FromUserName');
  const msgType = extractXmlValue(xml, 'MsgType');
  const content = extractXmlValue(xml, 'Content').trim();
  const event = extractXmlValue(xml, 'Event').trim().toUpperCase();
  const eventKey = extractXmlValue(xml, 'EventKey').trim();

  let replyText = `欢迎关注，回复“${ACCESS_LINK_KEYWORD}”即可获取直达链接。`;
  if (msgType === 'text' && content === ACCESS_LINK_KEYWORD) {
    const ticket = issueMagicTicket({ openid: fromUser, next: '/' });
    const link = `${APP_ORIGIN}${APP_BASE_PATH}/wechat/complete?ticket=${encodeURIComponent(ticket)}`;
    replyText = `点击直达：${link}\n10分钟内有效，离开后失效。若链接过期，请再次回复“${ACCESS_LINK_KEYWORD}”。`;
  } else if (msgType === 'event' && event === 'SUBSCRIBE') {
    replyText = `欢迎关注“七笑果-文体有料”。回复“${ACCESS_LINK_KEYWORD}”即可获取比赛生涯系统直达链接。`;
  } else if (msgType === 'event' && event === 'CLICK' && eventKey === 'MATCH_LIFE_ENTRY') {
    const ticket = issueMagicTicket({ openid: fromUser, next: '/' });
    const link = `${APP_ORIGIN}${APP_BASE_PATH}/wechat/complete?ticket=${encodeURIComponent(ticket)}`;
    replyText = `点击进入：${link}\n10分钟内有效，若失效请重新点击菜单。`;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.end(xmlTextReply(fromUser, toUser, replyText));
}

async function handleManualSync(req, res, url) {
  if (!hasAccessSession(req) && !isTrustedManualSyncRequest(req)) {
    sendJson(res, 401, { ok: false, error: '未登录或会话过期，请重新验证访问码' });
    return;
  }

  if (activeSyncProcess && !activeSyncProcess.killed) {
    sendJson(res, 409, { ok: false, error: '已有同步任务在执行中，请稍后再试' });
    return;
  }

  if (Date.now() - lastSyncTriggeredAt < SYNC_COOLDOWN_MS) {
    sendJson(res, 429, { ok: false, error: '触发过于频繁，请稍后再试' });
    return;
  }

  const mode = String(url.searchParams.get('mode') || 'full').trim() === 'fast' ? 'fast' : 'full';
  const sourceUrl = firstHeader(req.headers['x-matchlife-source-url']);
  const sourceName = safeDecodeURIComponent(firstHeader(req.headers['x-matchlife-source-name']));
  const raceIdsRaw = firstHeader(req.headers['x-matchlife-race-ids']);
  const raceIdRaw = firstHeader(req.headers['x-matchlife-race-id']);
  const raceId = Number(raceIdRaw || '') || parseRaceIdFromUrl(sourceUrl) || DEFAULT_SYNC_RACE_ID;
  const raceIds = String(raceIdsRaw || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const tournamentName = (sourceName || DEFAULT_SYNC_TOURNAMENT_NAME).trim();

  try {
    const child = spawn('node', [SYNC_ONCE_SCRIPT, mode], {
      cwd: SYNC_RUNTIME_DIR,
      env: {
        ...process.env,
        MATCHLIFE_HEARTBEAT_FILE: SYNC_HEARTBEAT_FILE,
        SYNC_RACE_ID: String(raceId),
        ...(raceIds.length > 0 ? { SYNC_RACE_IDS: Array.from(new Set(raceIds)).join(',') } : {}),
        SYNC_TOURNAMENT_NAME: tournamentName,
        MATCHLIFE_ACTIVE_SOURCE_URL: sourceUrl,
      },
      stdio: 'ignore',
    });
    activeSyncProcess = child;
    lastSyncTriggeredAt = Date.now();
    logLine(`triggered mode=${mode} pid=${String(child.pid)} raceId=${raceId} tournament=${tournamentName}`);
    child.on('exit', () => {
      logLine(`finished pid=${String(child.pid)} mode=${mode}`);
      activeSyncProcess = null;
    });
    sendJson(res, 202, { ok: true, mode, pid: child.pid, raceId, tournamentName });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const server = http.createServer(async (req, res) => {
  const origin = APP_ORIGIN || 'https://tools.cheersai.cloud';
  const url = new URL(req.url || '/', origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && isApiPath(url.pathname, '/oauth-start')) {
      await handleOauthStart(req, res, url);
      return;
    }

    if (req.method === 'GET' && isApiPath(url.pathname, '/oauth-callback')) {
      await handleOauthCallback(req, res, url);
      return;
    }

    if (req.method === 'POST' && isApiPath(url.pathname, '/access-code/verify')) {
      await handleAccessCodeVerify(req, res);
      return;
    }

    if (req.method === 'GET' && isApiPath(url.pathname, '/magic-link/consume')) {
      await handleMagicLinkConsume(req, res, url);
      return;
    }

    if (req.method === 'GET' && isApiPath(url.pathname, '/mp/callback')) {
      await handleMpCallbackGet(res, url);
      return;
    }

    if (req.method === 'POST' && isApiPath(url.pathname, '/mp/callback')) {
      await handleMpCallbackPost(req, res);
      return;
    }

    if (req.method === 'POST' && isApiPath(url.pathname, '/manual-sync')) {
      await handleManualSync(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        hasAccessCodes: getCodes().length > 0,
        accessVersion: ACCESS_VERSION,
        hasMpCallbackToken: Boolean(MP_TOKEN),
        hasMpSecret: Boolean(APPID && SECRET),
      });
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (error) {
    log('server error', error instanceof Error ? error.message : String(error));
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`wechat oauth server listening on 127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
