WITH recalculated AS (
  SELECT
    m.id,
    CASE
      WHEN COALESCE((m.raw ->> 'scoreStatusNo')::INT, 0) <> 2 THEN 'UNKNOWN'
      WHEN COALESCE((m.raw ->> 'scoreOne')::INT, -1) > COALESCE((m.raw ->> 'scoreTwo')::INT, -1) THEN 'A'
      WHEN COALESCE((m.raw ->> 'scoreTwo')::INT, -1) > COALESCE((m.raw ->> 'scoreOne')::INT, -1) THEN 'B'
      WHEN score_sets.sets_a > score_sets.sets_b THEN 'A'
      WHEN score_sets.sets_b > score_sets.sets_a THEN 'B'
      WHEN COALESCE((m.raw ->> 'battleScoreOne')::INT, -1) > COALESCE((m.raw ->> 'battleScoreTwo')::INT, -1) THEN 'A'
      WHEN COALESCE((m.raw ->> 'battleScoreTwo')::INT, -1) > COALESCE((m.raw ->> 'battleScoreOne')::INT, -1) THEN 'B'
      ELSE 'UNKNOWN'
    END AS corrected_winner_side
  FROM public.matches m
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE COALESCE((g ->> 'scoreOne')::INT, -1) > COALESCE((g ->> 'scoreTwo')::INT, -1)
      )::INT AS sets_a,
      COUNT(*) FILTER (
        WHERE COALESCE((g ->> 'scoreTwo')::INT, -1) > COALESCE((g ->> 'scoreOne')::INT, -1)
      )::INT AS sets_b
    FROM jsonb_array_elements(COALESCE(m.raw -> 'gameScores', '[]'::jsonb)) AS g
  ) AS score_sets ON TRUE
  WHERE m.source = 'ymq'
)
UPDATE public.matches AS m
SET winner_side = recalculated.corrected_winner_side
FROM recalculated
WHERE m.id = recalculated.id
  AND m.winner_side IS DISTINCT FROM recalculated.corrected_winner_side;

REFRESH MATERIALIZED VIEW public.mv_player_rankings_history_cache;
