#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/FYP/Documents/WorkSpace/7Smile/subproducts/SevenSmile-MatchLife}"
SERVER_IP="${SERVER_IP:-121.41.195.46}"
SERVER_SSH_PORT="${SERVER_SSH_PORT:-22}"
REMOTE_USER="${REMOTE_USER:-cheersai}"
APP_RUN_USER="${APP_RUN_USER:-sevensmile}"
APP_SLUG="${APP_SLUG:-7smile-matchlife}"
REMOTE_STAGE_DIR="${REMOTE_STAGE_DIR:-/home/${REMOTE_USER}/release/staging/${APP_SLUG}}"
CERT_DIR="${CERT_DIR:-}"
CERT_BASENAME="${CERT_BASENAME:-tools.cheersai.cloud}"
APP_ORIGIN="${APP_ORIGIN:-https://tools.cheersai.cloud}"
APP_BASE_PATH="${APP_BASE_PATH:-/${APP_SLUG}/}"
WECHAT_ACCESS_CODES="${WECHAT_ACCESS_CODES:-7SMILE-ML-20260418}"
WECHAT_ACCESS_KEYWORD="${WECHAT_ACCESS_KEYWORD:-比赛生涯}"
WECHAT_ACCESS_VERSION="${WECHAT_ACCESS_VERSION:-$(date +%F)}"
WECHAT_ACCESS_LINK_TTL_SECONDS="${WECHAT_ACCESS_LINK_TTL_SECONDS:-600}"
WECHAT_SESSION_TTL_SECONDS="${WECHAT_SESSION_TTL_SECONDS:-43200}"
WECHAT_MP_TOKEN="${WECHAT_MP_TOKEN:-}"
WECHAT_MP_APPID="${WECHAT_MP_APPID:-}"
WECHAT_MP_SECRET="${WECHAT_MP_SECRET:-}"
WECHAT_ACCESS_LINK_SECRET="${WECHAT_ACCESS_LINK_SECRET:-}"
MATCHLIFE_DISCOVERY_INTERVAL_MS="${MATCHLIFE_DISCOVERY_INTERVAL_MS:-30000}"
MATCHLIFE_ACTIVE_INTERVAL_MS="${MATCHLIFE_ACTIVE_INTERVAL_MS:-1500}"
MATCHLIFE_IDLE_FAST_INTERVAL_MS="${MATCHLIFE_IDLE_FAST_INTERVAL_MS:-10000}"
MATCHLIFE_ACTIVE_IDLE_MS="${MATCHLIFE_ACTIVE_IDLE_MS:-60000}"
MATCHLIFE_ACTIVE_PAGES="${MATCHLIFE_ACTIVE_PAGES:-2}"
MATCHLIFE_QUIET_HOURS_START_HOUR="${MATCHLIFE_QUIET_HOURS_START_HOUR:-23}"
MATCHLIFE_QUIET_HOURS_END_HOUR="${MATCHLIFE_QUIET_HOURS_END_HOUR:-8}"
MATCHLIFE_QUIET_HOURS_TIMEZONE="${MATCHLIFE_QUIET_HOURS_TIMEZONE:-Asia/Shanghai}"
MATCHLIFE_QUIET_HEARTBEAT_INTERVAL_MS="${MATCHLIFE_QUIET_HEARTBEAT_INTERVAL_MS:-120000}"
MATCHLIFE_IDLE_WARM_AFTER_MS="${MATCHLIFE_IDLE_WARM_AFTER_MS:-600000}"
MATCHLIFE_IDLE_WARM_INTERVAL_MS="${MATCHLIFE_IDLE_WARM_INTERVAL_MS:-30000}"
MATCHLIFE_IDLE_COOL_AFTER_MS="${MATCHLIFE_IDLE_COOL_AFTER_MS:-1800000}"
MATCHLIFE_IDLE_COOL_INTERVAL_MS="${MATCHLIFE_IDLE_COOL_INTERVAL_MS:-60000}"
MATCHLIFE_NET_IFACE="${MATCHLIFE_NET_IFACE:-}"
MATCHLIFE_NET_CAPACITY_MBPS="${MATCHLIFE_NET_CAPACITY_MBPS:-0}"
MATCHLIFE_NET_UTILIZATION_THRESHOLD="${MATCHLIFE_NET_UTILIZATION_THRESHOLD:-0.8}"
MATCHLIFE_NET_SAMPLE_WINDOW_MS="${MATCHLIFE_NET_SAMPLE_WINDOW_MS:-15000}"
MATCHLIFE_NET_DEFER_INTERVAL_MS="${MATCHLIFE_NET_DEFER_INTERVAL_MS:-20000}"
MATCHLIFE_ERROR_BACKOFF_BASE_MS="${MATCHLIFE_ERROR_BACKOFF_BASE_MS:-5000}"
MATCHLIFE_ERROR_BACKOFF_MAX_MS="${MATCHLIFE_ERROR_BACKOFF_MAX_MS:-120000}"
YMQ_HTTP_TIMEOUT_MS="${YMQ_HTTP_TIMEOUT_MS:-12000}"
SYNC_RACE_ID="${SYNC_RACE_ID:-38653}"
SYNC_RACE_IDS="${SYNC_RACE_IDS:-}"
SYNC_TOURNAMENT_NAME="${SYNC_TOURNAMENT_NAME:-2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛}"
if [[ -f "${PROJECT_ROOT}/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${PROJECT_ROOT}/.env.local"
  set +a
fi
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${PROJECT_ROOT}/.env"
  set +a
fi

ssh_cmd() {
  ssh -p "${SERVER_SSH_PORT}" "${REMOTE_USER}@${SERVER_IP}" "$@"
}

cd "${PROJECT_ROOT}"

ssh_cmd "rm -rf '${REMOTE_STAGE_DIR}' && mkdir -p '${REMOTE_STAGE_DIR}'"
rsync -az --delete -e "ssh -p ${SERVER_SSH_PORT}" "${PROJECT_ROOT}/dist/" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/dist/"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/matchlife-uat/deploy-matchlife.sh" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/deploy-matchlife.sh"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/matchlife-uat/wechat-oauth-server.mjs" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/wechat-oauth-server.mjs"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/matchlife-uat/wechat-follower-sync.mjs" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/wechat-follower-sync.mjs"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/matchlife-uat/run-sync-once.mjs" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/run-sync-once.mjs"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/matchlife-uat/sync-runtime.package.json" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/sync-runtime.package.json"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/matchlife-uat/systemd/matchlife-sync.service.tpl" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/matchlife-sync.service.tpl"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/watch-ymq.mjs" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/watch-ymq.mjs"
ssh_cmd "mkdir -p '${REMOTE_STAGE_DIR}/lib'"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/lib/ymq-sync.mjs" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/lib/ymq-sync.mjs"
scp -P "${SERVER_SSH_PORT}" "${PROJECT_ROOT}/scripts/lib/canonical-match.mjs" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/lib/canonical-match.mjs"
if [[ -n "${CERT_DIR}" && -f "${CERT_DIR}/${CERT_BASENAME}_bundle.pem" && -f "${CERT_DIR}/${CERT_BASENAME}.key" ]]; then
  scp -P "${SERVER_SSH_PORT}" "${CERT_DIR}/${CERT_BASENAME}_bundle.pem" "${CERT_DIR}/${CERT_BASENAME}.key" "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/"
fi
python3 - <<'PY'
from pathlib import Path
import os, shlex
content = "\n".join([
    f"APP_ORIGIN={shlex.quote(os.getenv('APP_ORIGIN', 'https://tools.cheersai.cloud'))}",
    f"APP_BASE_PATH={shlex.quote(os.getenv('APP_BASE_PATH', '/7smile-matchlife/'))}",
    f"WECHAT_ACCESS_CODES={shlex.quote(os.getenv('WECHAT_ACCESS_CODES', '7SMILE-ML-20260418'))}",
    f"WECHAT_ACCESS_KEYWORD={shlex.quote(os.getenv('WECHAT_ACCESS_KEYWORD', '比赛生涯'))}",
    f"WECHAT_ACCESS_VERSION={shlex.quote(os.getenv('WECHAT_ACCESS_VERSION', ''))}",
    f"WECHAT_ACCESS_LINK_TTL_SECONDS={shlex.quote(os.getenv('WECHAT_ACCESS_LINK_TTL_SECONDS', '600'))}",
    f"WECHAT_SESSION_TTL_SECONDS={shlex.quote(os.getenv('WECHAT_SESSION_TTL_SECONDS', '43200'))}",
    f"WECHAT_MP_TOKEN={shlex.quote(os.getenv('WECHAT_MP_TOKEN', ''))}",
    f"WECHAT_MP_APPID={shlex.quote(os.getenv('WECHAT_MP_APPID', ''))}",
    f"WECHAT_MP_SECRET={shlex.quote(os.getenv('WECHAT_MP_SECRET', ''))}",
    f"WECHAT_ACCESS_LINK_SECRET={shlex.quote(os.getenv('WECHAT_ACCESS_LINK_SECRET', ''))}",
])
path = Path('/tmp/matchlife-wechat-access.env')
path.write_text(content + "\n")
print(path)
PY
scp -P "${SERVER_SSH_PORT}" /tmp/matchlife-wechat-access.env "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/wechat-access.env"
python3 - <<'PY'
from pathlib import Path
import os, shlex
required = {
    "VITE_SUPABASE_URL": os.getenv("VITE_SUPABASE_URL", ""),
    "SUPABASE_SERVICE_ROLE_KEY": os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
}
missing = [k for k, v in required.items() if not v]
if missing:
    raise SystemExit(f"Missing env for sync runtime: {', '.join(missing)}")
content = "\n".join([
    f"SUPABASE_URL={shlex.quote(os.getenv('SUPABASE_URL', 'http://175.178.236.183:8000'))}",
    f"VITE_SUPABASE_URL={shlex.quote(required['VITE_SUPABASE_URL'])}",
    f"SUPABASE_SERVICE_ROLE_KEY={shlex.quote(required['SUPABASE_SERVICE_ROLE_KEY'])}",
    f"MATCHLIFE_DISCOVERY_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_DISCOVERY_INTERVAL_MS', '30000'))}",
    f"MATCHLIFE_ACTIVE_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_ACTIVE_INTERVAL_MS', '1500'))}",
    f"MATCHLIFE_IDLE_FAST_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_IDLE_FAST_INTERVAL_MS', '10000'))}",
    f"MATCHLIFE_ACTIVE_IDLE_MS={shlex.quote(os.getenv('MATCHLIFE_ACTIVE_IDLE_MS', '60000'))}",
    f"MATCHLIFE_ACTIVE_PAGES={shlex.quote(os.getenv('MATCHLIFE_ACTIVE_PAGES', '2'))}",
    f"MATCHLIFE_QUIET_HOURS_START_HOUR={shlex.quote(os.getenv('MATCHLIFE_QUIET_HOURS_START_HOUR', '23'))}",
    f"MATCHLIFE_QUIET_HOURS_END_HOUR={shlex.quote(os.getenv('MATCHLIFE_QUIET_HOURS_END_HOUR', '8'))}",
    f"MATCHLIFE_QUIET_HOURS_TIMEZONE={shlex.quote(os.getenv('MATCHLIFE_QUIET_HOURS_TIMEZONE', 'Asia/Shanghai'))}",
    f"MATCHLIFE_QUIET_HEARTBEAT_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_QUIET_HEARTBEAT_INTERVAL_MS', '120000'))}",
    f"MATCHLIFE_IDLE_WARM_AFTER_MS={shlex.quote(os.getenv('MATCHLIFE_IDLE_WARM_AFTER_MS', '600000'))}",
    f"MATCHLIFE_IDLE_WARM_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_IDLE_WARM_INTERVAL_MS', '30000'))}",
    f"MATCHLIFE_IDLE_COOL_AFTER_MS={shlex.quote(os.getenv('MATCHLIFE_IDLE_COOL_AFTER_MS', '1800000'))}",
    f"MATCHLIFE_IDLE_COOL_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_IDLE_COOL_INTERVAL_MS', '60000'))}",
    f"MATCHLIFE_NET_IFACE={shlex.quote(os.getenv('MATCHLIFE_NET_IFACE', ''))}",
    f"MATCHLIFE_NET_CAPACITY_MBPS={shlex.quote(os.getenv('MATCHLIFE_NET_CAPACITY_MBPS', '0'))}",
    f"MATCHLIFE_NET_UTILIZATION_THRESHOLD={shlex.quote(os.getenv('MATCHLIFE_NET_UTILIZATION_THRESHOLD', '0.8'))}",
    f"MATCHLIFE_NET_SAMPLE_WINDOW_MS={shlex.quote(os.getenv('MATCHLIFE_NET_SAMPLE_WINDOW_MS', '15000'))}",
    f"MATCHLIFE_NET_DEFER_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_NET_DEFER_INTERVAL_MS', '20000'))}",
    f"MATCHLIFE_ERROR_BACKOFF_BASE_MS={shlex.quote(os.getenv('MATCHLIFE_ERROR_BACKOFF_BASE_MS', '5000'))}",
    f"MATCHLIFE_ERROR_BACKOFF_MAX_MS={shlex.quote(os.getenv('MATCHLIFE_ERROR_BACKOFF_MAX_MS', '120000'))}",
    f"YMQ_HTTP_TIMEOUT_MS={shlex.quote(os.getenv('YMQ_HTTP_TIMEOUT_MS', '12000'))}",
    f"MATCHLIFE_AUTO_PAUSE_IDLE_MS={shlex.quote(os.getenv('MATCHLIFE_AUTO_PAUSE_IDLE_MS', '86400000'))}",
    f"MATCHLIFE_AUTO_PAUSE_ERROR_MS={shlex.quote(os.getenv('MATCHLIFE_AUTO_PAUSE_ERROR_MS', '86400000'))}",
    f"MATCHLIFE_PAUSED_HEARTBEAT_INTERVAL_MS={shlex.quote(os.getenv('MATCHLIFE_PAUSED_HEARTBEAT_INTERVAL_MS', '300000'))}",
    f"SYNC_RACE_ID={shlex.quote(os.getenv('SYNC_RACE_ID', '38653'))}",
    f"SYNC_RACE_IDS={shlex.quote(os.getenv('SYNC_RACE_IDS', ''))}",
    f"SYNC_TOURNAMENT_NAME={shlex.quote(os.getenv('SYNC_TOURNAMENT_NAME', '2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛'))}",
])
path = Path('/tmp/matchlife-sync-runtime.env')
path.write_text(content + "\n")
print(path)
PY
scp -P "${SERVER_SSH_PORT}" /tmp/matchlife-sync-runtime.env "${REMOTE_USER}@${SERVER_IP}:${REMOTE_STAGE_DIR}/sync-runtime.env"

echo "push ok: ${REMOTE_STAGE_DIR}"
