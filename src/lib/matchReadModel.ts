type StageLike = {
  lifecycle_status?: string | null;
  match_status?: string | null;
  is_realtime?: boolean | null;
  is_fallback?: boolean | null;
};

type MatchRefLike = {
  persisted_match_id?: string | null;
  match_id?: string | null;
  detail_match_id?: string | null;
  id?: string | null;
  source_match_id?: string | null;
  detail_match_ref?: string | null;
  canonical_match_id?: string | null;
};

export function isFallbackDisplay(match: StageLike) {
  return Boolean(
    match.is_fallback ||
      match.lifecycle_status === 'manual_review' ||
      match.lifecycle_status === 'quality_blocked' ||
      match.lifecycle_status === 'persist_failed',
  );
}

export function isPollingPreferred(match: StageLike) {
  if (match.is_realtime) return true;
  if (match.match_status === 'LIVE') return true;
  return ['hot_cached', 'normalized', 'pending_persist', 'persist_failed'].includes(
    String(match.lifecycle_status || ''),
  );
}

export function getStageBadgeClass(match: StageLike) {
  if (isFallbackDisplay(match)) {
    return 'bg-amber-100 text-amber-800';
  }
  switch (match.lifecycle_status) {
    case 'hot_cached':
    case 'normalized':
      return 'bg-sky-100 text-sky-700';
    case 'pending_persist':
    case 'persist_failed':
      return 'bg-violet-100 text-violet-700';
    case 'persisted':
    case 'archived':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return match.is_realtime ? 'bg-sky-100 text-sky-700' : 'bg-orange-100 text-orange-700';
  }
}

export function getStageHintClass(match: StageLike) {
  if (isFallbackDisplay(match)) return 'text-amber-700/90';
  if (match.lifecycle_status === 'pending_persist' || match.lifecycle_status === 'persist_failed') {
    return 'text-violet-700/90';
  }
  if (match.lifecycle_status === 'persisted' || match.lifecycle_status === 'archived') {
    return 'text-emerald-700/90';
  }
  return 'text-sky-700/90';
}

export function getMatchCardClass(match: StageLike) {
  if (isFallbackDisplay(match)) {
    return 'bg-amber-50/70 border-amber-100';
  }
  if (match.is_realtime) {
    return 'bg-orange-50/70 border-orange-100';
  }
  return 'bg-white border-orange-50';
}

export function buildMatchDetailPath(matchRef: string) {
  return `/matches/${encodeURIComponent(matchRef)}`;
}

export function getPreferredMatchDetailRef(match: MatchRefLike) {
  return (
    match.persisted_match_id ||
    match.match_id ||
    match.detail_match_id ||
    match.id ||
    match.source_match_id ||
    match.detail_match_ref ||
    match.canonical_match_id ||
    ''
  );
}

export function buildMatchTaggingPath(matchId: string) {
  return `/matches/${encodeURIComponent(matchId)}/tagging`;
}
