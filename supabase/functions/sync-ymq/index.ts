import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.0";

type Court = {
  raceId: number;
  id: number;
  courtName: string;
  num: number;
};

type MatchRow = Record<string, unknown> & {
  id: number;
  raceId: number;
  courtNum?: number;
  courtName?: string;
  raceTimeNum?: number;
  raceTimeName?: string;
  raceTimestamp?: number;
  groupName?: string;
  playerOnes?: Array<{ name?: string }>;
  playerTwos?: Array<{ name?: string }>;
  gameScores?: Array<{ scoreOne?: number; scoreTwo?: number }>;
  battleScoreOne?: number;
  battleScoreTwo?: number;
  scoreStatusNo?: number;
  scoreEndTime?: number;
  scoreStartTime?: number;
};

type PostgrestResult<T> = { data: T | null; error: unknown };

type PostgrestQuery<T> = {
  select: (cols: string) => PostgrestQuery<T>;
  insert: (values: Record<string, unknown> | Array<Record<string, unknown>>) => Promise<PostgrestResult<T>>;
  delete: () => PostgrestQuery<T>;
  eq: (col: string, val: unknown) => PostgrestQuery<T>;
  not: (col: string, op: string, val: string) => PostgrestQuery<T>;
  order: (col: string, opts: { ascending: boolean }) => PostgrestQuery<T>;
  limit: (n: number) => PostgrestQuery<T> & PromiseLike<PostgrestResult<T>>;
} & PromiseLike<PostgrestResult<T>>;

type SupabaseAdmin = {
  from: (table: string) => PostgrestQuery<unknown>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<PostgrestResult<unknown>>;
};

function getEnv(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL") || getEnv("PROJECT_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing env: SUPABASE_URL / PROJECT_URL");
  if (!serviceRoleKey) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey);
}

