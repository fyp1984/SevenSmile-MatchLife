#!/usr/bin/env bash
set -euo pipefail

REMOTE_STAGE_DIR="${REMOTE_STAGE_DIR:-$HOME/release/staging/7smile-matchlife}"
APP_RUN_USER="${APP_RUN_USER:-sevensmile}"
APP_SLUG="${APP_SLUG:-7smile-matchlife}"
REMOTE_WWW_DIR="${REMOTE_WWW_DIR:-/home/${APP_RUN_USER}/apps/${APP_SLUG}/current}"
DOMAIN_NAME="${DOMAIN_NAME:-tools.cheersai.cloud}"
APP_PATH="${APP_PATH:-/${APP_SLUG}}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-${DOMAIN_NAME}.conf}"
WECHAT_OAUTH_UPSTREAM="${WECHAT_OAUTH_UPSTREAM:-http://127.0.0.1:18765}"
SUPABASE_REST_UPSTREAM="${SUPABASE_REST_UPSTREAM:-http://175.178.236.183:8000}"
SUPABASE_REST_HOST_HEADER="${SUPABASE_REST_HOST_HEADER:-175.178.236.183}"
SYNC_SERVICE_NAME="${SYNC_SERVICE_NAME:-${APP_SLUG}-sync.service}"
CERT_BASENAME="${CERT_BASENAME:-${DOMAIN_NAME}}"

APP_PATH="/${APP_PATH#/}"
APP_PATH="${APP_PATH%/}"
APP_HOME="/home/${APP_RUN_USER}"
APP_DIR="${APP_HOME}/apps/${APP_SLUG}"
NGINX_CONF_PATH="/etc/nginx/conf.d/${NGINX_SITE_NAME}"
NGINX_SNIPPET_DIR="/etc/nginx/snippets"
NGINX_MATCHLIFE_SNIPPET="${NGINX_SNIPPET_DIR}/${APP_SLUG}.${DOMAIN_NAME}.locations.conf"
SSL_DIR="/etc/nginx/ssl"
RUNTIME_DIR="${APP_HOME}/release/runtime/${APP_SLUG}"
RUNTIME_PID="${RUNTIME_DIR}/wechat-access.pid"
RUNTIME_LOG="${RUNTIME_DIR}/wechat-access.log"
SYNC_RUNTIME_DIR="${APP_HOME}/release/runtime/${APP_SLUG}-sync"
SYNC_SERVICE_PATH="/etc/systemd/system/${SYNC_SERVICE_NAME}"

if [[ ! -d "${REMOTE_STAGE_DIR}/dist" ]]; then
  echo "missing dist in ${REMOTE_STAGE_DIR}" >&2
  exit 1
fi

if ! sudo -n /usr/bin/mkdir -p /tmp/matchlife-sudo-check >/dev/null 2>&1; then
  echo "sudo without password is required for release (create ${APP_RUN_USER}, write nginx, install systemd)." >&2
  echo "Please grant ${USER} NOPASSWD sudo for required commands (or run this script as root)." >&2
  exit 1
fi

if ! id -u "${APP_RUN_USER}" >/dev/null 2>&1; then
  sudo -n useradd -m -s /bin/bash "${APP_RUN_USER}"
fi

sudo -n install -d -o "${APP_RUN_USER}" -g "${APP_RUN_USER}" \
  "${APP_HOME}/apps" \
  "${APP_DIR}" \
  "${REMOTE_WWW_DIR}" \
  "${REMOTE_WWW_DIR}/assets" \
  "${APP_HOME}/release" \
  "${APP_HOME}/release/runtime" \
  "${RUNTIME_DIR}" \
  "${SYNC_RUNTIME_DIR}" \
  "${SYNC_RUNTIME_DIR}/lib"

if [[ -d "${REMOTE_STAGE_DIR}/dist/assets" ]]; then
  # Keep prior hashed assets to avoid stale cached HTML requesting files removed mid-rollout.
  sudo -n rsync -az "${REMOTE_STAGE_DIR}/dist/assets/" "${REMOTE_WWW_DIR}/assets/"
