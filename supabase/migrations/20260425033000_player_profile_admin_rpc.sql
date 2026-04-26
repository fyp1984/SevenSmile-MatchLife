CREATE OR REPLACE FUNCTION public.matchlife_list_player_profiles(
  p_limit INT DEFAULT 100,
  p_search TEXT DEFAULT NULL,
  p_primary_sport TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  player_name TEXT,
  avatar_url TEXT,
  gender TEXT,
  dominant_hand TEXT,
  primary_sport TEXT,
  affiliated_club TEXT,
  coach_name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.user_id,
    p.player_name::TEXT,
    p.avatar_url,
    p.gender::TEXT,
    p.dominant_hand::TEXT,
    p.primary_sport::TEXT,
    p.affiliated_club,
    p.coach_name,
    p.status::TEXT,
    p.created_at,
    p.updated_at
  FROM public.players p
  WHERE (p_search IS NULL OR p_search = '' OR p.player_name ILIKE '%' || p_search || '%')
    AND (p_primary_sport IS NULL OR p_primary_sport = '' OR p.primary_sport = p_primary_sport)
  ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.matchlife_upsert_player_profile(
  p_player_name TEXT,
  p_primary_sport TEXT,
  p_avatar_url TEXT DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_dominant_hand TEXT DEFAULT NULL,
  p_affiliated_club TEXT DEFAULT NULL,
  p_coach_name TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'active'
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  player_name TEXT,
  avatar_url TEXT,
  gender TEXT,
  dominant_hand TEXT,
  primary_sport TEXT,
  affiliated_club TEXT,
  coach_name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id UUID;
BEGIN
  IF trim(COALESCE(p_player_name, '')) = '' THEN
    RAISE EXCEPTION '选手姓名不能为空';
  END IF;

  IF trim(COALESCE(p_primary_sport, '')) = '' THEN
    RAISE EXCEPTION '主运动类型不能为空';
  END IF;

  SELECT p.id
  INTO existing_id
  FROM public.players p
  WHERE lower(trim(p.player_name)) = lower(trim(p_player_name))
    AND lower(trim(p.primary_sport)) = lower(trim(p_primary_sport))
  LIMIT 1;

  IF existing_id IS NULL THEN
    INSERT INTO public.players (
      player_name,
      avatar_url,
      gender,
      dominant_hand,
      primary_sport,
      affiliated_club,
      coach_name,
      status
    )
    VALUES (
      trim(p_player_name),
      NULLIF(trim(COALESCE(p_avatar_url, '')), ''),
      NULLIF(trim(COALESCE(p_gender, '')), ''),
      NULLIF(trim(COALESCE(p_dominant_hand, '')), ''),
      trim(p_primary_sport),
      NULLIF(trim(COALESCE(p_affiliated_club, '')), ''),
      NULLIF(trim(COALESCE(p_coach_name, '')), ''),
      COALESCE(NULLIF(trim(COALESCE(p_status, '')), ''), 'active')
    )
    RETURNING public.players.id INTO existing_id;
  ELSE
    UPDATE public.players
    SET
      avatar_url = COALESCE(NULLIF(trim(COALESCE(p_avatar_url, '')), ''), public.players.avatar_url),
      gender = COALESCE(NULLIF(trim(COALESCE(p_gender, '')), ''), public.players.gender),
      dominant_hand = COALESCE(NULLIF(trim(COALESCE(p_dominant_hand, '')), ''), public.players.dominant_hand),
      affiliated_club = COALESCE(NULLIF(trim(COALESCE(p_affiliated_club, '')), ''), public.players.affiliated_club),
      coach_name = COALESCE(NULLIF(trim(COALESCE(p_coach_name, '')), ''), public.players.coach_name),
      status = COALESCE(NULLIF(trim(COALESCE(p_status, '')), ''), public.players.status),
      updated_at = NOW()
    WHERE public.players.id = existing_id;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.matchlife_list_player_profiles(1, trim(p_player_name), trim(p_primary_sport));
END;
$$;

REVOKE ALL ON FUNCTION public.matchlife_list_player_profiles(INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_upsert_player_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.matchlife_list_player_profiles(INT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_upsert_player_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
