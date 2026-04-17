import dotenv from 'dotenv';
import { createSupabaseServiceClient, syncOnce } from './lib/ymq-sync.mjs';

dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const raceId = Number(process.argv[2] || 38653);
const tournamentName =
  process.argv.slice(3).join(' ').trim() ||
  '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛';
const supabase = createSupabaseServiceClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

const start = Date.now();
const result = await syncOnce({ supabase, raceId, tournamentName, mode: 'full' });
const seconds = ((Date.now() - start) / 1000).toFixed(1);
console.log(JSON.stringify({ ...result, seconds }, null, 2));
