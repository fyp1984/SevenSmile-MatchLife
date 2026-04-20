import dotenv from 'dotenv';
import { createSupabaseServiceClient, syncOnce } from './lib/ymq-sync.mjs';

dotenv.config({ path: '.env.runtime' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.runtime');
}

const modeArg = String(process.argv[2] || 'full').trim();
const mode = modeArg === 'fast' ? 'fast' : 'full';
const raceId = Number(process.env.SYNC_RACE_ID || 38653);
const tournamentName =
  String(process.env.SYNC_TOURNAMENT_NAME || '').trim() ||
  '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛';
const raceIdsRaw = String(process.env.SYNC_RACE_IDS || '').trim();
const raceIds = raceIdsRaw
  ? raceIdsRaw
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  : [];

const supabase = createSupabaseServiceClient({
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
});

const startedAt = Date.now();
let result;
if (raceIds.length > 0) {
  let pulledCount = 0;
  let upsertedCount = 0;
  const sourceResults = [];
  const uniqueRaceIds = Array.from(new Set(raceIds));
  for (const currentRaceId of uniqueRaceIds) {
    const currentTournamentName = `${tournamentName}#${currentRaceId}`;
    try {
      const one = await syncOnce({
        supabase,
        raceId: currentRaceId,
        tournamentName: currentTournamentName,
        mode,
        runKind: `${mode}_race_${currentRaceId}`,
      });
      pulledCount += Number(one?.pulledCount || 0);
      upsertedCount += Number(one?.upsertedCount || 0);
      sourceResults.push({ raceId: currentRaceId, ok: true, ...one });
    } catch (error) {
      sourceResults.push({
        raceId: currentRaceId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  result = {
    pulledCount,
    upsertedCount,
    sourceResults,
  };
} else {
  result = await syncOnce({
    supabase,
    raceId,
    tournamentName,
    mode,
  });
}
const durationMs = Date.now() - startedAt;
console.log(
  JSON.stringify(
    {
      ok: true,
      mode,
      durationMs,
      ...result,
    },
    null,
    2
  )
);
