WITH ranked_tags AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY sport_type, tag_category, lower(btrim(tag_name))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.technique_tags
)
DELETE FROM public.technique_tags t
USING ranked_tags r
WHERE t.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_technique_tags_unique_name
  ON public.technique_tags (sport_type, tag_category, (lower(btrim(tag_name))));
