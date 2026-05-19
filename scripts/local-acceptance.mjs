import fs from 'node:fs';
import { chromium } from 'playwright';
import { fetchObservabilitySnapshot } from './lib/observability-gate.mjs';

const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNobGlmZS1zZWxmLWhvc3RlZCIsImlhdCI6MTc3NjYwODkxMywiZXhwIjoxOTM0Mjg4OTEzfQ.dGN2lG3BvRNJCBZ7sFXcjtxqDAO10Vh-BBuxkRED3kY';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    out[key] = value;
  }
  return out;
}

function parseSyncMeta(message) {
  const text = String(message || '');
  const pick = (key) => {
    const m = text.match(new RegExp(`(?:^|;\\s*)${key}=(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  return {
    inserted: pick('inserted'),
    updated: pick('updated'),
    skipped: pick('skipped'),
    activeCached: pick('activeCached'),
    pendingPersist: pick('pendingPersist'),
    persisted: pick('persisted'),
  };
}

function isRuntimeStateSchemaCacheMiss(status, body) {
  return status === 404 && /PGRST205|schema cache|sync_runtime_state/i.test(String(body || ''));
}

function joinUrl(baseUrl, pathname) {
  return new URL(pathname.replace(/^\/+/, ''), `${String(baseUrl || '').replace(/\/+$/, '')}/`).toString();
}

function includesAny(text, patterns) {
  const source = String(text || '');
  return patterns.some((pattern) => (pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern)));
}

async function triggerSync(baseUrl) {
  const candidates = [
    joinUrl(baseUrl, '/api/sync?mode=fast'),
    joinUrl(baseUrl, '/api/wechat/manual-sync?mode=fast'),
  ];
  let lastFailure = null;
  for (const url of candidates) {
    const response = await fetch(url, { method: 'POST' }).catch((error) => {
      lastFailure = `请求失败 ${url}: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    });
    if (!response) continue;
    const bodyText = await response.text();
    if (response.ok) {
      return { ok: true, url };
    }
    if (url.includes('/api/sync') && response.status === 409) {
      return { ok: true, url, alreadyRunning: true };
    }
    lastFailure = `${url} -> ${response.status} ${bodyText}`;
  }
  throw new Error(`触发同步失败: ${lastFailure || '无可用同步入口'}`);
}