fi
sudo -n rsync -az --delete --exclude 'assets/' "${REMOTE_STAGE_DIR}/dist/" "${REMOTE_WWW_DIR}/"
sudo -n chmod 755 "${APP_HOME}" "${APP_HOME}/apps" "${APP_DIR}" "${REMOTE_WWW_DIR}" "${REMOTE_WWW_DIR}/assets"
sudo -n find "${REMOTE_WWW_DIR}" -type d -exec chmod 755 {} +
sudo -n find "${REMOTE_WWW_DIR}" -type f -exec chmod 644 {} +

if [[ -f "${REMOTE_STAGE_DIR}/${CERT_BASENAME}_bundle.pem" && -f "${REMOTE_STAGE_DIR}/${CERT_BASENAME}.key" ]]; then
  sudo -n install -d "${SSL_DIR}"
  sudo -n rsync -az "${REMOTE_STAGE_DIR}/${CERT_BASENAME}_bundle.pem" "${SSL_DIR}/${CERT_BASENAME}_bundle.pem"
  sudo -n rsync -az "${REMOTE_STAGE_DIR}/${CERT_BASENAME}.key" "${SSL_DIR}/${CERT_BASENAME}.key"
fi

sync_owned_file() {
  local src="$1"
  local dest="$2"
  if [[ -f "${src}" ]]; then
    sudo -n rsync -az "${src}" "${dest}"
  fi
}

sync_owned_file "${REMOTE_STAGE_DIR}/wechat-oauth-server.mjs" "${RUNTIME_DIR}/wechat-oauth-server.mjs"
sync_owned_file "${REMOTE_STAGE_DIR}/wechat-follower-sync.mjs" "${RUNTIME_DIR}/wechat-follower-sync.mjs"
sync_owned_file "${REMOTE_STAGE_DIR}/wechat-access.env" "${RUNTIME_DIR}/wechat-access.env"
sync_owned_file "${REMOTE_STAGE_DIR}/sync-runtime.package.json" "${SYNC_RUNTIME_DIR}/package.json"
sync_owned_file "${REMOTE_STAGE_DIR}/watch-ymq.mjs" "${SYNC_RUNTIME_DIR}/watch-ymq.mjs"
sync_owned_file "${REMOTE_STAGE_DIR}/run-sync-once.mjs" "${SYNC_RUNTIME_DIR}/run-sync-once.mjs"
sync_owned_file "${REMOTE_STAGE_DIR}/lib/ymq-sync.mjs" "${SYNC_RUNTIME_DIR}/lib/ymq-sync.mjs"
sync_owned_file "${REMOTE_STAGE_DIR}/sync-runtime.env" "${SYNC_RUNTIME_DIR}/.env.runtime"
sync_owned_file "${REMOTE_STAGE_DIR}/matchlife-sync.service.tpl" "${SYNC_RUNTIME_DIR}/matchlife-sync.service.tpl"

sudo -n chown -R "${APP_RUN_USER}:${APP_RUN_USER}" "${APP_DIR}" "${RUNTIME_DIR}" "${SYNC_RUNTIME_DIR}"

sudo -n install -d "${NGINX_SNIPPET_DIR}"
sudo -n tee "${NGINX_MATCHLIFE_SNIPPET}" >/dev/null <<EOF
location = ${APP_PATH} {
    return 301 ${APP_PATH}/;
}

