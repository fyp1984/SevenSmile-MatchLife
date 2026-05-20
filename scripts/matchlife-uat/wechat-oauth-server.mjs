import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 18765);
const HOST = process.env.WECHAT_OAUTH_HOST || '127.0.0.1';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://tools.cheersai.cloud';
const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '/7smile-matchlife');
const LEGACY_API_BASE_PATH = '/api/wechat';
const API_BASE_PATH = `${APP_BASE_PATH || ''}/api/wechat`;
const LOCAL_API_BASE_PATH = `${APP_BASE_PATH || ''}/api`;
const LEGACY_LOCAL_API_BASE_PATH = '/api';
const ACCESS_COOKIE = 'matchlife_wechat_ok';
const ACCESS_VERSION_COOKIE = 'matchlife_wechat_ver';
const ACCESS_SESSION_COOKIE = 'matchlife_wechat_session';
const ACCESS_COOKIE_TTL = Number(process.env.WECHAT_SESSION_TTL_SECONDS || 12 * 60 * 60);
const ACCESS_VERSION = String(process.env.WECHAT_ACCESS_VERSION || '').trim() || new Date().toISOString().slice(0, 10);
const SESSION_FORCE_CHECK_GRACE_MS = Number(process.env.WECHAT_SESSION_FORCE_CHECK_GRACE_MS || 60 * 1000);
const ACCESS_LINK_KEYWORD = String(process.env.WECHAT_ACCESS_KEYWORD || '比赛生涯').trim();
const ACCESS_LINK_SIGNING_SECRET =
  process.env.WECHAT_ACCESS_LINK_SECRET ||
  process.env.WECHAT_MP_SECRET ||
  process.env.WECHAT_ACCESS_CODES ||
  'matchlife-dev-secret';
