const STORAGE_KEY = 'matchlife_local_contributor_id';

export function getLocalContributorId() {
  if (typeof window === 'undefined') {
    return '00000000-0000-4000-8000-000000000001';
  }

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const nextId = window.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000001';
  window.localStorage.setItem(STORAGE_KEY, nextId);
  return nextId;
}
