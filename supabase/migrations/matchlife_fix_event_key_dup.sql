-- Fix duplicated age prefix in event_key, e.g. "12岁12岁男单" -> "12岁男单"

UPDATE public.matches
SET event_key = regexp_replace(event_key, '^(\\d{1,2})岁\\1岁', '\\1岁')
WHERE event_key ~ '^(\\d{1,2})岁\\1岁';

