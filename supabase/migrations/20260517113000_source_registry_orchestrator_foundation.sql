ALTER TABLE IF EXISTS public.matchlife_data_sources
  ADD COLUMN IF NOT EXISTS adapter_key TEXT NOT NULL DEFAULT 'ymq-live',
  ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'http',
  ADD COLUMN IF NOT EXISTS format_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('draft', 'active', 'paused', 'deprecated', 'retired')),
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'failing', 'paused', 'retired')),
  ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_mode IN ('none', 'header', 'query', 'oauth2', 'basic', 'custom')),
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capability_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS schedule_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS circuit_breaker_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS permission_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auth_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_succeeded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS last_error_message TEXT,
  ADD COLUMN IF NOT EXISTS next_eligible_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS circuit_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timeout_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.matchlife_data_sources
SET
  adapter_key = CASE
    WHEN format = 'tennis-json' THEN 'tennis-json'
    ELSE 'ymq-live'
  END,
  protocol = CASE
    WHEN type = 'file' THEN 'file'
    ELSE 'http'
  END,
  health_status = CASE
    WHEN enabled THEN 'healthy'
    ELSE 'paused'
  END,
  lifecycle_status = CASE
    WHEN enabled THEN 'active'
    ELSE 'paused'
  END,
  capability_flags = CASE
    WHEN format = 'tennis-json' THEN '["pull","normalize","persist-stable"]'::jsonb
    ELSE '["discover","pull","normalize","cache-live","persist-ready"]'::jsonb
  END,
  schedule_profile = CASE
    WHEN format = 'tennis-json' THEN
      jsonb_build_object(
        'mode', 'interval',
        'discoveryIntervalMs', 60000,
        'activeIntervalMs', 15000,
        'idleIntervalMs', 120000
      )
    ELSE
      jsonb_build_object(
        'mode', 'adaptive',
        'discoveryIntervalMs', 30000,
        'activeIntervalMs', 1500,
        'idleIntervalMs', 10000
      )
  END,
  retry_policy = jsonb_build_object(
    'maxAttempts', 3,
    'baseDelayMs', 5000,
    'maxDelayMs', 120000,
    'strategy', 'exponential',
    'retryableCodes', jsonb_build_array('TIMEOUT', 'NETWORK', 'UPSTREAM_5XX', 'RATE_LIMITED')
  ),
  circuit_breaker_policy = jsonb_build_object(
    'failureThreshold', 3,
    'timeoutThreshold', 2,
    'cooldownMs', 300000
  ),
  permission_config = jsonb_build_object(
    'ownerRole', 'data-platform',
    'readRoles', jsonb_build_array('anon', 'authenticated', 'service_role'),
    'writeRoles', jsonb_build_array('service_role')
  )
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_matchlife_data_sources_registry_due
  ON public.matchlife_data_sources (enabled, lifecycle_status, health_status, next_eligible_at, priority, updated_at DESC);

ALTER TABLE IF EXISTS public.sync_runs
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS adapter_key TEXT,
  ADD COLUMN IF NOT EXISTS run_group TEXT,
  ADD COLUMN IF NOT EXISTS trigger_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_mode IN ('manual', 'schedule', 'recovery', 'adhoc')),
  ADD COLUMN IF NOT EXISTS attempt_no INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS retry_kind TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS circuit_state TEXT NOT NULL DEFAULT 'closed'
    CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  ADD COLUMN IF NOT EXISTS isolation_key TEXT,
  ADD COLUMN IF NOT EXISTS result_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sync_runs_source_attempt
  ON public.sync_runs (source_id, run_at DESC, attempt_no DESC);

CREATE OR REPLACE VIEW public.matchlife_source_registry_overview AS
SELECT
  s.id,
  s.name,
  s.type,
  s.url,
  s.format,
  s.adapter_key,
  s.protocol,
  s.format_version,
  s.enabled,
  s.lifecycle_status,
  s.health_status,
  s.priority,
  s.schedule_profile,
  s.retry_policy,
  s.circuit_breaker_policy,
  s.permission_config,
  s.metadata,
  s.capability_flags,
  s.origin,
  s.failure_streak,
  s.timeout_streak,
  s.last_collected_at,
  s.last_succeeded_at,
  s.last_failed_at,
  s.last_alerted_at,
  s.last_error_code,
  s.last_error_message,
  s.next_eligible_at,
  s.circuit_opened_at,
  s.updated_at,
  CASE
    WHEN NOT s.enabled OR s.lifecycle_status IN ('paused', 'retired') THEN FALSE
    WHEN s.next_eligible_at IS NOT NULL AND s.next_eligible_at > NOW() THEN FALSE
    ELSE TRUE
  END AS is_due
FROM public.matchlife_data_sources s;

GRANT SELECT ON public.matchlife_source_registry_overview TO anon, authenticated, service_role;
