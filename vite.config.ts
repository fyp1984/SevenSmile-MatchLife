import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';
import dotenv from 'dotenv';

type YmqSyncModule = {
  createSupabaseServiceClient: (args: { url: string; serviceRoleKey: string }) => unknown;
  resetDb: (args: { supabase: unknown }) => Promise<void>;
  syncOnce: (args: {
    supabase: unknown;
    raceId: number;
    tournamentName: string;
    mode: 'full' | 'fast';
    runKind?: string;
  }) => Promise<unknown>;
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const appBasePath = process.env.APP_BASE_PATH?.trim() || env.APP_BASE_PATH?.trim();
  // fallback logic: if running `vite build`, mode is 'production' by default
  const isProdBuild = mode === 'production' || process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production';
  const enableTraeBadge = process.env.TRAE_BADGE_ENABLE === 'true' || env.TRAE_BADGE_ENABLE === 'true';
  const supabaseProxyTarget = process.env.SUPABASE_REST_UPSTREAM?.trim() || env.SUPABASE_REST_UPSTREAM?.trim() || 'http://175.178.236.183:8000';
  
  const proxyPath = process.env.VITE_SUPABASE_PROXY_PATH || env.VITE_SUPABASE_PROXY_PATH || '/supabase';
  const wechatVersion = process.env.VITE_WECHAT_ACCESS_VERSION || env.VITE_WECHAT_ACCESS_VERSION || 'docker-local';
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || 'http://175.178.236.183:8000';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY';
  
  const normalizedBase =
    appBasePath && appBasePath !== '/'
      ? `/${appBasePath.replace(/^\/+|\/+$/g, '')}/`
      : (process.env.GITHUB_PAGES === 'true' || env.GITHUB_PAGES === 'true')
        ? '/SevenSmile-MatchLife/'
        : '/';

  return {
    base: normalizedBase,
    define: {
      'import.meta.env.VITE_WECHAT_ACCESS_VERSION': JSON.stringify(wechatVersion),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anonKey),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_PROXY_PATH': JSON.stringify(proxyPath),
      'import.meta.env.BASE_URL': JSON.stringify(normalizedBase),
    },
    server: {
      proxy: {
        '/supabase': {
          target: supabaseProxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/supabase/, ''),
        },
      },
    },
    build: {
      sourcemap: 'hidden',
    },
    plugins: [
      react({
        babel: isProdBuild
          ? undefined
          : {
              plugins: ['react-dev-locator'],
            },
      }),
      ...(enableTraeBadge
        ? [
            traeBadgePlugin({
              variant: 'dark',
              position: 'bottom-right',
              prodOnly: true,
              clickable: true,
              clickUrl: 'https://www.trae.ai/solo?showJoin=1',
              autoTheme: true,
              autoThemeTarget: '#root',
            }),
          ]
        : []),
      tsconfigPaths(),
      {
        name: 'matchlife-local-api',
        configureServer(server) {
          dotenv.config({ path: '.env.local', override: true });
          dotenv.config({ path: '.env' });

          const localSupabaseUrl = process.env.VITE_SUPABASE_URL;
          const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

          const canUseServiceRole = Boolean(localSupabaseUrl && serviceRoleKey);
          const getSupabase = async () => {
            if (!canUseServiceRole) return null;
            const mod = (await import('./scripts/lib/ymq-sync.mjs')) as unknown as YmqSyncModule;
            return mod.createSupabaseServiceClient({ url: localSupabaseUrl!, serviceRoleKey: serviceRoleKey! });
          };
          const parseRaceIdFromUrl = (value: string) => {
            try {
              const u = new URL(String(value || '').trim());
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
          };
          const firstHeader = (value: string | string[] | undefined) => {
            if (Array.isArray(value)) return value[0] || '';
            return typeof value === 'string' ? value : '';
          };

          server.middlewares.use('/api/reset', (req, res) => {
            (async () => {
              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.end('Method Not Allowed');
                return;
              }
              const supabase = await getSupabase();
              if (!supabase) {
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local' }));
                return;
              }
              const mod = (await import('./scripts/lib/ymq-sync.mjs')) as unknown as YmqSyncModule;
              await mod.resetDb({ supabase });
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });

          server.middlewares.use('/api/health', (_req, res) => {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
              }),
            );
          });

          server.middlewares.use('/api/sync', (req, res) => {
            (async () => {
              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.end('Method Not Allowed');
                return;
              }
              const supabase = await getSupabase();
              if (!supabase) {
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY in .env.local' }));
                return;
              }
              const url = new URL(req.url || '', 'http://localhost');
              const mode = (url.searchParams.get('mode') || 'full') as 'full' | 'fast';
              const mod = (await import('./scripts/lib/ymq-sync.mjs')) as unknown as YmqSyncModule;
              const raceIdsFromHeader = firstHeader(req.headers['x-matchlife-race-ids'])
                .split(',')
                .map((item) => Number(item.trim()))
                .filter((n) => Number.isFinite(n) && n > 0);
              const raceIdFromHeader = Number(firstHeader(req.headers['x-matchlife-race-id']) || '');
              const anySupabase = supabase as {
                from: (table: string) => {
                  select: (columns: string) => {
                    eq: (key: string, value: unknown) => {
                      order: (orderKey: string, options: { ascending: boolean }) => {
                        limit: (n: number) => Promise<{ data: Array<{ name: string; url: string; enabled: boolean }> | null; error: { message: string } | null }>;
                      };
                    };
                  };
                };
              };
              const { data: sourceRows } = await anySupabase
                .from('matchlife_data_sources')
                .select('name,url,enabled')
                .eq('enabled', true)
                .order('updated_at', { ascending: false })
                .limit(20);

              const sourceTargets = (sourceRows || [])
                .map((item) => ({
                  raceId: parseRaceIdFromUrl(item.url),
                  tournamentName: String(item.name || '').trim(),
                }))
                .filter((item): item is { raceId: number; tournamentName: string } => Boolean(item.raceId));

              const headerTargets = Array.from(new Set(raceIdsFromHeader)).map((raceId) => ({
                raceId,
                tournamentName: `manual-source-${raceId}`,
              }));
              const uniqueTargets = Array.from(
                new Map(sourceTargets.map((item) => [String(item.raceId), item])).values(),
              );
              const fallbackTarget = [{ raceId: 38653, tournamentName: '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛' }];
              const baseTargets =
                headerTargets.length > 0
                  ? headerTargets
                  : Number.isFinite(raceIdFromHeader) && raceIdFromHeader > 0
                    ? [{ raceId: raceIdFromHeader, tournamentName: `manual-source-${raceIdFromHeader}` }]
                    : uniqueTargets.length
                      ? uniqueTargets
                      : fallbackTarget;
              const targets = baseTargets.length
                ? mode === 'fast'
                  ? [baseTargets[0]]
                  : baseTargets
                : fallbackTarget;

              let pulledCount = 0;
              let upsertedCount = 0;
              const sourceResults = [];
              for (const target of targets) {
                try {
                  const one = await mod.syncOnce({
                    supabase,
                    raceId: target.raceId,
                    tournamentName: target.tournamentName,
                    mode,
                    runKind: `manual_${mode}_race_${target.raceId}`,
                  });
                  pulledCount += Number((one as { pulledCount?: number }).pulledCount || 0);
                  upsertedCount += Number((one as { upsertedCount?: number }).upsertedCount || 0);
                  const oneObj = one as Record<string, unknown>;
                  sourceResults.push({ raceId: target.raceId, tournamentName: target.tournamentName, ok: true, ...oneObj });
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  sourceResults.push({
                    raceId: target.raceId,
                    tournamentName: target.tournamentName,
                    ok: false,
                    error: message,
                  });
                }
              }
              const result = {
                mode,
                targetCount: targets.length,
                pulledCount,
                upsertedCount,
                sourceResults,
              };
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify(result));
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });

          server.middlewares.use('/api/wechat/oauth-start', (req, res) => {
            (async () => {
              const mod = await import('./api/wechat/oauth-start');
              const handler = mod.default as (req: unknown, res: unknown) => void;
              handler(req, res);
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });

          server.middlewares.use('/api/wechat/access-code/verify', (req, res) => {
            (async () => {
              const mod = await import('./api/wechat/access-code-verify');
              const handler = mod.default as (req: unknown, res: unknown) => Promise<void> | void;
              await handler(req, res);
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });

          server.middlewares.use('/api/wechat/magic-link/consume', (req, res) => {
            (async () => {
              const mod = await import('./api/wechat/magic-link-consume');
              const handler = mod.default as (req: unknown, res: unknown) => Promise<void> | void;
              await handler(req, res);
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });

          server.middlewares.use('/api/wechat/mp/callback', (req, res) => {
            (async () => {
              const mod = await import('./api/wechat/mp-callback');
              const handler = mod.default as (req: unknown, res: unknown) => Promise<void> | void;
              await handler(req, res);
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });

          server.middlewares.use('/api/wechat/oauth-callback', (req, res) => {
            (async () => {
              const mod = await import('./api/wechat/oauth-callback');
              const handler = mod.default as (req: unknown, res: unknown) => Promise<void> | void;
              await handler(req, res);
            })().catch((e) => {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json');
              const msg = e instanceof Error ? e.message : String(e);
              res.end(JSON.stringify({ error: msg }));
            });
          });
        },
      }
    ],
  };
});
