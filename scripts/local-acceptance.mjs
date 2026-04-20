import fs from 'node:fs';
import { chromium } from 'playwright';

function parseEnvFile(filePath) {
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
  };
}

async function main() {
  const env = parseEnvFile('.env.local');
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('缺少 VITE_SUPABASE_ANON_KEY');

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'content-type': 'application/json',
  };

  const baseUrl = process.env.ACCEPT_BASE_URL || 'http://127.0.0.1:5173';

  const beforeVisitRes = await fetch(
    `${baseUrl}/supabase/rest/v1/page_visit_requests?select=id&order=id.desc&limit=1`,
    { headers },
  );
  const beforeVisitRows = await beforeVisitRes.json();
  const beforeVisitId = Number(beforeVisitRows?.[0]?.id || 0);

  const syncTrigger = await fetch(`${baseUrl}/api/sync?mode=fast`, {
    method: 'POST',
  });
  if (!syncTrigger.ok) {
    const text = await syncTrigger.text();
    throw new Error(`触发同步失败: ${syncTrigger.status} ${text}`);
  }

  await new Promise((r) => setTimeout(r, 1000));
  const latestRunRes = await fetch(
    `${baseUrl}/supabase/rest/v1/sync_runs?select=id,upserted_count,error_message&order=run_at.desc&limit=1`,
    { headers },
  );
  const latestRunRows = await latestRunRes.json();
  const latestRun = latestRunRows?.[0];
  if (!latestRun) throw new Error('未查询到同步记录');
  const parts = parseSyncMeta(latestRun.error_message);
  const expectedUpserted = parts.inserted + parts.updated + parts.skipped;
  const upsertedAccurate = Number(latestRun.upserted_count) === expectedUpserted;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.goto(`${baseUrl}/stats`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const selectedChip = page.locator('button[aria-pressed="true"]').first();
  const selectedClass = (await selectedChip.getAttribute('class')) || '';
  const hasSelectedStyle = selectedClass.includes('ring-2');

  const loadBtn = page.getByRole('button', { name: /加载统计|加载中/ });
  await loadBtn.click();
  await page.waitForTimeout(800);
  const stillHasHeader = (await page.getByText('赛事概览看板').count()) > 0;
  const hasLocalLoading = (await page.getByText('加载中...').count()) > 0
    || (await page.getByText('正在更新下方统计表...').count()) > 0
    || (await page.getByText('正在生成看板数据...').count()) > 0;

  await page.goto(`${baseUrl}/sync`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const hasSyncRows = (await page.locator('table tbody tr').count()) > 0;

  await browser.close();

  const afterVisitRes = await fetch(
    `${baseUrl}/supabase/rest/v1/page_visit_requests?select=id&order=id.desc&limit=1`,
    { headers },
  );
  const afterVisitRows = await afterVisitRes.json();
  const afterVisitId = Number(afterVisitRows?.[0]?.id || 0);
  const visitRequestsLogged = afterVisitId > beforeVisitId;

  const visitStatsRes = await fetch(
    `${baseUrl}/supabase/rpc/get_page_visit_stats`,
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
    visitRequestsLogged,
    visitStatsOk,
    selectedStyleOk: hasSelectedStyle,
    statsLocalLoadingOk: stillHasHeader && hasLocalLoading,
    syncTableVisible: hasSyncRows,
    consoleErrorCount: consoleErrors.length,
    consoleErrorSamples: consoleErrors.slice(0, 3),
  };

  console.log(JSON.stringify(result, null, 2));

  const failed = Object.entries({
    syncUpsertedAccurate: result.syncUpsertedAccurate,
    visitRequestsLogged: result.visitRequestsLogged,
    visitStatsOk: result.visitStatsOk,
    selectedStyleOk: result.selectedStyleOk,
    statsLocalLoadingOk: result.statsLocalLoadingOk,
    syncTableVisible: result.syncTableVisible,
  }).filter(([, v]) => !v);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