const ACCESS_LINK_TTL_SECONDS = Number(process.env.WECHAT_ACCESS_LINK_TTL_SECONDS || 10 * 60);
const OAUTH_STATE_TTL_SECONDS = Number(process.env.WECHAT_OAUTH_STATE_TTL_SECONDS || 5 * 60);
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
const oauthStates = new Map();
let lastSyncTriggeredAt = 0;
let activeSyncProcess = null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function maskOpenid(openid) {
  const value = String(openid || '').trim();
  if (!value) return 'unknown';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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

function isLocalApiPath(pathname, suffix) {
  return pathname === `${LOCAL_API_BASE_PATH}${suffix}` || pathname === `${LEGACY_LOCAL_API_BASE_PATH}${suffix}`;
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function getServiceSupabase() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) return null;
  const mod = await import('./lib/ymq-sync.mjs');
  return mod.createSupabaseServiceClient({ url, serviceRoleKey });
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

function issueAccessSessionCookie(openid) {
  if (!openid) return '';
  const payload = {
    o: openid,
    v: ACCESS_VERSION,
    i: Date.now(),
    e: Date.now() + ACCESS_COOKIE_TTL * 1000,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signValue(encoded)}`;
}

function parseAccessSessionCookie(value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) {
    throw new Error('invalid session cookie');
  }
  const [encoded, sig] = value.split('.', 2);
  if (signValue(encoded) !== sig) throw new Error('bad session signature');
  const payload = JSON.parse(base64urlDecode(encoded));
  if (!payload?.o || !payload?.e) throw new Error('bad session payload');
  if (Number(payload.e) < Date.now()) throw new Error('expired session');
  return payload;
}

function setAccessCookie(res, enabled, openid = '') {
  const maxAge = enabled ? ACCESS_COOKIE_TTL : 0;
  const value = enabled ? '1' : '';
  const version = enabled ? ACCESS_VERSION : '';
  const session = enabled ? issueAccessSessionCookie(openid) : '';
  res.setHeader('Set-Cookie', [
    `${ACCESS_COOKIE}=${value}; Max-Age=${maxAge}; Path=${APP_BASE_PATH || '/'}; SameSite=Lax; Secure`,
    `${ACCESS_VERSION_COOKIE}=${version}; Max-Age=${maxAge}; Path=${APP_BASE_PATH || '/'}; SameSite=Lax; Secure`,
    `${ACCESS_SESSION_COOKIE}=${session}; Max-Age=${maxAge}; Path=${APP_BASE_PATH || '/'}; SameSite=Lax; Secure`,
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
  for (const [state, data] of oauthStates.entries()) {
    if ((data?.expireAt || 0) <= now || data?.used) oauthStates.delete(state);
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
  if (!j?.access_token || !j?.expires_in) throw new Error(`mp token failed: ${JSON.stringify(j)}`);
  mpTokenCache = { token: j.access_token, expireAt: now + Number(j.expires_in) * 1000 };
  return mpTokenCache.token;
}

async function queryFollowStatus(openid, accessToken) {
  const userUrl = new URL('https://api.weixin.qq.com/cgi-bin/user/info');
  userUrl.searchParams.set('access_token', accessToken);
  userUrl.searchParams.set('openid', openid);
  userUrl.searchParams.set('lang', 'zh_CN');
  const userRes = await fetch(userUrl.toString());
  const userJson = await userRes.json();
  if (!userRes.ok || userJson?.errcode) {
    const error = new Error(`follow-check failed: ${JSON.stringify(userJson)}`);
    error.errcode = Number(userJson?.errcode || 0);
    throw error;
  }
  return Number(userJson?.subscribe || 0) === 1;
}

async function checkFollowStatus(openid, options = {}) {
  cleanupMaps();
  const force = options && options.force === true;
  const cached = followCache.get(openid);
  if (!force && cached && cached.subscribed && cached.checkedAt + FOLLOW_CACHE_TTL_MS > Date.now()) {
    return true;
  }
  const followerListCache = readFollowerListCache();
  if (
    !force &&
    followerListCache &&
    followerListCache.refreshedAt + FOLLOW_CACHE_TTL_MS > Date.now()
  ) {
    if (followerListCache.openids.has(openid)) {
      followCache.set(openid, { subscribed: true, checkedAt: Date.now() });
      return true;
    }
  }
  const token = await getMpAccessToken();
  if (!token) throw new Error('missing mp app credentials');
  let subscribed;
  try {
    subscribed = await queryFollowStatus(openid, token);
  } catch (error) {
    if (error?.errcode !== 40001) throw error;
    mpTokenCache = null;
    const refreshedToken = await getMpAccessToken();
    if (!refreshedToken) throw error;
    subscribed = await queryFollowStatus(openid, refreshedToken);
  }
  if (subscribed) {
    followCache.set(openid, { subscribed: true, checkedAt: Date.now() });
  } else {
    followCache.delete(openid);
  }
  return subscribed;
}

async function handleSessionStatus(req, res) {
  if (!hasAccessSession(req)) {
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '未登录或会话已过期' });
    return;
  }

  try {
    const cookies = parseCookies(req);
    const session = parseAccessSessionCookie(cookies[ACCESS_SESSION_COOKIE] || '');
    if (session.v && session.v !== ACCESS_VERSION) throw new Error('session version mismatch');
    const issuedAt = Number(session.i || 0);
    const forceRemoteCheck = !issuedAt || Date.now() - issuedAt > SESSION_FORCE_CHECK_GRACE_MS;
    const subscribed = await checkFollowStatus(session.o, { force: forceRemoteCheck });
    if (!subscribed) {
      log('session status unsubscribed', maskOpenid(session.o));
      setAccessCookie(res, false);
      sendJson(res, 403, { ok: false, error: '请先关注公众号后再进入', redirectToFollow: true });
      return;
    }
    setAccessCookie(res, true, session.o);
    sendJson(res, 200, { ok: true, version: ACCESS_VERSION });
  } catch (error) {
    log('session status failed', error instanceof Error ? error.message : String(error));
    setAccessCookie(res, false);
    sendJson(res, 401, { ok: false, error: '会话校验失败，请重新验证' });
  }
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
  cleanupMaps();
  const origin = getOrigin(req) || APP_ORIGIN;
  const next = safeNext(url.searchParams.get('next'));
  if (!APPID) {
    redirect(res, `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
    return;
  }
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, {
    next,
    expireAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
    used: false,
  });
  const callback = new URL(`${origin}${API_BASE_PATH}/oauth-callback`);
  const authUrl = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  authUrl.searchParams.set('appid', APPID);
  authUrl.searchParams.set('redirect_uri', callback.toString());
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'snsapi_base');
  authUrl.searchParams.set('state', state);
  redirect(res, `${authUrl.toString()}#wechat_redirect`);
}

