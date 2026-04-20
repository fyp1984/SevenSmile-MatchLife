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
