import dotenv from 'dotenv';
import { createSupabaseServiceClient, resetDb } from './lib/ymq-sync.mjs';

dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createSupabaseServiceClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
await resetDb({ supabase });
console.log(JSON.stringify({ ok: true, reset: true }, null, 2));

