#!/usr/bin/env bash
set -euo pipefail

SERVER_IP="${SERVER_IP:-121.41.195.46}"
DOMAIN_NAME="${DOMAIN_NAME:-tools.cheersai.cloud}"
APP_SLUG="${APP_SLUG:-7smile-matchlife}"
APP_PATH="${APP_PATH:-/${APP_SLUG}/}"
SCHEME="${SCHEME:-https}"
REMOTE_USER="${REMOTE_USER:-cheersai}"
APP_RUN_USER="${APP_RUN_USER:-sevensmile}"
SYNC_RUNTIME_DIR="${SYNC_RUNTIME_DIR:-/home/${APP_RUN_USER}/release/runtime/${APP_SLUG}-sync}"
SYNC_HEARTBEAT_FILE="${SYNC_HEARTBEAT_FILE:-${SYNC_RUNTIME_DIR}/heartbeat.json}"
SYNC_HEARTBEAT_MAX_AGE_SECONDS="${SYNC_HEARTBEAT_MAX_AGE_SECONDS:-600}"
EXPECT_HTTP_DIAG_HEADER="${EXPECT_HTTP_DIAG_HEADER:-false}"
SUPABASE_PROXY_URL="${SUPABASE_PROXY_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
OBS_REQUIRE_RPC="${OBS_REQUIRE_RPC:-false}"
OBS_ENFORCE_HEALTH="${OBS_ENFORCE_HEALTH:-false}"

URL=""
APP_PATH="/${APP_PATH#/}"
if [[ -n "${DOMAIN_NAME}" && "${DOMAIN_NAME}" != "_" ]]; then
  URL="${SCHEME}://${DOMAIN_NAME}${APP_PATH}"
else
  URL="${SCHEME}://${SERVER_IP}${APP_PATH}"
fi

echo "checking: ${URL}"

ssh -o BatchMode=yes "${REMOTE_USER}@${SERVER_IP}" "curl -k -fsSIL --max-time 10 '${SCHEME}://127.0.0.1${APP_PATH}' -H 'Host: ${DOMAIN_NAME}' >/dev/null"
echo "monitor ok"

if [[ "${EXPECT_HTTP_DIAG_HEADER}" == "true" ]]; then
  ssh -o BatchMode=yes "${REMOTE_USER}@${SERVER_IP}" "curl -fsSIL --max-time 10 'http://127.0.0.1${APP_PATH}' -H 'Host: ${DOMAIN_NAME}' | grep -qi '^X-MatchLife-HTTP-Diag:'"
  echo "http diag header ok"
fi

HTML_AND_ASSETS_STATUS="$(
  ssh -o BatchMode=yes "${REMOTE_USER}@${SERVER_IP}" \
    "python3 - '${APP_PATH}' '${DOMAIN_NAME}' '${SCHEME}' <<'PY'
import re
import subprocess
import sys

app_path = sys.argv[1]
domain = sys.argv[2]
scheme = sys.argv[3]
html = subprocess.check_output(
    [
        'curl', '-k', '-fsSL', '--max-time', '10',
        f'{scheme}://127.0.0.1{app_path}',
        '-H', f'Host: {domain}',
    ],
    text=True,
)

paths = []
for pattern in (
    r'<script[^>]+src=[\"\\']([^\"\\']+)[\"\\']',
    r'<link[^>]+href=[\"\\']([^\"\\']+)[\"\\']',
):
    paths.extend(re.findall(pattern, html, flags=re.I))

checked = []
for path in paths:
    if not path.startswith('/'):
        continue
    if not path.startswith(app_path):
        raise SystemExit(f'asset path escaped app base: {path} (expected prefix {app_path})')
    subprocess.check_call(
        [
            'curl', '-k', '-fsSIL', '--max-time', '10',
            f'{scheme}://127.0.0.1{path}',
            '-H', f'Host: {domain}',
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    checked.append(path)

print('assets ok: ' + ', '.join(checked))
PY"
)"
echo "${HTML_AND_ASSETS_STATUS}"

SYNC_SERVICE_NAME="${SYNC_SERVICE_NAME:-${APP_SLUG}-sync.service}"
ssh -o BatchMode=yes "${REMOTE_USER}@${SERVER_IP}" "sudo -n systemctl is-active '${SYNC_SERVICE_NAME}' >/dev/null"
echo "sync watcher ok"

HEARTBEAT_STATUS="$(
  ssh -o BatchMode=yes "${REMOTE_USER}@${SERVER_IP}" \
    "python3 - '${SYNC_HEARTBEAT_FILE}' '${SYNC_HEARTBEAT_MAX_AGE_SECONDS}' <<'PY'
import json
import os
import sys
import time

path = sys.argv[1]
limit = int(sys.argv[2])

if not os.path.exists(path):
    raise SystemExit(f'missing heartbeat: {path}')

age = time.time() - os.path.getmtime(path)
if age > limit:
    raise SystemExit(f'stale heartbeat: {age:.0f}s > {limit}s')

with open(path, 'r', encoding='utf-8') as fh:
    data = json.load(fh)

paused = data.get('paused')
reason = data.get('pauseReason')
extra = f' paused={paused}' if paused is not None else ''
if paused and reason:
    extra += f' reason={reason}'

print(f\"heartbeat ok: age={age:.0f}s kind={data.get('kind')} ok={data.get('ok')}{extra}\")
PY"
)"
echo "${HEARTBEAT_STATUS}"

if [[ -n "${SUPABASE_PROXY_URL}" && -n "${SUPABASE_ANON_KEY}" ]]; then
  OBS_STATUS="$(
    python3 - "${SUPABASE_PROXY_URL}" "${SUPABASE_ANON_KEY}" "${OBS_ENFORCE_HEALTH}" <<'PY'
import json
import sys
import urllib.request

base_url = sys.argv[1].rstrip('/')
anon_key = sys.argv[2]
enforce_health = sys.argv[3].lower() == 'true'

req = urllib.request.Request(
    f"{base_url}/rest/v1/rpc/matchlife_get_observability_snapshot",
    data=json.dumps({
        "p_recent_run_limit": 5,
        "p_paused_scope_limit": 5,
        "p_alert_limit": 8,
        "p_source_limit": 8,
    }).encode("utf-8"),
    headers={
        "apikey": anon_key,
        "Authorization": f"Bearer {anon_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    },
    method="POST",
)

with urllib.request.urlopen(req, timeout=12) as response:
    body = json.loads(response.read().decode("utf-8"))

summary = body.get("summary") or {}
overall = summary.get("overallStatus", "unknown")
runtime = summary.get("runtimeStatus", "unknown")
paused = summary.get("pausedScopeCount", 0)
critical = summary.get("criticalAlertCount", 0)
warning = summary.get("warningAlertCount", 0)

if enforce_health and overall == "critical":
    raise SystemExit("observability rpc critical")

print(
    f"observability rpc ok: overall={overall} runtime={runtime} "
    f"pausedScopes={paused} criticalAlerts={critical} warningAlerts={warning}"
)
PY
  )"
  echo "${OBS_STATUS}"
elif [[ "${OBS_REQUIRE_RPC}" == "true" ]]; then
  echo "observability rpc skipped: missing SUPABASE_PROXY_URL or SUPABASE_ANON_KEY" >&2
  exit 1
fi
