import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { normalizeVisitStatsError, recordPageVisit } from '../lib/visitMetrics';

const VISIT_DEDUP_KEY = 'matchlife_visit_last_record_v1';
const VISIT_DEDUP_WINDOW_MS = 800;

export function useVisitTracker() {
  const location = useLocation();

  useEffect(() => {
    const path = `${location.pathname || '/'}${location.search || ''}`;
    const now = Date.now();
    try {
      const raw = window.sessionStorage.getItem(VISIT_DEDUP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { path?: string; ts?: number };
        if (parsed?.path === path && parsed?.ts && now - parsed.ts < VISIT_DEDUP_WINDOW_MS) {
          return;
        }
      }
      window.sessionStorage.setItem(VISIT_DEDUP_KEY, JSON.stringify({ path, ts: now }));
    } catch {
      // Ignore storage failures and continue recording.
    }

    recordPageVisit(supabase)
      .then(() => {
        window.dispatchEvent(new CustomEvent('matchlife:visit-recorded'));
      })
      .catch((error) => {
        const message = normalizeVisitStatsError(error);
        if (/待初始化/.test(message)) return;
        console.warn('recordPageVisit failed', message);
      });
  }, [location.pathname, location.search]);
}
