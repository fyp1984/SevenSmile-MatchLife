export type WinnerSide = 'A' | 'B' | 'UNKNOWN';
export type MatchMode = 'singles' | 'doubles' | 'team' | 'unknown';
export type GenderBucket = 'male' | 'female' | 'mixed' | 'unknown';

type MatchLike = {
  players_a?: string[] | null;
  players_b?: string[] | null;
  score_text?: string | null;
  winner_side?: string | null;
  event_key?: string | null;
  category?: string | null;
  tournament_name?: string | null;
  source?: string | null;
};

export function normalizeParticipantName(value: string) {
  return String(value || '')
    .replace(/[／/]/g, '/')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

export function splitSearchTokens(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/[／/]/g)
    .map((item) => normalizeParticipantName(item))
    .filter(Boolean);
}

function normalizeWinnerSide(value: string | null | undefined): WinnerSide {
  return value === 'A' || value === 'B' ? value : 'UNKNOWN';
}

function parseScoreSets(scoreText: string | null | undefined) {
  const text = String(scoreText || '').trim();
  if (!text) return [];
  return text
    .split(/[,，]/)
    .map((setText) => {
      const matched = setText.match(/(\d+)\s*-\s*(\d+)/);
      if (!matched) return null;
      return { a: Number(matched[1]), b: Number(matched[2]) };
    })
    .filter(Boolean) as Array<{ a: number; b: number }>;
}

export function resolveWinnerSide(match: Pick<MatchLike, 'score_text' | 'winner_side'>): WinnerSide {
  const normalizedStored = normalizeWinnerSide(match.winner_side);
  const scoreSets = parseScoreSets(match.score_text);
  if (scoreSets.length > 0) {
    let setsA = 0;
    let setsB = 0;
    for (const set of scoreSets) {
      if (set.a > set.b) setsA += 1;
      if (set.b > set.a) setsB += 1;
    }
    if (setsA > setsB) return 'A';
    if (setsB > setsA) return 'B';
  }
  return normalizedStored;
}

export function findPlayerSide(match: Pick<MatchLike, 'players_a' | 'players_b'>, playerName: string): WinnerSide {
  const tokens = splitSearchTokens(playerName);
  if (tokens.length === 0) return 'UNKNOWN';
  const teamA = (match.players_a || []).map(normalizeParticipantName);
  const teamB = (match.players_b || []).map(normalizeParticipantName);

  const inTeam = (team: string[]) =>
    tokens.some((token) => team.some((member) => member === token || member.includes(token) || token.includes(member)));

  if (inTeam(teamA)) return 'A';
  if (inTeam(teamB)) return 'B';
  return 'UNKNOWN';
}

export function buildDisplayTeam(team: string[] | null | undefined) {
  return (team || []).filter(Boolean);
}

export function inferMatchMode(match: Pick<MatchLike, 'players_a' | 'players_b' | 'event_key' | 'category'>): MatchMode {
  const teamSize = Math.max(match.players_a?.length || 0, match.players_b?.length || 0);
  const context = `${match.event_key || ''} ${match.category || ''}`;
  if (/混双|男双|女双|双打/.test(context)) return 'doubles';
  if (/男单|女单|单打/.test(context)) return 'singles';
  if (teamSize >= 2) return 'doubles';
  if (teamSize === 1) return 'singles';
  if (/团体|团赛/.test(context)) return 'team';
  return 'unknown';
}

export function inferGenderBucket(
  match: Pick<MatchLike, 'event_key' | 'category' | 'tournament_name'>,
  profileGender?: string | null,
): GenderBucket {
  const context = `${match.event_key || ''} ${match.category || ''} ${match.tournament_name || ''}`;
  if (/混双|混合/.test(context)) return 'mixed';
  if (/女/.test(context)) return 'female';
  if (/男/.test(context)) return 'male';
  if (profileGender === 'female') return 'female';
  if (profileGender === 'male') return 'male';
  return 'unknown';
}

export function inferSportType(match: Pick<MatchLike, 'source' | 'tournament_name' | 'event_key' | 'category'>) {
  const text = `${match.source || ''} ${match.tournament_name || ''} ${match.event_key || ''} ${match.category || ''}`.toLowerCase();
  if (/网球|tennis|atp|wta/.test(text)) return 'tennis';
  if (/篮球|basketball/.test(text)) return 'basketball';
  if (/足球|football|soccer/.test(text)) return 'football';
  if (/乒乓|table.?tennis|ping.?pong/.test(text)) return 'tabletennis';
  return 'badminton';
}
