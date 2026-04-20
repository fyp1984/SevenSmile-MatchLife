import { createClient } from '@supabase/supabase-js';

function resolveSupabaseUrl() {
  const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  if (isLocalHost && configuredUrl.startsWith('http')) {
    return `${origin}/supabase`;
  }
  return configuredUrl;
}

export const supabaseUrl = resolveSupabaseUrl();
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
