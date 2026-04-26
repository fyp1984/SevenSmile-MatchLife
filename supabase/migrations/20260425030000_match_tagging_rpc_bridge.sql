CREATE OR REPLACE FUNCTION public.matchlife_get_user_reputation(p_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  total_tags INTEGER,
  verified_tags INTEGER,
  accuracy_score NUMERIC,
  reputation_level TEXT,
  total_points INTEGER,
  badges JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_reputation (user_id)
  VALUES (p_user_id)
  ON CONFLICT ON CONSTRAINT user_reputation_user_id_key DO NOTHING;

  RETURN QUERY
  SELECT
    ur.user_id,
    COALESCE(ur.total_tags, 0) AS total_tags,
    COALESCE(ur.verified_tags, 0) AS verified_tags,
    COALESCE(ur.accuracy_rate, 0) AS accuracy_score,
    COALESCE(ur.level, 'beginner')::TEXT AS reputation_level,
    COALESCE(ur.reputation_score, 0) AS total_points,
    COALESCE(ur.badges, '[]'::jsonb) AS badges,
    ur.created_at,
    ur.updated_at
  FROM public.user_reputation ur
  WHERE ur.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_user_tags(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_reputation (
    user_id,
    reputation_score,
    total_tags,
    verified_tags,
    accuracy_rate,
    level,
    badges,
    last_active_at,
    updated_at
  )
  VALUES (
    p_user_id,
    10,
    1,
    0,
    0,
    'beginner',
    '[]'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    reputation_score = public.user_reputation.reputation_score + 10,
    total_tags = public.user_reputation.total_tags + 1,
    level = CASE
      WHEN public.user_reputation.reputation_score + 10 >= 1000 THEN 'expert'
      WHEN public.user_reputation.reputation_score + 10 >= 400 THEN 'advanced'
      WHEN public.user_reputation.reputation_score + 10 >= 120 THEN 'intermediate'
      ELSE 'beginner'
    END,
    last_active_at = NOW(),
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_list_match_tags(p_match_id UUID)
RETURNS TABLE (
  id UUID,
  tag_id UUID,
  event_time INTEGER,
  video_timestamp DOUBLE PRECISION,
  notes TEXT,
  is_verified BOOLEAN,
  created_at TIMESTAMPTZ,
  created_by UUID,
  tag_name TEXT,
  tag_category TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    me.id,
    me.technique_id AS tag_id,
    me.event_time,
    me.video_timestamp,
    me.description AS notes,
    me.is_verified,
    me.created_at,
    me.created_by,
    tt.tag_name,
    tt.tag_category
  FROM public.match_events me
  LEFT JOIN public.technique_tags tt
    ON tt.id = me.technique_id
  WHERE me.match_id = p_match_id
  ORDER BY me.created_at DESC, me.event_time DESC;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_add_match_tag(
  p_match_id UUID,
  p_created_by UUID,
  p_tag_id UUID,
  p_event_time INTEGER DEFAULT 0,
  p_video_timestamp DOUBLE PRECISION DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_is_verified BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  tag_id UUID,
  event_time INTEGER,
  video_timestamp DOUBLE PRECISION,
  notes TEXT,
  is_verified BOOLEAN,
  created_at TIMESTAMPTZ,
  created_by UUID,
  tag_name TEXT,
  tag_category TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id UUID;
BEGIN
  INSERT INTO public.match_events (
    match_id,
    technique_id,
    event_type,
    event_time,
    description,
    video_timestamp,
    is_verified,
    created_by
  )
  VALUES (
    p_match_id,
    p_tag_id,
    'technique_tag',
    COALESCE(p_event_time, 0),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_video_timestamp,
    COALESCE(p_is_verified, FALSE),
    p_created_by
  )
  RETURNING public.match_events.id INTO inserted_id;

  PERFORM public.increment_user_tags(p_created_by);

  RETURN QUERY
  SELECT listed.*
  FROM public.matchlife_list_match_tags(p_match_id) AS listed
  WHERE listed.id = inserted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_update_match_tag(
  p_event_id UUID,
  p_created_by UUID,
  p_video_timestamp DOUBLE PRECISION DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  tag_id UUID,
  event_time INTEGER,
  video_timestamp DOUBLE PRECISION,
  notes TEXT,
  is_verified BOOLEAN,
  created_at TIMESTAMPTZ,
  created_by UUID,
  tag_name TEXT,
  tag_category TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_match_id UUID;
BEGIN
  UPDATE public.match_events
  SET
    video_timestamp = p_video_timestamp,
    description = NULLIF(trim(COALESCE(p_notes, '')), '')
  WHERE id = p_event_id
    AND created_by = p_created_by
  RETURNING match_id INTO target_match_id;

  IF target_match_id IS NULL THEN
    RAISE EXCEPTION '无权更新该标签或标签不存在';
  END IF;

  RETURN QUERY
  SELECT listed.*
  FROM public.matchlife_list_match_tags(target_match_id) AS listed
  WHERE listed.id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.matchlife_delete_match_tag(
  p_event_id UUID,
  p_created_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.match_events
  WHERE id = p_event_id
    AND created_by = p_created_by;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.matchlife_get_user_reputation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_user_tags(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_list_match_tags(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_add_match_tag(UUID, UUID, UUID, INTEGER, DOUBLE PRECISION, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_update_match_tag(UUID, UUID, DOUBLE PRECISION, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchlife_delete_match_tag(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.matchlife_get_user_reputation(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_tags(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_list_match_tags(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_add_match_tag(UUID, UUID, UUID, INTEGER, DOUBLE PRECISION, TEXT, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_update_match_tag(UUID, UUID, DOUBLE PRECISION, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matchlife_delete_match_tag(UUID, UUID) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