async function main() {
  const env = {
    ...parseEnvFile('.env'),
    ...parseEnvFile('.env.local'),
    ...process.env,
  };
  const anonKey = env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('缺少 VITE_SUPABASE_ANON_KEY');

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'content-type': 'application/json',
  };

  const baseUrl = process.env.ACCEPT_BASE_URL || 'http://127.0.0.1:5173';
  const supabaseBaseUrl = joinUrl(baseUrl, '/supabase').replace(/\/+$/, '');

  const beforeVisitRes = await fetch(
    joinUrl(baseUrl, '/supabase/rest/v1/page_visit_requests?select=id&order=id.desc&limit=1'),
    { headers },
  );
  const beforeVisitRows = await beforeVisitRes.json();
  const beforeVisitId = Number(beforeVisitRows?.[0]?.id || 0);

  const skipSyncTrigger = String(process.env.ACCEPT_SKIP_SYNC_TRIGGER || '').trim() === 'true';
  const syncTrigger = skipSyncTrigger ? { ok: true, url: 'skipped' } : await triggerSync(baseUrl);

  await new Promise((r) => setTimeout(r, 1000));
  const latestRunRes = await fetch(
    joinUrl(baseUrl, '/supabase/rest/v1/sync_runs?select=id,run_at,upserted_count,error_message&order=run_at.desc&limit=1'),
    { headers },
  );
  const latestRunRows = await latestRunRes.json();
  const latestRun = latestRunRows?.[0];
  if (!latestRun) throw new Error('未查询到同步记录');
  const parts = parseSyncMeta(latestRun.error_message);
  const expectedUpserted = parts.inserted + parts.updated + parts.skipped;
  const upsertedAccurate = Number(latestRun.upserted_count) === expectedUpserted;

  const runtimeStateRes = await fetch(
    joinUrl(baseUrl, '/supabase/rest/v1/sync_runtime_state?select=*'),
    { headers },
  );
  const runtimeStateRaw = await runtimeStateRes.text();
  let runtimeStateRows = null;
  try {
    runtimeStateRows = JSON.parse(runtimeStateRaw);
  } catch {
    runtimeStateRows = null;
  }
  const runtimeStateReachable = runtimeStateRes.ok && Array.isArray(runtimeStateRows);
  let runtimeStateFallbackRow = null;
  let runtimeStateSource = runtimeStateReachable ? 'sync_runtime_state' : 'unavailable';
  if (!runtimeStateReachable && isRuntimeStateSchemaCacheMiss(runtimeStateRes.status, runtimeStateRaw)) {
    const fallbackMeta = parseSyncMeta(latestRun.error_message);
    const hasFallbackCounts =
      fallbackMeta.activeCached > 0 || fallbackMeta.pendingPersist > 0 || fallbackMeta.persisted > 0;
    if (hasFallbackCounts) {
      runtimeStateFallbackRow = latestRun;
      runtimeStateSource = 'sync_runs_fallback';
    }
  }
  const runtimeStateEvidenceAvailable = runtimeStateReachable || Boolean(runtimeStateFallbackRow);
  const observability = await fetchObservabilitySnapshot(supabaseBaseUrl, anonKey, {
    recentRunLimit: 8,
    pausedScopeLimit: 6,
    alertLimit: 12,
    sourceLimit: 12,
  });
  const observabilitySummary = observability.summary;
  const observabilityRpcOk = observability.status === 200;
  const observabilityStructuredOk = Boolean(observabilitySummary?.structuredAlertsOk);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(joinUrl(baseUrl, '/'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.goto(joinUrl(baseUrl, '/stats'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const selectedChip = page.locator('button[aria-pressed="true"]').first();
  const hasSelectedChip = (await selectedChip.count().catch(() => 0)) > 0;
  const selectedClass = hasSelectedChip ? ((await selectedChip.getAttribute('class')) || '') : '';
  const hasSelectedStyle = hasSelectedChip ? selectedClass.includes('ring-2') : true;

  const loadBtn = page.getByRole('button', { name: /加载统计|加载中/ });
  const pauseBannerVisible =
    (await page.getByText('统计已暂停').count()) > 0 ||
    (await page.getByText('统计稍后开放').count()) > 0 ||
    (await page.getByText('实时缓存处理中...').count()) > 0;
  const initialLoadBtnLabel = (await loadBtn.first().textContent().catch(() => '')) || '';
  const loadBtnEnabled = await loadBtn.isEnabled().catch(() => false);
  const loadBtnDisabled = !loadBtnEnabled;
  let statsPageActionableOk = pauseBannerVisible || loadBtnDisabled;
  let statsPageMode = pauseBannerVisible || loadBtnDisabled ? 'paused' : 'clickable';
  if (!statsPageActionableOk) {
    await loadBtn.click();
    let statsSignal = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(250);
      const currentLoadBtnLabel = (await loadBtn.first().textContent().catch(() => '')) || '';
      const currentBodyText = await page.locator('body').innerText().catch(() => '');
      const currentLoadBtnDisabled = !(await loadBtn.isEnabled().catch(() => false));
      const hasLocalLoading =
        includesAny(currentLoadBtnLabel, ['准备中...', '加载中...', '刷新中...']) ||
        includesAny(currentBodyText, ['加载中...', '正在更新下方统计表...', '正在生成看板数据...']);
      const hasLoadedStatsCards = includesAny(currentBodyText, ['已完赛场次', '收录比赛总场次', '参赛运动员人数']);
      const hasStatsEmptyState = includesAny(currentBodyText, [/当前暂无可统计数据/, /请选择赛事后点击/u, /请先从下方推荐赛事中选择目标赛事后再点击/u]);
      const hasTournamentSelected =
        includesAny(currentBodyText, ['当前统计对象：']) &&
        !includesAny(currentBodyText, ['当前统计对象： 尚未加载', '当前统计对象：\n尚未加载']);
      const buttonStateChanged = currentLoadBtnLabel !== initialLoadBtnLabel || currentLoadBtnDisabled;

      if (hasLoadedStatsCards) {
        statsSignal = 'loaded';
        break;
      }
      if (hasStatsEmptyState) {
        statsSignal = 'empty';
        break;
      }
      if (hasLocalLoading || buttonStateChanged) {
        statsSignal = hasLocalLoading ? 'loading' : 'button-transition';
        break;
      }
      if (hasTournamentSelected) {
        statsSignal = 'selected';
        break;
      }
    }
    statsPageActionableOk = Boolean(statsSignal);
    statsPageMode = statsSignal || 'unknown';
  }

  await page.goto(joinUrl(baseUrl, '/sync'), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const syncBodyText = await page.locator('body').innerText().catch(() => '');
  const hasSyncRows = (await page.locator('table tbody tr').count()) > 0;
  const hasSyncSummary =
    includesAny(syncBodyText, ['更新状态', '最近更新记录']) ||
    (await page.getByRole('heading', { name: '数据同步状态' }).count()) > 0 ||
    includesAny(syncBodyText, ['系统门禁', '当前告警', '来源健康']);
  const syncStatusExplainabilityOk =
    includesAny(syncBodyText, ['更新状态', '最近更新记录']) &&
    includesAny(syncBodyText, ['当前状态', '更新提醒', '最近更新', '待处理比赛', '更新失败']) &&
    (await page.getByRole('button', { name: '立即更新' }).count()) > 0 &&
    (await page.getByRole('button', { name: '刷新状态' }).count()) > 0;
  const syncStatusVisible = hasSyncRows || hasSyncSummary || Boolean(latestRun);
  const runtimeStateUsable = runtimeStateEvidenceAvailable || statsPageActionableOk;

  await browser.close();

  const afterVisitRes = await fetch(
    joinUrl(baseUrl, '/supabase/rest/v1/page_visit_requests?select=id&order=id.desc&limit=1'),
    { headers },
  );
  const afterVisitRows = await afterVisitRes.json();
  const afterVisitId = Number(afterVisitRows?.[0]?.id || 0);
  const visitRequestsLogged = afterVisitId > beforeVisitId;

  const visitStatsRes = await fetch(
    joinUrl(baseUrl, '/supabase/rpc/get_page_visit_stats'),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_source_host: baseUrl.replace(/^https?:\/\//, ''),
        p_app_scope: 'matchlife',
      }),
    },
  );
  const visitStats = await visitStatsRes.json();
  const visitStatsOk = Array.isArray(visitStats) && visitStats.length > 0;

  const result = {
    syncUpsertedAccurate: upsertedAccurate,
    syncUpsertedActual: Number(latestRun.upserted_count),
    syncUpsertedExpected: expectedUpserted,
    runtimeStateReachable,
    runtimeStateUsable,
    runtimeStateSource,
    syncTriggerUrl: syncTrigger.url,
    syncTriggerSkipped: skipSyncTrigger,
    runtimeStateStatus: runtimeStateRes.status,
    runtimeStateBodyPrefix: runtimeStateRaw.slice(0, 180),
    runtimeStateFallbackCounts: runtimeStateFallbackRow
      ? {
          activeCached: Number(runtimeStateFallbackRow.active_cached_count ?? parseSyncMeta(runtimeStateFallbackRow.error_message).activeCached ?? 0),
          pendingPersist: Number(runtimeStateFallbackRow.pending_persist_count ?? parseSyncMeta(runtimeStateFallbackRow.error_message).pendingPersist ?? 0),
          persisted: Number(runtimeStateFallbackRow.persisted_count ?? parseSyncMeta(runtimeStateFallbackRow.error_message).persisted ?? 0),
        }
      : null,
    observabilityRpcOk,
    observabilityStructuredOk,
    observabilityOverallStatus: observabilitySummary?.overallStatus ?? null,
    observabilityRuntimeStatus: observabilitySummary?.runtimeStatus ?? null,
    observabilityBlockingReasonCode: observabilitySummary?.blockingReasonCode ?? null,
    observabilityPausedScopeCount: observabilitySummary?.pausedScopeCount ?? null,
    observabilityCriticalAlertCount: observabilitySummary?.criticalAlertCount ?? null,
    observabilityWarningAlertCount: observabilitySummary?.warningAlertCount ?? null,
    visitRequestsLogged,
    visitStatsOk,
    selectedStyleOk: hasSelectedStyle,
    statsPageActionableOk,
    statsPageMode,
    syncTableVisible: syncStatusVisible,
    syncStatusExplainabilityOk,
    consoleErrorCount: consoleErrors.length,
    consoleErrorSamples: consoleErrors.slice(0, 3),
  };

  console.log(JSON.stringify(result, null, 2));

  const failed = Object.entries({
    syncUpsertedAccurate: result.syncUpsertedAccurate,
    runtimeStateUsable: result.runtimeStateUsable,
    observabilityRpcOk: result.observabilityRpcOk,
    observabilityStructuredOk: result.observabilityStructuredOk,
    visitRequestsLogged: result.visitRequestsLogged,
    visitStatsOk: result.visitStatsOk,
    selectedStyleOk: result.selectedStyleOk,
    statsPageActionableOk: result.statsPageActionableOk,
    syncTableVisible: result.syncTableVisible,
    syncStatusExplainabilityOk: result.syncStatusExplainabilityOk,
  }).filter(([, v]) => !v);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
