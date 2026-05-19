import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { createSupabaseServiceClient, syncOnce } from './lib/ymq-sync.mjs';

dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createSupabaseServiceClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

const DEFAULT_RACE_ID = Number(process.argv[2] || process.env.SYNC_RACE_ID || 38653);
const DEFAULT_TOURNAMENT_NAME =
  process.argv.slice(3).join(' ').trim() ||
  String(process.env.SYNC_TOURNAMENT_NAME || '').trim() ||
  '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛';
const EXPLICIT_RACE_IDS = String(process.env.SYNC_RACE_IDS || '')
  .split(',')
  .map((item) => Number(item.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const DISCOVERY_INTERVAL_MS = Number(process.env.MATCHLIFE_DISCOVERY_INTERVAL_MS || 30_000);
const ACTIVE_INTERVAL_MS = Number(process.env.MATCHLIFE_ACTIVE_INTERVAL_MS || 1500);
const IDLE_FAST_INTERVAL_MS = Number(process.env.MATCHLIFE_IDLE_FAST_INTERVAL_MS || 10_000);
const ACTIVE_IDLE_MS = Number(process.env.MATCHLIFE_ACTIVE_IDLE_MS || 60_000);
const ACTIVE_PAGES = Number(process.env.MATCHLIFE_ACTIVE_PAGES || 2);
const HEARTBEAT_FILE = (process.env.MATCHLIFE_HEARTBEAT_FILE || '').trim();
const STATE_FILE = (
  process.env.MATCHLIFE_STATE_FILE || (HEARTBEAT_FILE ? join(dirname(HEARTBEAT_FILE), 'sync-state.json') : '')
).trim();
const AUTO_PAUSE_IDLE_MS = Number(process.env.MATCHLIFE_AUTO_PAUSE_IDLE_MS || 86_400_000);
const AUTO_PAUSE_ERROR_MS = Number(process.env.MATCHLIFE_AUTO_PAUSE_ERROR_MS || 86_400_000);
const PAUSED_HEARTBEAT_INTERVAL_MS = Number(process.env.MATCHLIFE_PAUSED_HEARTBEAT_INTERVAL_MS || 300_000);
const QUIET_HOURS_START_HOUR = Number(process.env.MATCHLIFE_QUIET_HOURS_START_HOUR || 23);
const QUIET_HOURS_END_HOUR = Number(process.env.MATCHLIFE_QUIET_HOURS_END_HOUR || 8);
const QUIET_HOURS_TIMEZONE = (process.env.MATCHLIFE_QUIET_HOURS_TIMEZONE || 'Asia/Shanghai').trim();
const QUIET_HEARTBEAT_INTERVAL_MS = Number(process.env.MATCHLIFE_QUIET_HEARTBEAT_INTERVAL_MS || 120_000);
const IDLE_WARM_AFTER_MS = Number(process.env.MATCHLIFE_IDLE_WARM_AFTER_MS || 10 * 60_000);
const IDLE_WARM_INTERVAL_MS = Number(process.env.MATCHLIFE_IDLE_WARM_INTERVAL_MS || 30_000);
const IDLE_COOL_AFTER_MS = Number(process.env.MATCHLIFE_IDLE_COOL_AFTER_MS || 30 * 60_000);
const IDLE_COOL_INTERVAL_MS = Number(process.env.MATCHLIFE_IDLE_COOL_INTERVAL_MS || 60_000);
const NET_IFACE = (process.env.MATCHLIFE_NET_IFACE || '').trim();
const NET_CAPACITY_MBPS = Number(process.env.MATCHLIFE_NET_CAPACITY_MBPS || 0);
const NET_UTILIZATION_THRESHOLD = Number(process.env.MATCHLIFE_NET_UTILIZATION_THRESHOLD || 0.8);
const NET_SAMPLE_WINDOW_MS = Number(process.env.MATCHLIFE_NET_SAMPLE_WINDOW_MS || 15_000);
const NET_DEFER_INTERVAL_MS = Number(process.env.MATCHLIFE_NET_DEFER_INTERVAL_MS || 20_000);
const ERROR_BACKOFF_BASE_MS = Number(process.env.MATCHLIFE_ERROR_BACKOFF_BASE_MS || 5_000);
const ERROR_BACKOFF_MAX_MS = Number(process.env.MATCHLIFE_ERROR_BACKOFF_MAX_MS || 120_000);

const hotCourts = new Map();
let stopping = false;
let runtimeState = await readRuntimeState();
let cachedDefaultIface = NET_IFACE || null;
let cachedLinkCapacityMbps = NET_CAPACITY_MBPS > 0 ? NET_CAPACITY_MBPS : null;
let netSample = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRaceIdFromSource(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    const fromSearch = u.searchParams.get('game_id') || u.searchParams.get('raceId') || u.searchParams.get('race_id');
    const hash = (u.hash || '').replace(/^#/, '');
    let fromHash = '';
    if (hash.includes('?')) {
      const query = hash.slice(hash.indexOf('?') + 1);
      const hp = new URLSearchParams(query);
      fromHash = hp.get('game_id') || hp.get('raceId') || hp.get('race_id') || '';
    }
    const n = Number(fromSearch || fromHash || '');
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function fallbackTargetForRaceId(currentRaceId) {
  return {
    raceId: currentRaceId,
    tournamentName:
      currentRaceId === DEFAULT_RACE_ID ? DEFAULT_TOURNAMENT_NAME : `${DEFAULT_TOURNAMENT_NAME}#${currentRaceId}`,
  };
}

async function resolveSyncTargets() {
  if (EXPLICIT_RACE_IDS.length > 0) {
    return Array.from(new Set(EXPLICIT_RACE_IDS)).map((currentRaceId) => fallbackTargetForRaceId(currentRaceId));
  }

  try {
    const { data, error } = await supabase
      .from('matchlife_data_sources')
      .select('name, url, enabled')
      .eq('enabled', true)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const targets = [];
    const seen = new Set();
    for (const row of data || []) {
      const currentRaceId = parseRaceIdFromSource(row?.url);
      if (!currentRaceId || seen.has(currentRaceId)) continue;
      seen.add(currentRaceId);
      targets.push({
        raceId: currentRaceId,
        tournamentName: String(row?.name || '').trim() || fallbackTargetForRaceId(currentRaceId).tournamentName,
      });
    }
    if (targets.length > 0) return targets;
  } catch {
    // Ignore source lookup failures and fall back to the default target.
  }

  return [fallbackTargetForRaceId(DEFAULT_RACE_ID)];
}

function toErrorMessage(err) {
  if (err instanceof Error) return err.stack || err.message;
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      // ignore
    }
  }
  return String(err);
}

function zonedHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: QUIET_HOURS_TIMEZONE,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value || 0);
}

