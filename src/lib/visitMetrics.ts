import type { SupabaseClient } from '@supabase/supabase-js';

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'other';

export type VisitStats = {
  today: number;
  week: number;
  month: number;
  all: number;
};

const APP_SCOPE = 'matchlife';
const SIGNATURE_CACHE_KEY = 'matchlife_network_signature_v1';
const SIGNATURE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeBasePath(input: string) {
  const value = String(input || '/').trim();
  if (!value || value === '/') return APP_SCOPE;
  return value.replace(/^\/+|\/+$/g, '');
}

function timeoutFetch(url: string, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

async function fetchPublicIp() {
  const endpoints = [
    'https://api.ipify.org?format=json',
    'https://api64.ipify.org?format=json',
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await timeoutFetch(endpoint);
      if (!res.ok) continue;
      const json = (await res.json()) as { ip?: string };
      if (json?.ip) return json.ip.trim();
    } catch {
      // Ignore and try the next endpoint.
    }
  }

  return '';
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return 'mobile';
  if (/macintosh|windows|linux|cros/.test(ua)) return 'desktop';
  return 'other';
}

async function buildNetworkSignature() {
  try {
    const cached = window.localStorage.getItem(SIGNATURE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { value?: string; ts?: number };
      if (parsed?.value && parsed?.ts && Date.now() - parsed.ts < SIGNATURE_CACHE_TTL_MS) {
        return parsed.value;
      }
    }
  } catch {
    // Ignore cache errors.
  }

  const ip = await fetchPublicIp();
  const fallback = [
    window.location.host,
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  ].join('|');
  const signature = await sha256(ip || fallback);
  try {
    window.localStorage.setItem(
      SIGNATURE_CACHE_KEY,
      JSON.stringify({ value: signature, ts: Date.now() }),
    );
  } catch {
    // Ignore cache write errors.
  }
  return signature;
}

function getScope() {
  return normalizeBasePath(import.meta.env.BASE_URL || '/');
}

function getHost() {
  return window.location.host || 'unknown';
}

export async function recordPageVisit(supabase: SupabaseClient) {
  const signature = await buildNetworkSignature();
  const deviceType = detectDeviceType();
  const pagePath = `${window.location.pathname || '/'}${window.location.search || ''}`;

  const { error } = await supabase.rpc('record_page_visit', {
    p_source_host: getHost(),
    p_app_scope: getScope(),
    p_network_signature: signature,
    p_device_type: deviceType,
    p_page_path: pagePath,
  });

  if (error) throw error;
}

export function normalizeVisitStatsError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object'
        ? String(
            (error as { message?: string; error_description?: string; details?: string }).message ||
            (error as { error_description?: string }).error_description ||
            (error as { details?: string }).details ||
            JSON.stringify(error),
          )
        : String(error || '');
  if (/PGRST002|PGRST202|schema cache|record_page_visit|get_page_visit_stats/i.test(message)) {
    return '访问统计服务待初始化，请先应用 Supabase migration。';
  }
  if (/\[object Object\]/.test(message)) {
    return '访问统计服务暂时返回了不可识别的错误对象，已保留当前统计卡片。';
  }
  if (/upstream request timeout|timed out|fetch failed|network/i.test(message)) {
    return '访问统计服务响应超时，已保留上一次统计结果。';
  }
  return message || '访问统计暂不可用';
}

export async function fetchVisitStats(supabase: SupabaseClient): Promise<VisitStats> {
  const { data, error } = await supabase.rpc('get_page_visit_stats', {
    p_source_host: getHost(),
    p_app_scope: getScope(),
  });

  if (error) throw new Error(normalizeVisitStatsError(error));

  const row = Array.isArray(data) ? data[0] : data;
  return {
    today: Number(row?.today_count || 0),
    week: Number(row?.week_count || 0),
    month: Number(row?.month_count || 0),
    all: Number(row?.all_time_count || 0),
  };
}