async function handleOauthCallback(req, res, url) {
  const origin = getOrigin(req) || APP_ORIGIN;
  cleanupMaps();
  const code = String(url.searchParams.get('code') || '').trim();
  const state = String(url.searchParams.get('state') || '').trim();
  const oauthState = oauthStates.get(state);
  const next = safeNext(oauthState?.next || '/');

  if (!APPID || !SECRET || !code || !oauthState || oauthState.used || oauthState.expireAt <= Date.now()) {
    setAccessCookie(res, false);
    redirect(res, `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
    return;
  }

  oauthState.used = true;

  try {
    const oauthUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    oauthUrl.searchParams.set('appid', APPID);
    oauthUrl.searchParams.set('secret', SECRET);
    oauthUrl.searchParams.set('code', code);
    oauthUrl.searchParams.set('grant_type', 'authorization_code');
    const oauthRes = await fetch(oauthUrl.toString());
    const oauthJson = await oauthRes.json();
    const openid = String(oauthJson?.openid || '').trim();
    if (!oauthRes.ok || !openid || oauthJson?.errcode) {
      throw new Error(oauthJson?.errmsg || 'oauth exchange failed');
    }

    let subscribed = true;
    try {
      subscribed = await checkFollowStatus(openid, { force: true });
    } catch (error) {
      if (STRICT_FOLLOW_CHECK) throw error;
      log('oauth follow check degraded', error instanceof Error ? error.message : String(error));
    }

    if (!subscribed) {
      log('oauth callback unsubscribed', maskOpenid(openid), `next=${next}`);
      setAccessCookie(res, false);
      redirect(res, `${toAppUrl(origin, '/follow')}?next=${encodeURIComponent(next)}`);
      return;
    }

    setAccessCookie(res, true, openid);
    redirect(res, `${toAppUrl(origin, '/wechat/complete')}?ok=1&next=${encodeURIComponent(next)}`);
  } catch (error) {
    log('oauth callback failed', error instanceof Error ? error.message : String(error));
    setAccessCookie(res, false);
    redirect(res, `${toAppUrl(origin, '/gate/wechat')}?next=${encodeURIComponent(next)}`);
  }
}

async function handleAccessCodeVerify(req, res) {
  if (STRICT_FOLLOW_CHECK) {
    setAccessCookie(res, false);
    sendJson(res, 403, { ok: false, error: '当前环境必须先关注服务号，请使用微信内一键进入' });
    return;
  }
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
      sendJson(res, 403, { ok: false, error: '请先关注公众号后再进入', redirectToFollow: true });
      return;
    }
    usedTickets.set(payload.n, Number(payload.e));
    setAccessCookie(res, true, payload.o);
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

  const resetRequested = ['1', 'true', 'yes'].includes(String(url.searchParams.get('reset') || '').trim().toLowerCase());
  const mode = resetRequested
    ? 'full'
    : String(url.searchParams.get('mode') || 'full').trim() === 'fast'
      ? 'fast'
      : 'full';
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
  let resetResult = null;

  try {
    if (resetRequested) {
      const supabase = await getServiceSupabase();
      if (!supabase) {
        sendJson(res, 500, { ok: false, error: '当前环境缺少重建所需服务端密钥' });
        return;
      }
      const mod = await import('./lib/ymq-sync.mjs');
      resetResult = await mod.attemptResetDb({ supabase });
      logLine(`reset requested before full sync raceId=${raceId} tournament=${tournamentName}`);
    }

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
    logLine(`triggered mode=${mode} reset=${resetRequested ? '1' : '0'} pid=${String(child.pid)} raceId=${raceId} tournament=${tournamentName}`);
    child.on('exit', (code) => {
      logLine(`finished pid=${String(child.pid)} mode=${mode} reset=${resetRequested ? '1' : '0'} code=${String(code ?? '')}`);
      activeSyncProcess = null;
    });
    sendJson(res, 202, {
      ok: true,
      mode,
      reset: resetRequested,
      resetApplied: resetRequested ? Boolean(resetResult?.resetApplied) : false,
      warning: resetResult?.warning || null,
      pid: child.pid,
      raceId,
      tournamentName,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleLocalHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    hasServiceRoleKey: Boolean(String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()),
    hasSupabaseUrl: Boolean(String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()),
  });
}

async function handleLocalSync(req, res, url) {
  req.headers['x-matchlife-sync'] = '1';
  await handleManualSync(req, res, url);
}

async function handleLocalReset(_req, res) {
  const supabase = await getServiceSupabase();
  if (!supabase) {
    sendJson(res, 500, { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL' });
    return;
  }
  const mod = await import('./lib/ymq-sync.mjs');
  const resetResult = await mod.attemptResetDb({ supabase });
  sendJson(res, 200, { ok: true, ...resetResult });
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
    if (req.method === 'GET' && isLocalApiPath(url.pathname, '/health')) {
      await handleLocalHealth(req, res);
      return;
    }

    if (req.method === 'POST' && isLocalApiPath(url.pathname, '/sync')) {
      await handleLocalSync(req, res, url);
      return;
    }

    if (req.method === 'POST' && isLocalApiPath(url.pathname, '/reset')) {
      await handleLocalReset(req, res);
      return;
    }

    if (req.method === 'GET' && isApiPath(url.pathname, '/oauth-start')) {
      await handleOauthStart(req, res, url);
      return;
    }

    if (req.method === 'GET' && isApiPath(url.pathname, '/oauth-callback')) {
      await handleOauthCallback(req, res, url);
      return;
    }

    if (req.method === 'GET' && isApiPath(url.pathname, '/session-status')) {
      await handleSessionStatus(req, res);
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

server.listen(PORT, HOST, () => {
  log(`wechat oauth server listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
