import fs from 'node:fs';
import { createSupabaseServiceClient, resetDb, syncOnce } from './lib/ymq-sync.mjs';

function parseEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

function parseRaceIdFromUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const fromSearch =
      u.searchParams.get('game_id') ||
      u.searchParams.get('raceId') ||
      u.searchParams.get('race_id');
    const hash = (u.hash || '').replace(/^#/, '');
    let fromHash = '';
    if (hash.includes('?')) {
      const query = hash.slice(hash.indexOf('?') + 1);
      const params = new URLSearchParams(query);
      fromHash =
        params.get('game_id') || params.get('raceId') || params.get('race_id') || '';
    }
    const n = Number(fromSearch || fromHash || '');
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function main() {
  const env = parseEnvFile('.env.local');
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createSupabaseServiceClient({ url: supabaseUrl, serviceRoleKey });
  const restBase = supabaseUrl.replace(/\/+$/, '');
  const sourceRes = await fetch(
    `${restBase}/rest/v1/matchlife_data_sources?select=id,name,url,enabled,updated_at&enabled=eq.true&order=updated_at.desc&limit=20`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    },
  );
  if (!sourceRes.ok) {
    throw new Error(`读取数据源失败: ${sourceRes.status} ${await sourceRes.text()}`);
  }
  const data = await sourceRes.json();

  const targets = [];
  const seen = new Set();
  for (const row of data || []) {
    const raceId = parseRaceIdFromUrl(row.url);
    if (!raceId || seen.has(raceId)) continue;
    seen.add(raceId);
    targets.push({
      raceId,
      name: String(row.name || `source-${raceId}`),
    });
    if (targets.length === 2) break;
  }
  if (targets.length < 2) {
    throw new Error('当前启用数据源少于2个，无法按要求执行双源全量同步');
  }

  try {
    await resetDb({ supabase });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null
          ? String(error.message || error.details || JSON.stringify(error))
          : String(error);
    if (!/matchlife_reset_db|PGRST202/i.test(message)) {
      throw error;
    }
  }

  const results = [];
  for (const target of targets) {
    try {
      const one = await syncOnce({
        supabase,
        raceId: target.raceId,
        tournamentName: target.name,
        mode: 'full',
        runKind: `manual_full_race_${target.raceId}`,
      });
      results.push({ ...target, ok: true, ...one });
    } catch (error) {
      results.push({
        ...target,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        reset: true,
        targetCount: targets.length,
        targets,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