function isInQuietHours(date = new Date()) {
  const hour = zonedHour(date);
  if (QUIET_HOURS_START_HOUR === QUIET_HOURS_END_HOUR) return false;
  if (QUIET_HOURS_START_HOUR < QUIET_HOURS_END_HOUR) {
    return hour >= QUIET_HOURS_START_HOUR && hour < QUIET_HOURS_END_HOUR;
  }
  return hour >= QUIET_HOURS_START_HOUR || hour < QUIET_HOURS_END_HOUR;
}

async function readDefaultRouteIface() {
  if (cachedDefaultIface) return cachedDefaultIface;
  try {
    const content = await readFile('/proc/net/route', 'utf8');
    const line = content
      .split('\n')
      .slice(1)
      .map((row) => row.trim())
      .find((row) => row && row.split(/\s+/)[1] === '00000000');
    const iface = line?.split(/\s+/)[0] || '';
    cachedDefaultIface = iface || null;
    return cachedDefaultIface;
  } catch {
    return null;
  }
}

async function readTxBytes(iface) {
  if (!iface) return null;
  try {
    const raw = await readFile(`/sys/class/net/${iface}/statistics/tx_bytes`, 'utf8');
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function readLinkCapacityMbps(iface) {
  if (cachedLinkCapacityMbps) return cachedLinkCapacityMbps;
  if (!iface) return null;
  try {
    const raw = await readFile(`/sys/class/net/${iface}/speed`, 'utf8');
    const value = Number(raw.trim());
    if (Number.isFinite(value) && value > 0) {
      cachedLinkCapacityMbps = value;
      return value;
    }
  } catch {
    // ignore
  }
  return null;
}

async function getBandwidthPressure() {
  const iface = await readDefaultRouteIface();
  if (!iface || NET_UTILIZATION_THRESHOLD <= 0) return null;

  const txBytes = await readTxBytes(iface);
  if (txBytes == null) return null;

  const capacityMbps = await readLinkCapacityMbps(iface);
  if (!capacityMbps || capacityMbps <= 0) {
    netSample = { ts: Date.now(), txBytes };
    return null;
  }

  const now = Date.now();
  if (!netSample) {
    netSample = { ts: now, txBytes };
    return null;
  }

  const elapsed = now - netSample.ts;
  const bytesDelta = Math.max(0, txBytes - netSample.txBytes);
  netSample = { ts: now, txBytes };
  if (elapsed < NET_SAMPLE_WINDOW_MS) return null;

  const txBytesPerSecond = bytesDelta / (elapsed / 1000);
  const capacityBytesPerSecond = (capacityMbps * 1_000_000) / 8;
  const utilization = capacityBytesPerSecond > 0 ? txBytesPerSecond / capacityBytesPerSecond : 0;

  return {
    iface,
    capacityMbps,
    txBytesPerSecond: Math.round(txBytesPerSecond),
    utilization: Number(utilization.toFixed(4)),
    threshold: NET_UTILIZATION_THRESHOLD,
    overloaded: utilization >= NET_UTILIZATION_THRESHOLD,
  };
}

async function writeHeartbeat(payload) {
  if (!HEARTBEAT_FILE) return;
  await mkdir(dirname(HEARTBEAT_FILE), { recursive: true });
  await writeFile(
    HEARTBEAT_FILE,
    `${JSON.stringify({ ...payload, ts: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

function elapsedMs(isoString) {
  if (!isoString) return 0;
  const value = Date.parse(isoString);
  if (Number.isNaN(value)) return 0;
  return Date.now() - value;
}

function createDefaultState() {
  return {
    paused: false,
    pauseReason: null,
    pausedAt: null,
    lastSuccessAt: null,
    lastActivityAt: null,
    idleStreakStartedAt: null,
    lastErrorAt: null,
    errorStreakStartedAt: null,
    consecutiveErrors: 0,
    lastResult: null,
  };
}

async function readRuntimeState() {
  if (!STATE_FILE) return createDefaultState();
  try {
    const content = await readFile(STATE_FILE, 'utf8');
    return {
      ...createDefaultState(),
      ...JSON.parse(content),
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return createDefaultState();
    }
    throw err;
  }
}

async function writeRuntimeState() {
  if (!STATE_FILE) return;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(runtimeState, null, 2)}\n`, 'utf8');
}

function stateSummary() {
  return {
    paused: Boolean(runtimeState.paused),
    pauseReason: runtimeState.pauseReason || null,
    pausedAt: runtimeState.pausedAt || null,
    lastSuccessAt: runtimeState.lastSuccessAt || null,
    lastActivityAt: runtimeState.lastActivityAt || null,
    idleStreakStartedAt: runtimeState.idleStreakStartedAt || null,
    lastErrorAt: runtimeState.lastErrorAt || null,
    errorStreakStartedAt: runtimeState.errorStreakStartedAt || null,
    consecutiveErrors: Number(runtimeState.consecutiveErrors || 0),
    lastResult: runtimeState.lastResult || null,
  };
}

async function pauseWatcher(reason, details = {}) {
  const pausedAt = new Date().toISOString();
  runtimeState = {
    ...runtimeState,
    paused: true,
    pauseReason: reason,
    pausedAt,
    lastResult: {
      ...(runtimeState.lastResult || {}),
      ...details,
      kind: 'paused',
      ts: pausedAt,
    },
  };
  await writeRuntimeState();
  const payload = {
    ok: true,
    kind: 'paused',
    paused: true,
    pauseReason: reason,
    pausedAt,
    ...details,
    state: stateSummary(),
  };
  await writeHeartbeat(payload);
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function emitPausedHeartbeat() {
  const payload = {
    ok: true,
    kind: 'paused',
    paused: true,
    pauseReason: runtimeState.pauseReason || 'manually_paused',
    pausedAt: runtimeState.pausedAt || null,
    state: stateSummary(),
  };
  await writeHeartbeat(payload);
}

async function emitDeferredHeartbeat(reason, details = {}) {
  const payload = {
    ok: true,
    kind: 'deferred',
    deferred: true,
    pauseReason: reason,
    ...details,
    state: stateSummary(),
  };
  await writeHeartbeat(payload);
}

function updateHotCourts(raceId, tournamentName, activeCourts) {
  const now = Date.now();
  const seen = new Set();
  for (const c of activeCourts || []) {
    const courtNo = Number(c?.courtNo);
    if (!courtNo) continue;
    const key = `${raceId}:${courtNo}`;
    seen.add(key);
    const prev = hotCourts.get(key);
    hotCourts.set(key, {
      raceId,
      tournamentName,
      courtNo,
      lastActiveAt: now,
      maxPage: Math.max(1, Math.min(Number(c?.maxPage || 1), ACTIVE_PAGES)),
      firstSeenAt: prev?.firstSeenAt || now,
    });
  }
  for (const [key, info] of hotCourts.entries()) {
    if (seen.has(key)) continue;
    if (now - Number(info?.lastActiveAt || 0) > ACTIVE_IDLE_MS) {
      hotCourts.delete(key);
    }
  }
}

async function runOnce({ kind, mode, targets: targetOverrides }) {
  const start = Date.now();
  const targets = targetOverrides && targetOverrides.length > 0 ? targetOverrides : await resolveSyncTargets();
  let pulled = 0;
  let validated = 0;
  let invalid = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let courts = 0;
  const activeCourts = [];
  const sourceResults = [];

  for (const target of targets) {
    const result = await syncOnce({
      supabase,
      raceId: target.raceId,
      tournamentName: target.tournamentName,
      mode,
      courtNos: target.courtNos,
      maxPages: target.maxPages,
      runKind: `${kind}_race_${target.raceId}`,
    });
    pulled += Number(result?.pulled || 0);
    validated += Number(result?.validated || 0);
    invalid += Number(result?.invalid || 0);
    inserted += Number(result?.inserted || 0);
    updated += Number(result?.updated || 0);
    skipped += Number(result?.skipped || 0);
    courts += Number(result?.courts || 0);
    updateHotCourts(target.raceId, target.tournamentName, result?.activeCourts);
    sourceResults.push({
      raceId: target.raceId,
      tournamentName: target.tournamentName,
      pulled: Number(result?.pulled || 0),
      inserted: Number(result?.inserted || 0),
      updated: Number(result?.updated || 0),
      skipped: Number(result?.skipped || 0),
    });
    for (const active of result?.activeCourts || []) {
      activeCourts.push({
        raceId: target.raceId,
        tournamentName: target.tournamentName,
        courtNo: Number(active?.courtNo || 0),
        maxPage: Number(active?.maxPage || 1),
      });
    }
  }

  const seconds = ((Date.now() - start) / 1000).toFixed(2);
  const summary = {
    ok: true,
    mode,
    pulled,
    validated,
    invalid,
    inserted,
    updated,
    skipped,
    courts,
    activeCourts,
    targetCount: targets.length,
    sourceResults,
    kind,
    seconds,
    ts: new Date().toISOString(),
    hotCourts: Array.from(hotCourts.values()).map((item) => ({
      raceId: item.raceId,
      tournamentName: item.tournamentName,
      courtNo: item.courtNo,
      maxPage: item.maxPage,
    })),
  };
  return summary;
}

async function handleSuccess(summary) {
  const changedRows = Number(summary.inserted || 0) + Number(summary.updated || 0);
  const activeCourtsCount = Array.isArray(summary.activeCourts) ? summary.activeCourts.length : 0;
  const hasActivity = changedRows > 0 || activeCourtsCount > 0;

  runtimeState = {
    ...runtimeState,
    paused: false,
    pauseReason: null,
    pausedAt: null,
    lastSuccessAt: summary.ts,
    lastErrorAt: runtimeState.lastErrorAt || null,
    errorStreakStartedAt: null,
    consecutiveErrors: 0,
    idleStreakStartedAt: hasActivity ? null : runtimeState.idleStreakStartedAt || summary.ts,
    lastActivityAt: hasActivity ? summary.ts : runtimeState.lastActivityAt || null,
    lastResult: {
      kind: summary.kind,
      ts: summary.ts,
      inserted: Number(summary.inserted || 0),
      updated: Number(summary.updated || 0),
      skipped: Number(summary.skipped || 0),
      activeCourts: activeCourtsCount,
      mode: summary.mode,
    },
  };

  if (!hasActivity && AUTO_PAUSE_IDLE_MS > 0 && elapsedMs(runtimeState.idleStreakStartedAt) >= AUTO_PAUSE_IDLE_MS) {
    return pauseWatcher('idle_over_24h', {
      idleHours: Number((elapsedMs(runtimeState.idleStreakStartedAt) / 3_600_000).toFixed(2)),
      lastObservedKind: summary.kind,
      lastObservedAt: summary.ts,
    });
  }

  await writeRuntimeState();
  const payload = {
    ...summary,
    paused: false,
    state: stateSummary(),
  };
  await writeHeartbeat(payload);
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

async function handleError(kind, err) {
  const ts = new Date().toISOString();
  runtimeState = {
    ...runtimeState,
    lastErrorAt: ts,
    errorStreakStartedAt: runtimeState.errorStreakStartedAt || ts,
    consecutiveErrors: Number(runtimeState.consecutiveErrors || 0) + 1,
    lastResult: {
      kind,
      ts,
      error: toErrorMessage(err),
    },
  };

  if (AUTO_PAUSE_ERROR_MS > 0 && elapsedMs(runtimeState.errorStreakStartedAt) >= AUTO_PAUSE_ERROR_MS) {
    return pauseWatcher('error_over_24h', {
      errorHours: Number((elapsedMs(runtimeState.errorStreakStartedAt) / 3_600_000).toFixed(2)),
      lastObservedKind: kind,
      lastObservedAt: ts,
      lastError: toErrorMessage(err),
    });
  }

  await writeRuntimeState();
  const payload = {
    ok: false,
    kind,
    error: toErrorMessage(err),
    paused: false,
    state: stateSummary(),
  };
  await writeHeartbeat(payload);
  console.error(err);
  return payload;
}

function currentIdleIntervalMs() {
  const idleSince = runtimeState.idleStreakStartedAt || runtimeState.lastActivityAt;
  const idleMs = elapsedMs(idleSince);
  if (idleMs >= IDLE_COOL_AFTER_MS) return IDLE_COOL_INTERVAL_MS;
  if (idleMs >= IDLE_WARM_AFTER_MS) return IDLE_WARM_INTERVAL_MS;
  return IDLE_FAST_INTERVAL_MS;
}

function currentErrorBackoffMs() {
  const streak = Math.max(1, Number(runtimeState.consecutiveErrors || 1));
  const multiplier = 2 ** Math.min(streak - 1, 5);
  return Math.min(ERROR_BACKOFF_MAX_MS, ERROR_BACKOFF_BASE_MS * multiplier);
}

async function loop() {
  let nextDiscoveryAt = 0;
  let nextIdleFastAt = 0;
  let nextErrorRetryAt = 0;
  while (!stopping) {
    if (runtimeState.paused) {
      await emitPausedHeartbeat();
      await sleep(PAUSED_HEARTBEAT_INTERVAL_MS);
      continue;
    }

    if (isInQuietHours()) {
      await emitDeferredHeartbeat('quiet_hours', {
        quietWindow: {
          timezone: QUIET_HOURS_TIMEZONE,
          startHour: QUIET_HOURS_START_HOUR,
          endHour: QUIET_HOURS_END_HOUR,
        },
      });
      await sleep(QUIET_HEARTBEAT_INTERVAL_MS);
      continue;
    }

    const bandwidth = await getBandwidthPressure();
    if (bandwidth?.overloaded) {
      await emitDeferredHeartbeat('egress_over_threshold', { bandwidth });
      await sleep(NET_DEFER_INTERVAL_MS);
      continue;
    }

    const now = Date.now();
    if (now < nextErrorRetryAt) {
      await emitDeferredHeartbeat('error_backoff', {
        retryAfterMs: Math.max(0, nextErrorRetryAt - now),
        consecutiveErrors: Number(runtimeState.consecutiveErrors || 0),
      });
      await sleep(Math.min(1000, Math.max(0, nextErrorRetryAt - now)));
      continue;
    }

    if (now >= nextDiscoveryAt) {
      try {
        const summary = await runOnce({ kind: 'discovery', mode: 'fast', maxPages: 1 });
        await handleSuccess(summary);
        nextErrorRetryAt = 0;
      } catch (err) {
        await handleError('discovery', err);
        nextErrorRetryAt = Date.now() + currentErrorBackoffMs();
      }
      nextDiscoveryAt = Date.now() + DISCOVERY_INTERVAL_MS;
    }

    if (hotCourts.size > 0) {
      const groupedTargets = Array.from(hotCourts.values()).reduce((acc, item) => {
        const key = String(item.raceId);
        if (!acc.has(key)) {
          acc.set(key, {
            raceId: item.raceId,
            tournamentName: item.tournamentName || fallbackTargetForRaceId(item.raceId).tournamentName,
            courtNos: [],
            maxPages: 1,
          });
        }
        const target = acc.get(key);
        if (!target) return acc;
        target.courtNos.push(item.courtNo);
        target.maxPages = Math.max(target.maxPages, Number(item.maxPage || 1));
        return acc;
      }, new Map());
      const targets = Array.from(groupedTargets.values()).map((target) => ({
        ...target,
        courtNos: Array.from(new Set(target.courtNos)).sort((a, b) => a - b),
      }));
      try {
        const summary = await runOnce({ kind: 'active', mode: 'full', targets });
        await handleSuccess(summary);
        nextErrorRetryAt = 0;
      } catch (err) {
        await handleError('active', err);
        nextErrorRetryAt = Date.now() + currentErrorBackoffMs();
      }
      await sleep(ACTIVE_INTERVAL_MS);
      continue;
    }

    if (now >= nextIdleFastAt) {
      try {
        const summary = await runOnce({ kind: 'idle_fast', mode: 'fast', maxPages: 1 });
        await handleSuccess(summary);
        nextErrorRetryAt = 0;
      } catch (err) {
        await handleError('idle_fast', err);
        nextErrorRetryAt = Date.now() + currentErrorBackoffMs();
      }
      nextIdleFastAt = Date.now() + currentIdleIntervalMs();
    }

    await sleep(Math.min(1000, currentIdleIntervalMs()));
  }
}

process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

await loop();