const YMQ_COURTS_URL = "https://race.ymq.me/webservice/appWxRace/courts.do";
const YMQ_MATCHES_URL = "https://race.ymq.me/webservice/appWxMatch/matchesScore.do";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha1(text: string) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return toHex(digest);
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(`${url}?t=${Date.now()}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YMQ request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function computeWinner(row: MatchRow): "A" | "B" | "UNKNOWN" {
  if (row.scoreStatusNo !== 2) return "UNKNOWN";
  const scoreOne = Number(row.scoreOne ?? NaN);
  const scoreTwo = Number(row.scoreTwo ?? NaN);
  if (Number.isFinite(scoreOne) && Number.isFinite(scoreTwo) && scoreOne !== scoreTwo) {
    return scoreOne > scoreTwo ? "A" : "B";
  }
  if (Array.isArray(row.gameScores) && row.gameScores.length > 0) {
    let setsA = 0;
    let setsB = 0;
    for (const set of row.gameScores) {
      const a = Number(set?.scoreOne ?? NaN);
      const b = Number(set?.scoreTwo ?? NaN);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
      if (a > b) setsA += 1;
      if (b > a) setsB += 1;
    }
    if (setsA > setsB) return "A";
    if (setsB > setsA) return "B";
  }
  const a = Number(row.battleScoreOne ?? 0);
  const b = Number(row.battleScoreTwo ?? 0);
  if (a > b) return "A";
  if (b > a) return "B";
  return "UNKNOWN";
}

function formatScore(row: MatchRow): string | null {
  if (Array.isArray(row.gameScores) && row.gameScores.length > 0) {
    const parts = row.gameScores
      .map((g) => `${g.scoreOne ?? 0}-${g.scoreTwo ?? 0}`)
      .join(", ");
    return parts || null;
  }
  const a = row.battleScoreOne;
  const b = row.battleScoreTwo;
  if (typeof a === "number" || typeof b === "number") {
    return `${a ?? 0}-${b ?? 0}`;
  }
  return null;
}

function parseRoundName(row: MatchRow): string | null {
  const rulesName = String(row['rulesName'] ?? '').trim();
  if (rulesName) return rulesName;

  const fullName = String(row['fullName'] ?? '').trim();
  const m = fullName.match(/(\d{1,3}\s*进\s*\d{1,3})/);
  if (m && m[1]) return m[1].replace(/\s+/g, '');
  if (fullName.includes('半决赛')) return '半决赛';
  if (fullName.includes('决赛')) return '决赛';
  return null;
}

function names(list?: Array<{ name?: string }>): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((p) => (p?.name || "").trim()).filter(Boolean);
}

function parseEventKey(row: MatchRow): { ageYears: number | null; itemName: string | null; eventKey: string | null } {
  const fullName = String(row['fullName'] ?? '').trim();
  const itemNameRaw = String(row['itemName'] ?? '').trim();
  const ageMatch = fullName.match(/(\d{1,2})\s*岁/);
  const ageYears = ageMatch ? Number(ageMatch[1]) : null;

  let item = itemNameRaw;
  if (!item) {
    const m = fullName.match(/\d{1,2}\s*岁\s*([^\s\x5B]+)/);
    if (m && m[1]) item = m[1].trim();
  }

  let normalizedItem = item || null;
  if (ageYears && normalizedItem) {
    normalizedItem = normalizedItem.replace(new RegExp(`^${ageYears}\\s*岁`), '').trim();
  }

  const eventKey = ageYears && normalizedItem ? `${ageYears}岁${normalizedItem}` : normalizedItem || null;
  return { ageYears, itemName: item || null, eventKey };
}

function hasLiveScore(row: MatchRow): boolean {
  if (typeof row.battleScoreOne === "number" || typeof row.battleScoreTwo === "number") {
    return Number(row.battleScoreOne ?? 0) > 0 || Number(row.battleScoreTwo ?? 0) > 0;
  }
  if (!Array.isArray(row.gameScores)) return false;
  return row.gameScores.some((set) => Number(set?.scoreOne ?? 0) > 0 || Number(set?.scoreTwo ?? 0) > 0);
}

function isFinishedMatch(row: MatchRow): boolean {
  return row.scoreStatusNo === 2 || typeof row.scoreEndTime === "number" || computeWinner(row) !== "UNKNOWN";
}

function isActiveLiveMatch(row: MatchRow): boolean {
  if (isFinishedMatch(row)) return false;
  return typeof row.scoreStartTime === "number" || hasLiveScore(row) || [1, 3, 4, 5].includes(Number(row.scoreStatusNo ?? 0));
}

function chunkArray<T>(list: T[], size: number): T[][] {
  if (!Array.isArray(list) || list.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

async function listPriorityCourtNos(supabase: SupabaseAdmin, raceId: number): Promise<number[]> {
  try {
    const { data, error } = await supabase
      .from("active_match_cache")
      .select("court_num, cache_status, last_seen_at")
      .eq("source", "ymq")
      .eq("source_race_id", raceId)
      .order("last_seen_at", { ascending: false })
      .limit(48);
    if (error) return [];
    return Array.from(
      new Set(
        (Array.isArray(data) ? data : [])
          .map((row) => row as Record<string, unknown>)
          .filter((row) => row.cache_status === "ACTIVE" || row.cache_status === "READY_TO_PERSIST")
          .map((row) => Number(row.court_num))
          .filter((courtNo) => Number.isFinite(courtNo) && courtNo > 0),
      ),
    ).slice(0, 12);
  } catch {
    return [];
  }
}

async function fetchSyncRuntimeState(supabase: SupabaseAdmin): Promise<{
  activeCachedCount: number;
  pendingPersistCount: number;
  persistedCount: number;
}> {
  try {
    const { data, error } = await supabase.from("sync_runtime_state").select("*").limit(1);
    if (error) {
      return { activeCachedCount: 0, pendingPersistCount: 0, persistedCount: 0 };
    }
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    return {
      activeCachedCount: Number(row?.active_cached_count ?? 0),
      pendingPersistCount: Number(row?.pending_persist_count ?? 0),
      persistedCount: Number(row?.persisted_count ?? 0),
    };
  } catch {
    return { activeCachedCount: 0, pendingPersistCount: 0, persistedCount: 0 };
  }
}

async function cleanupSyncRuns(supabase: unknown, source: string) {
  type SyncRunIdRow = { id: number } | { id: string };
  const sb = supabase as SupabaseAdmin;

  const { data: keepRowsAny, error: keepErr } = await sb
    .from("sync_runs")
    .select("id")
    .eq("source", source)
    .order("run_at", { ascending: false })
    .limit(5);
  if (keepErr) throw keepErr;

  const keepRows = Array.isArray(keepRowsAny) ? (keepRowsAny as SyncRunIdRow[]) : [];
  const keepIds = keepRows
    .map((r: SyncRunIdRow) => ('id' in r ? r.id : null))
    .filter((v: SyncRunIdRow['id'] | null): v is SyncRunIdRow['id'] => v !== null);
  if (keepIds.length === 0) return;

  const inList = `(${keepIds.join(',')})`;
  const { error: delErr } = await sb
    .from("sync_runs")
    .delete()
    .eq("source", source)
    .not("id", "in", inList);
  if (delErr) throw delErr;
}

async function listCourts(raceId: number): Promise<Court[]> {
  const res = await postJson<{ status: number; detail?: Court[] }>(
    YMQ_COURTS_URL,
    { body: { raceId }, header: {} },
  );
  return Array.isArray(res.detail) ? res.detail : [];
}

async function fetchMatchesPage(args: {
  raceId: number;
  courtNo: number;
  page: number;
  rows: number;
}): Promise<{ rows: MatchRow[]; total: number }> {
  const res = await postJson<{
    status: number;
    detail?: { rows?: MatchRow[]; total?: number };
  }>(YMQ_MATCHES_URL, {
    body: {
      raceId: args.raceId,
      courtNo: args.courtNo,
      page: args.page,
      rows: args.rows,
    },
    header: {},
  });

  const rows = Array.isArray(res.detail?.rows) ? res.detail?.rows ?? [] : [];
  const total = Number(res.detail?.total ?? rows.length);
  return { rows, total };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders(),
    });
  }

  try {
    const supabase = getSupabaseAdmin() as SupabaseAdmin;
    const url = new URL(req.url);
    let body: unknown = null;
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = null;
      }
    }

    const bodyObj = (typeof body === 'object' && body !== null) ? (body as Record<string, unknown>) : {};
    const raceId = Number(bodyObj.raceId || url.searchParams.get("raceId") || 38653);
    const tournamentName =
      String(bodyObj.tournamentName || url.searchParams.get("tournamentName") ||
      "2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛");
    const mode = String(bodyObj.mode || url.searchParams.get("mode") || "full") as "full" | "fast";

    const courts = await listCourts(raceId);
    if (courts.length === 0) {
      throw new Error("No courts returned from ymq");
    }

    const allRows: MatchRow[] = [];
    const activeByCourt = new Map<number, number>();
    const rowsPerPage = 200;
    const maxPages = mode === "fast" ? 1 : 200;
    const prioritizedCourtNos = mode === "fast" ? await listPriorityCourtNos(supabase, raceId) : [];
    const targetCourts = prioritizedCourtNos.length > 0
      ? courts.filter((court) => prioritizedCourtNos.includes(court.num))
      : courts;

    for (const court of targetCourts) {
      let page = 1;
      let fetched = 0;
      let total = 0;
      while (true) {
        const res = await fetchMatchesPage({
          raceId,
          courtNo: court.num,
          page,
          rows: rowsPerPage,
        });
        total = res.total;
        allRows.push(...res.rows);
        fetched += res.rows.length;
        if (fetched >= total || res.rows.length === 0) break;
        page += 1;
        if (page > maxPages) break;
      }
    }

    const unique = new Map<number, MatchRow>();
    for (const r of allRows) unique.set(r.id, r);
    const uniqueRows = Array.from(unique.values());

    const pulledCount = uniqueRows.length;
    const records: Record<string, unknown>[] = [];
    let invalidCount = 0;

    for (const row of uniqueRows) {
      const playersA = names(row.playerOnes);
      const playersB = names(row.playerTwos);
      if (!row.groupName || !row.courtName || (playersA.length === 0 && playersB.length === 0)) {
        invalidCount += 1;
        continue;
      }

      const playersText = [...playersA, ...playersB].join(" ").trim() || null;
      const winner = computeWinner(row);
      const scoreText = formatScore(row);

      const startTime =
        typeof row.raceTimestamp === "number"
          ? new Date(row.raceTimestamp).toISOString()
          : null;

      const matchStartedAt =
        typeof row.scoreStartTime === "number"
          ? new Date(row.scoreStartTime).toISOString()
          : null;

      const matchEndedAt =
        typeof row.scoreEndTime === "number"
          ? new Date(row.scoreEndTime).toISOString()
          : null;

      const sourceUpdatedAt =
        typeof row.scoreEndTime === "number"
          ? new Date(row.scoreEndTime).toISOString()
          : typeof row.scoreStartTime === "number"
            ? new Date(row.scoreStartTime).toISOString()
            : new Date().toISOString();

      const rawHash = await sha1(JSON.stringify(row));

      const { ageYears, itemName, eventKey } = parseEventKey(row);
      const roundName = parseRoundName(row);
      if (isActiveLiveMatch(row) && Number.isFinite(Number(row.courtNum)) && Number(row.courtNum) > 0) {
        activeByCourt.set(Number(row.courtNum), maxPages);
      }

      records.push({
        source: "ymq",
        source_race_id: raceId,
        ymq_match_id: `ymq:${row.id}`,
        category: row.groupName || "U",
        tournament_name: tournamentName,
        start_time: startTime,
        match_started_at: matchStartedAt,
        match_ended_at: matchEndedAt,
        location: row.courtName || null,
        city: null,
        court_num: row.courtNum ?? null,
        match_no: row.raceTimeNum ?? null,
        match_time_name: row.raceTimeName ?? null,
        round_name: roundName,
        players_a: playersA,
        players_b: playersB,
        players_text: playersText,
        score_text: scoreText,
        winner_side: winner,
        source_status_no: Number.isFinite(Number(row.scoreStatusNo)) ? Number(row.scoreStatusNo) : null,
        source_updated_at: sourceUpdatedAt,
        raw_hash: rawHash,
        raw: row,
        age_years: ageYears,
        item_name: itemName,
        event_key: eventKey,
      });
    }

    const batchSize = Number(getEnv("MATCHLIFE_RPC_BATCH_SIZE") || 150);
    let cacheInserted = 0;
    let cacheUpdated = 0;
    let cacheSkipped = 0;
    let ignoredCount = 0;
    for (const batch of chunkArray(records, batchSize)) {
      const { data: stageRes, error: stageErr } = await supabase.rpc(
        "stage_live_matches",
        { records: batch },
      );
      if (stageErr) throw stageErr;
      const stageMeta = (typeof stageRes === "object" && stageRes !== null)
        ? (stageRes as Record<string, unknown>)
        : {};
      cacheInserted += Number(stageMeta.cached_inserted_count ?? 0);
      cacheUpdated += Number(stageMeta.cached_updated_count ?? 0);
      cacheSkipped += Number(stageMeta.cached_skipped_count ?? 0);
      ignoredCount += Number(stageMeta.ignored_count ?? 0);
    }

    const { data: persistRes, error: persistErr } = await supabase.rpc(
      "persist_ready_active_matches",
      {},
    );
    if (persistErr) throw persistErr;

    const persistMeta = (typeof persistRes === 'object' && persistRes !== null) ? (persistRes as Record<string, unknown>) : {};
    const inserted = Number(persistMeta['persisted_inserted_count'] ?? 0);
    const updated = Number(persistMeta['persisted_updated_count'] ?? 0);
    const skipped = Number(persistMeta['persisted_skipped_count'] ?? 0);
    const markedPersistedCount = Number(persistMeta['marked_persisted_count'] ?? 0);
    const upsertedCount = inserted + updated + skipped;
    const runtimeState = await fetchSyncRuntimeState(supabase);

    await supabase.from("sync_runs").insert({
      source: "ymq",
      status: "SUCCESS",
      pulled_count: pulledCount,
      upserted_count: upsertedCount,
      active_cached_count: runtimeState.activeCachedCount,
      pending_persist_count: runtimeState.pendingPersistCount,
      persisted_count: runtimeState.persistedCount,
      error_message:
        `mode=${mode}; validated=${records.length}; invalid=${invalidCount}; ` +
        `cacheInserted=${cacheInserted}; cacheUpdated=${cacheUpdated}; cacheSkipped=${cacheSkipped}; ` +
        `activeCached=${runtimeState.activeCachedCount}; pendingPersist=${runtimeState.pendingPersistCount}; ` +
        `persisted=${markedPersistedCount}; inserted=${inserted}; updated=${updated}; skipped=${skipped}; ` +
        `ignored=${ignoredCount}; hotCourts=${activeByCourt.size}; priorityCourts=${prioritizedCourtNos.length}; ` +
        `courts=${targetCourts.length}; pages=${maxPages}`,
    });

    await cleanupSyncRuns(supabase, "ymq");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Sync completed",
        raceId,
        courts: courts.length,
        mode,
        pulled: pulledCount,
        upserted: upsertedCount,
        cacheInserted,
        cacheUpdated,
        cacheSkipped,
        activeCached: runtimeState.activeCachedCount,
        pendingPersist: runtimeState.pendingPersistCount,
        persistedCount: markedPersistedCount,
        inserted,
        updated,
        skipped,
        ignored: ignoredCount,
        invalid: invalidCount,
        prioritizedCourtNos,
        activeCourts: Array.from(activeByCourt.entries()).map(([courtNo, page]) => ({
          courtNo,
          maxPage: page,
        })),
      }),
      { 
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || "Unknown error");
    try {
      const supabase = getSupabaseAdmin() as SupabaseAdmin;
      await supabase.from("sync_runs").insert({
        source: "ymq",
        status: "FAILED",
        error_message: message,
      });
    } catch {
      void 0;
    }
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );
  }
});
