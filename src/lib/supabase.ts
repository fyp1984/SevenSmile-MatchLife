import { createClient } from '@supabase/supabase-js';

function normalizePath(input: string) {
  const value = String(input || '').trim();
  if (!value) return '';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function resolveSupabaseUrl() {
  const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
  const proxyPath = normalizePath(String(import.meta.env.VITE_SUPABASE_PROXY_PATH || ''));
  if (typeof window === 'undefined') {
    return proxyPath || configuredUrl;
  }

  const { hostname, origin, protocol } = window.location;
  const basePath = normalizePath(import.meta.env.BASE_URL || '/');
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isSecurePage = protocol === 'https:';
  const defaultProxyPath = `${basePath || ''}/supabase`.replace(/\/{2,}/g, '/');

  if (proxyPath) {
    return new URL(proxyPath, origin).toString();
  }

  if (isLocalHost && configuredUrl.startsWith('http')) {
    return new URL('/supabase', origin).toString();
  }

  // When the page is served over HTTPS but the data endpoint is plain HTTP,
  // route through the same-origin proxy exposed by Nginx to avoid mixed content.
  if (isSecurePage && configuredUrl.startsWith('http://')) {
    return new URL(defaultProxyPath, origin).toString();
  }

  return configuredUrl || new URL(defaultProxyPath, origin).toString();
}

export const supabaseUrl = resolveSupabaseUrl();
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function getSupabaseErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: string; details?: string; hint?: string; error_description?: string };
    return String(record.message || record.details || record.hint || record.error_description || JSON.stringify(error));
  }
  return String(error || '');
}

export function isTransientGatewayError(error: unknown) {
  return /(504 Gateway Time-out|502 Bad Gateway|503 Service Unavailable|upstream|timed out|timeout|ERR_ABORTED|Failed to fetch|fetch failed)/i.test(
    getSupabaseErrorMessage(error),
  );
}

export function getFriendlySupabaseErrorMessage(error: unknown, fallback = '加载失败') {
  if (isTransientGatewayError(error)) {
    return '数据链路暂时拥堵，请稍后重试。';
  }
  return getSupabaseErrorMessage(error) || fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function retrySupabaseOperation<T>(
  operation: () => PromiseLike<T> | T,
  options?: { retries?: number; delayMs?: number },
) {
  const retries = Math.max(0, options?.retries ?? 1);
  const delayMs = Math.max(0, options?.delayMs ?? 400);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientGatewayError(error)) {
        throw error;
      }
      await delay(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}