location ^~ ${APP_PATH}/supabase/ {
    rewrite ^${APP_PATH}/supabase/(.*)$ /\$1 break;
    proxy_pass ${SUPABASE_REST_UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host ${SUPABASE_REST_HOST_HEADER};
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP \$remote_addr;
}

location ^~ ${APP_PATH}/api/wechat/ {
    proxy_pass ${WECHAT_OAUTH_UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Prefix ${APP_PATH};
}

location ^~ ${APP_PATH}/assets/ {
    alias ${REMOTE_WWW_DIR}/assets/;
    expires 30d;
    access_log off;
    add_header Cache-Control "public, immutable";
    try_files \$uri =404;
}

location ^~ ${APP_PATH}/ {
    alias ${REMOTE_WWW_DIR}/;
    index index.html;
    expires -1;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files \$uri \$uri/ ${APP_PATH}/index.html;
}
EOF

sudo -n python3 - "${NGINX_CONF_PATH}" "${NGINX_MATCHLIFE_SNIPPET}" <<'PY'
from pathlib import Path
import sys

conf_path = Path(sys.argv[1])
snippet_path = sys.argv[2]
start = "    # BEGIN MATCHLIFE MANAGED BLOCK"
end = "    # END MATCHLIFE MANAGED BLOCK"
block = f"{start}\n    include {snippet_path};\n    {end}"

text = conf_path.read_text(encoding="utf-8")
if start in text and end in text:
    head, tail = text.split(start, 1)
    _, tail = tail.split(end, 1)
    text = head + block + tail
else:
    anchor = "    access_log /var/log/nginx/tools.cheersai.cloud_access.log;"
    if anchor not in text:
        raise SystemExit(f"anchor not found in {conf_path}")
    text = text.replace(anchor, block + "\n\n" + anchor, 1)

conf_path.write_text(text, encoding="utf-8")
PY

sudo -n nginx -t
sudo -n systemctl reload nginx || sudo -n service nginx reload

sudo -n -u "${APP_RUN_USER}" bash -lc "
set -euo pipefail
if [[ -f '${RUNTIME_PID}' ]] && kill -0 \$(cat '${RUNTIME_PID}') >/dev/null 2>&1; then
  kill \$(cat '${RUNTIME_PID}') >/dev/null 2>&1 || true
  sleep 1
fi
if [[ -f '${RUNTIME_DIR}/wechat-oauth-server.mjs' && -f '${RUNTIME_DIR}/wechat-access.env' ]]; then
  nohup bash -lc \"set -a && source '${RUNTIME_DIR}/wechat-access.env' && set +a && exec node '${RUNTIME_DIR}/wechat-oauth-server.mjs'\" > '${RUNTIME_LOG}' 2>&1 &
  echo \$! > '${RUNTIME_PID}'
fi
"

if [[ -f "${SYNC_RUNTIME_DIR}/package.json" ]]; then
  sudo -n -u "${APP_RUN_USER}" bash -lc "cd '${SYNC_RUNTIME_DIR}' && npm install --omit=dev >/dev/null 2>&1"
fi

if [[ -f "${SYNC_RUNTIME_DIR}/watch-ymq.mjs" && -f "${SYNC_RUNTIME_DIR}/.env.runtime" ]]; then
  sudo -n tee "${SYNC_RUNTIME_DIR}/start-watch-ymq.sh" >/dev/null <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "${SYNC_RUNTIME_DIR}"
set -a
source "${SYNC_RUNTIME_DIR}/.env.runtime"
set +a
export MATCHLIFE_HEARTBEAT_FILE="${SYNC_RUNTIME_DIR}/heartbeat.json"
exec node "${SYNC_RUNTIME_DIR}/watch-ymq.mjs" "\${SYNC_RACE_ID:-38653}" "\${SYNC_TOURNAMENT_NAME:-2026年全国U系列羽毛球比赛U12-14(北方赛区)-单项赛}"
EOF
  sudo -n chown "${APP_RUN_USER}:${APP_RUN_USER}" "${SYNC_RUNTIME_DIR}/start-watch-ymq.sh"
  sudo -n chmod +x "${SYNC_RUNTIME_DIR}/start-watch-ymq.sh"

  if [[ -f "${SYNC_RUNTIME_DIR}/matchlife-sync.service.tpl" ]]; then
    sed \
      -e "s|__RUN_USER__|${APP_RUN_USER}|g" \
      -e "s|__SYNC_RUNTIME_DIR__|${SYNC_RUNTIME_DIR}|g" \
      "${SYNC_RUNTIME_DIR}/matchlife-sync.service.tpl" | sudo -n tee "${SYNC_SERVICE_PATH}" >/dev/null
    sudo -n systemctl daemon-reload
    sudo -n systemctl enable "${SYNC_SERVICE_NAME}" >/dev/null
    sudo -n systemctl restart "${SYNC_SERVICE_NAME}"
  fi
fi

echo "release ok: ${DOMAIN_NAME}${APP_PATH}/ -> ${REMOTE_WWW_DIR}"
