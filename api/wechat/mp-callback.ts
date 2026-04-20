import crypto from 'node:crypto';

type VercelReq = {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
  on?: (event: string, cb: (chunk?: Buffer) => void) => void;
};

type VercelRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

function firstHeader(v: unknown) {
  if (Array.isArray(v)) return v[0] || '';
  return typeof v === 'string' ? v : '';
}

function getOrigin(req: VercelReq) {
  const proto = firstHeader(req.headers?.['x-forwarded-proto']) || 'https';
  const host = firstHeader(req.headers?.['x-forwarded-host']) || firstHeader(req.headers?.host);
  return `${proto}://${host}`;
}

function normalizeBasePath(input: string) {
  const v = String(input || '/').trim();
  if (!v || v === '/') return '';
  return `/${v.replace(/^\/+|\/+$/g, '')}`;
}

const APP_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || '/');
const APP_ORIGIN = `${process.env.APP_ORIGIN || ''}`.trim() || 'https://tools.cheersai.cloud';
const MP_TOKEN = `${process.env.WECHAT_MP_TOKEN || ''}`.trim();
const KEYWORD = `${process.env.WECHAT_ACCESS_KEYWORD || '比赛生涯'}`.trim();
const SIGNING_SECRET =
  process.env.WECHAT_ACCESS_LINK_SECRET ||
  process.env.WECHAT_MP_SECRET ||
  process.env.WECHAT_ACCESS_CODES ||
  'matchlife-dev-secret';
const ACCESS_VERSION =
  `${process.env.WECHAT_ACCESS_VERSION || process.env.VITE_WECHAT_ACCESS_VERSION || ''}`.trim() ||
  new Date().toISOString().slice(0, 10);
const ACCESS_LINK_TTL_SECONDS = Number(process.env.WECHAT_ACCESS_LINK_TTL_SECONDS || 10 * 60);

function safeNext(next: string | null | undefined) {
  const v = String(next || '/').trim();
  return v.startsWith('/') ? v : '/';
}

function base64url(input: string) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signValue(value: string) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(value).digest('hex');
}

function issueMagicTicket(openid: string, next = '/') {
  const payload = {
    o: openid,
    n: crypto.randomBytes(8).toString('hex'),
    v: ACCESS_VERSION,
    e: Date.now() + ACCESS_LINK_TTL_SECONDS * 1000,
    p: safeNext(next),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signValue(encoded)}`;
}

function verifyWechatSignature(signature: string, timestamp: string, nonce: string) {
  if (!MP_TOKEN) return false;
  const arr = [MP_TOKEN, timestamp, nonce].sort();
  const check = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return check === signature;
}

function extractXmlValue(xml: string, tag: string) {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`));
  if (cdata?.[1] != null) return cdata[1];
  const plain = xml.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
  return plain?.[1] || '';
}

function xmlTextReply(toUser: string, fromUser: string, content: string) {
  return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${content}]]></Content>
</xml>`;
}

async function readBody(req: VercelReq) {
  if (typeof req.body === 'string') return req.body;
  if (!req.on) return '';
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on?.('data', (chunk?: Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on?.('end', () => resolve());
  });
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelReq, res: VercelRes) {
  const origin = getOrigin(req);
  const url = new URL(req.url || '', origin);

  if (req.method === 'GET') {
    const signature = String(url.searchParams.get('signature') || '');
    const timestamp = String(url.searchParams.get('timestamp') || '');
    const nonce = String(url.searchParams.get('nonce') || '');
    const echostr = String(url.searchParams.get('echostr') || '');
    if (!verifyWechatSignature(signature, timestamp, nonce)) {
      res.statusCode = 401;
      res.end('bad signature');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(echostr);
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  const xml = await readBody(req);
  const toUser = extractXmlValue(xml, 'ToUserName');
  const fromUser = extractXmlValue(xml, 'FromUserName');
  const msgType = extractXmlValue(xml, 'MsgType');
  const content = extractXmlValue(xml, 'Content').trim();
  const event = extractXmlValue(xml, 'Event').trim().toUpperCase();
  const eventKey = extractXmlValue(xml, 'EventKey').trim();

  let reply = `欢迎关注“七笑果-文体有料”。回复“${KEYWORD}”获取比赛生涯系统直达链接。`;
  if (msgType === 'text' && content === KEYWORD) {
    const ticket = issueMagicTicket(fromUser, '/');
    reply = `点击直达：${APP_ORIGIN}${APP_BASE_PATH}/wechat/complete?ticket=${encodeURIComponent(ticket)}\n10分钟内有效，若失效请再次回复“${KEYWORD}”。`;
  } else if (msgType === 'event' && event === 'CLICK' && eventKey === 'MATCH_LIFE_ENTRY') {
    const ticket = issueMagicTicket(fromUser, '/');
    reply = `点击进入：${APP_ORIGIN}${APP_BASE_PATH}/wechat/complete?ticket=${encodeURIComponent(ticket)}\n10分钟内有效。`;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.end(xmlTextReply(fromUser, toUser, reply));
}
