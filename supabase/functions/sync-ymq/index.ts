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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// 初始化 Supabase Server 客户端（绕过 RLS）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    const m = fullName.match(/\d{1,2}\s*岁\s*([^\s[]+)/);
    if (m && m[1]) item = m[1].trim();
  }

  let normalizedItem = item || null;
  if (ageYears && normalizedItem) {
    normalizedItem = normalizedItem.replace(new RegExp(`^${ageYears}\\s*岁`), '').trim();
  }

  const eventKey = ageYears && normalizedItem ? `${ageYears}岁${normalizedItem}` : normalizedItem || null;
  return { ageYears, itemName: item || null, eventKey };
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders(),
    });
  }

  try {
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
    const rowsPerPage = 200;
    const maxPages = mode === "fast" ? 1 : 200;

    for (const court of courts) {
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

      const sourceUpdatedAt =
        typeof row.scoreEndTime === "number"
          ? new Date(row.scoreEndTime).toISOString()
          : typeof row.scoreStartTime === "number"
            ? new Date(row.scoreStartTime).toISOString()
            : new Date().toISOString();

      const rawHash = await sha1(JSON.stringify(row));

      const { ageYears, itemName, eventKey } = parseEventKey(row);

      records.push({
        source: "ymq",
        ymq_match_id: `ymq:${row.id}`,
        category: row.groupName || "U",
        tournament_name: tournamentName,
        start_time: startTime,
        location: row.courtName || null,
        city: null,
        court_num: row.courtNum ?? null,
        match_no: row.raceTimeNum ?? null,
        match_time_name: row.raceTimeName ?? null,
        players_a: playersA,
        players_b: playersB,
        players_text: playersText,
        score_text: scoreText,
        winner_side: winner,
        source_updated_at: sourceUpdatedAt,
        raw_hash: rawHash,
        raw: row,
        age_years: ageYears,
        item_name: itemName,
        event_key: eventKey,
      });
    }

    const { data: upsertRes, error: upsertErr } = await supabase.rpc(
      "upsert_matches_if_changed",
      { records },
    );
    if (upsertErr) throw upsertErr;

    const meta = (typeof upsertRes === 'object' && upsertRes !== null) ? (upsertRes as Record<string, unknown>) : {};
    const inserted = Number(meta['inserted_count'] ?? 0);
    const updated = Number(meta['updated_count'] ?? 0);
    const skipped = Number(meta['skipped_count'] ?? 0);
    const upsertedCount = inserted + updated;

    await supabase.from("sync_runs").insert({
      source: "ymq",
      status: "SUCCESS",
      pulled_count: pulledCount,
      upserted_count: upsertedCount,
      error_message: `mode=${mode}; validated=${records.length}; invalid=${invalidCount}; inserted=${inserted}; updated=${updated}; skipped=${skipped}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Sync completed",
        raceId,
        courts: courts.length,
        mode,
        pulled: pulledCount,
        upserted: upsertedCount,
        inserted,
        updated,
        skipped,
        invalid: invalidCount,
      }),
      { 
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || "Unknown error");
    await supabase.from("sync_runs").insert({
      source: "ymq",
      status: "FAILED",
      error_message: message,
    });
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      }
    );
  }
});
