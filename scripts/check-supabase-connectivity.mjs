import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env' });

const url = process.env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY || '';
const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY || '';

if (!url || !anon) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const abortAfter = (ms) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout ${ms}ms`)), ms);
  return { ctrl, done: () => clearTimeout(timer) };
};

const call = async (name, endpoint, headers = {}, timeout = 15000) => {
  const { ctrl, done } = abortAfter(timeout);
  const started = Date.now();
  try {
    const res = await fetch(`${url}${endpoint}`, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return {
      name,
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      bodyPrefix: text.slice(0, 180),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: String(error?.message || error),
    };
  } finally {
    done();
  }
};

const basic = await call('rest_root', '/rest/v1/');
const matches = await call(
  'matches_select',
  '/rest/v1/matches?select=id,tournament_name,start_time,round_name&order=start_time.desc&limit=3',
  {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    Accept: 'application/json',
  },
  20000
);
const syncRuns = await call(
  'sync_runs_select',
  '/rest/v1/sync_runs?select=run_at,status,pulled_count,upserted_count&order=run_at.desc&limit=1',
  {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    Accept: 'application/json',
  },
  20000
);

console.log(
  JSON.stringify(
    {
      env: {
        hasUrl: Boolean(url),
        hasAnon: Boolean(anon),
        httpProxy: Boolean(httpProxy),
        httpsProxy: Boolean(httpsProxy),
      },
      checks: [basic, matches, syncRuns],
      hint:
        (!matches.ok || !syncRuns.ok) &&
        (httpProxy || httpsProxy)
          ? 'Detected proxy env. Try: env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY pnpm dev'
          : undefined,
    },
    null,
    2
  )
);
