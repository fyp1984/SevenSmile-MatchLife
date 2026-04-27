CREATE INDEX IF NOT EXISTS idx_technique_tags_sport_active_category_sort
  ON public.technique_tags (sport_type, is_active, tag_category, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_events_match_created_event_time_desc
  ON public.match_events (match_id, created_at DESC, event_time DESC);

DROP FUNCTION IF EXISTS public.matchlife_upsert_player_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.matchlife_upsert_player_profile(
  p_player_id UUID DEFAULT NULL,
  p_player_name TEXT DEFAULT NULL,
  p_primary_sport TEXT DEFAULT NULL,
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
  target_id UUID;
BEGIN
  IF trim(COALESCE(p_player_name, '')) = '' THEN
    RAISE EXCEPTION '选手姓名不能为空';
  END IF;

  IF trim(COALESCE(p_primary_sport, '')) = '' THEN
    RAISE EXCEPTION '主运动类型不能为空';
  END IF;

  IF p_player_id IS NOT NULL THEN
    SELECT p.id
    INTO target_id
    FROM public.players p
    WHERE p.id = p_player_id
    LIMIT 1;
  END IF;

  IF target_id IS NULL THEN
    SELECT p.id
    INTO target_id
    FROM public.players p
    WHERE lower(trim(p.player_name)) = lower(trim(p_player_name))
      AND lower(trim(p.primary_sport)) = lower(trim(p_primary_sport))
    LIMIT 1;
  END IF;

  IF target_id IS NULL THEN
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
    RETURNING public.players.id INTO target_id;
  ELSE
    UPDATE public.players
    SET
      player_name = trim(p_player_name),
      primary_sport = trim(p_primary_sport),
      avatar_url = NULLIF(trim(COALESCE(p_avatar_url, '')), ''),
      gender = NULLIF(trim(COALESCE(p_gender, '')), ''),
      dominant_hand = NULLIF(trim(COALESCE(p_dominant_hand, '')), ''),
      affiliated_club = NULLIF(trim(COALESCE(p_affiliated_club, '')), ''),
      coach_name = NULLIF(trim(COALESCE(p_coach_name, '')), ''),
      status = COALESCE(NULLIF(trim(COALESCE(p_status, '')), ''), public.players.status),
      updated_at = NOW()
    WHERE public.players.id = target_id;
  END IF;

  RETURN QUERY
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
  WHERE p.id = target_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_delete_player_profile(
  p_player_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT := 0;
BEGIN
  UPDATE public.match_events
  SET player_id = NULL
  WHERE player_id = p_player_id;

  DELETE FROM public.players
  WHERE id = p_player_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.matchlife_upsert_player_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_delete_player_profile(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.matchlife_upsert_player_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_delete_player_profile(UUID) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
