import { defineConfig } from 'vite'
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
  }) => Promise<unknown>;
};

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }), 
    tsconfigPaths(),
    {
      name: 'matchlife-local-api',
      configureServer(server) {
        dotenv.config({ path: '.env.local', override: true });
        dotenv.config({ path: '.env' });

        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        const canUseServiceRole = Boolean(supabaseUrl && serviceRoleKey);
        const getSupabase = async () => {
          if (!canUseServiceRole) return null;
          const mod = (await import('./scripts/lib/ymq-sync.mjs')) as unknown as YmqSyncModule;
          return mod.createSupabaseServiceClient({ url: supabaseUrl!, serviceRoleKey: serviceRoleKey! });
        };

        server.middlewares.use('/api/reset', (req, res, next) => {
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
            next?.(e);
          });
        });

        server.middlewares.use('/api/health', (req, res) => {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
            }),
          );
        });

        server.middlewares.use('/api/sync', (req, res, next) => {
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
            const result = await mod.syncOnce({
              supabase,
              raceId: 38653,
              tournamentName: '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛',
              mode,
            });
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(result));
          })().catch((e) => {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            const msg = e instanceof Error ? e.message : String(e);
            res.end(JSON.stringify({ error: msg }));
            next?.(e);
          });
        });
      },
    }
  ],
})
