import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const ITERATIONS = Number(process.env.BENCH_ITERATIONS || 20000);
const SECRET = process.env.WECHAT_ACCESS_LINK_SECRET || 'bench-secret';
const VERSION = process.env.WECHAT_ACCESS_VERSION || new Date().toISOString().slice(0, 10);

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
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

function issueTicket(openid) {
  const payload = {
    o: openid,
    n: crypto.randomBytes(8).toString('hex'),
    v: VERSION,
    e: Date.now() + 10 * 60 * 1000,
    p: '/',
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signValue(encoded)}`;
}

function verifyTicket(ticket) {
  const [encoded, sig] = ticket.split('.', 2);
  if (signValue(encoded) !== sig) throw new Error('bad signature');
  const payload = JSON.parse(base64urlDecode(encoded));
  if (!payload?.o) throw new Error('bad payload');
  return payload;
}

function benchmark(name, fn) {
  const start = performance.now();
  fn();
  const end = performance.now();
  return {
    name,
    totalMs: Number((end - start).toFixed(2)),
    avgMs: Number(((end - start) / ITERATIONS).toFixed(4)),
  };
}

const openids = Array.from({ length: ITERATIONS }, (_, i) => `openid_${i}`);
const tickets = [];
const followerSet = new Set(openids);

const results = [];

results.push(
  benchmark('issue_ticket', () => {
    for (let i = 0; i < ITERATIONS; i += 1) tickets.push(issueTicket(openids[i]));
  })
);

results.push(
  benchmark('verify_ticket', () => {
    for (let i = 0; i < ITERATIONS; i += 1) verifyTicket(tickets[i]);
  })
);

results.push(
  benchmark('follower_set_lookup', () => {
    for (let i = 0; i < ITERATIONS; i += 1) followerSet.has(openids[i]);
  })
);

console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      version: VERSION,
      results,
      note: '仅覆盖本地票据签发/验签/缓存命中路径，不含微信远程接口网络耗时',
    },
    null,
    2
  )
);
