import { supabase } from './supabase';

export type PlayerProfile = {
  id: string;
  user_id: string | null;
  player_name: string;
  avatar_url: string | null;
  gender: string | null;
  dominant_hand: string | null;
  primary_sport: string;
  affiliated_club: string | null;
  coach_name: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function listPlayerProfiles(search = '', primarySport = '', limit = 100) {
  const rpc = await supabase.rpc('matchlife_list_player_profiles', {
    p_limit: limit,
    p_search: search || null,
    p_primary_sport: primarySport || null,
  });

  if (!rpc.error) {
    return (rpc.data || []) as PlayerProfile[];
  }

  const query = supabase
    .from('players')
    .select('id,user_id,player_name,avatar_url,gender,dominant_hand,primary_sport,affiliated_club,coach_name,status,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (search) {
    query.ilike('player_name', `%${search}%`);
  }

  if (primarySport) {
    query.eq('primary_sport', primarySport);
  }

  const fallback = await query;
  if (fallback.error) throw rpc.error;
  return (fallback.data || []) as PlayerProfile[];
}

export async function upsertPlayerProfile(payload: {
  playerName: string;
  primarySport: string;
  avatarUrl?: string;
  gender?: string;
  dominantHand?: string;
  affiliatedClub?: string;
  coachName?: string;
  status?: string;
}) {
  const { data, error } = await supabase.rpc('matchlife_upsert_player_profile', {
    p_player_name: payload.playerName,
    p_primary_sport: payload.primarySport,
    p_avatar_url: payload.avatarUrl ?? null,
    p_gender: payload.gender ?? null,
    p_dominant_hand: payload.dominantHand ?? null,
    p_affiliated_club: payload.affiliatedClub ?? null,
    p_coach_name: payload.coachName ?? null,
    p_status: payload.status ?? 'active',
  });

  if (error) throw error;
  return ((data || [])[0] || null) as PlayerProfile | null;
}

export async function deletePlayerProfile(id: string) {
  const { data, error } = await supabase.rpc('matchlife_delete_player_profile', {
    p_player_id: id,
  });
  if (error) throw error;
  return Boolean(data);
}
