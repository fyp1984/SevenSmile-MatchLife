#!/usr/bin/env bash
set -euo pipefail

SECRETS_FILE="${SECRETS_FILE:-/home/sevensmile/release/staging/matchlife_supabase_secrets.env}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/home/sevensmile/release/staging}"
POSTGREST_BIN_SRC="${POSTGREST_BIN_SRC:-/home/sevensmile/release/staging/postgrest}"
DB_NAME="${DB_NAME:-matchlife_supabase}"
DB_OWNER="${DB_OWNER:-matchlife_owner}"
DB_AUTH="${DB_AUTH:-authenticator}"
PGRST_PORT="${PGRST_PORT:-18000}"
PGRST_DB_POOL="${PGRST_DB_POOL:-60}"
PGRST_DB_POOL_ACQUIRE_TIMEOUT="${PGRST_DB_POOL_ACQUIRE_TIMEOUT:-5}"
PGRST_NGINX_KEEPALIVE="${PGRST_NGINX_KEEPALIVE:-128}"

if [[ ! -f "${SECRETS_FILE}" ]]; then
  echo "missing secrets file: ${SECRETS_FILE}" >&2
  exit 1
fi

source "${SECRETS_FILE}"

sudo -n install -m 755 "${POSTGREST_BIN_SRC}" /usr/local/bin/postgrest
postgrest --help >/dev/null

sudo -n -u postgres psql -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_OWNER}') THEN
    CREATE ROLE ${DB_OWNER} LOGIN PASSWORD '${DB_OWNER_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_OWNER} WITH LOGIN PASSWORD '${DB_OWNER_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_AUTH}') THEN
    CREATE ROLE ${DB_AUTH} LOGIN PASSWORD '${DB_AUTH_PASSWORD}' NOINHERIT;
  ELSE
    ALTER ROLE ${DB_AUTH} WITH LOGIN PASSWORD '${DB_AUTH_PASSWORD}' NOINHERIT;
  END IF;
END
\$\$;
GRANT anon TO ${DB_AUTH};
GRANT authenticated TO ${DB_AUTH};
GRANT service_role TO ${DB_AUTH};
SQL

if ! sudo -n -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -n -u postgres createdb -O "${DB_OWNER}" "${DB_NAME}"
fi

sudo -n -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, ${DB_AUTH};
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS court_num INT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS match_no INT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS match_time_name TEXT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS players_text TEXT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS raw_hash TEXT;
ALTER TABLE IF EXISTS public.matches ADD COLUMN IF NOT EXISTS raw JSONB;
SQL

TMP_MIGRATIONS_DIR="/tmp/matchlife-migrations"
sudo -n rm -rf "${TMP_MIGRATIONS_DIR}"
sudo -n install -d -m 755 "${TMP_MIGRATIONS_DIR}"

mapfile -t migration_files < <(find "${MIGRATIONS_DIR}" -type f -name '*.sql' | sort)
if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "no migration sql files found under ${MIGRATIONS_DIR}" >&2
  exit 1
fi

for file in "${migration_files[@]}"; do
  sudo -n cp "${file}" "${TMP_MIGRATIONS_DIR}/$(basename "${file}")"
done
sudo -n chmod 644 "${TMP_MIGRATIONS_DIR}"/*.sql

for file in $(ls "${TMP_MIGRATIONS_DIR}"/*.sql | sort); do
  name=$(basename "${file}")
  sudo -n -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${file}" >/tmp/"${name}".log
  echo "applied: ${name}"
done

sudo -n install -d /etc/postgrest
sudo -n tee /etc/postgrest/matchlife.conf >/dev/null <<CFG
db-uri = "postgres://${DB_AUTH}:${DB_AUTH_PASSWORD}@127.0.0.1:5432/${DB_NAME}"
db-anon-role = "anon"
db-schemas = "public"
db-channel-enabled = true
db-channel = "pgrst"
db-pool = ${PGRST_DB_POOL}
db-pool-acquisition-timeout = ${PGRST_DB_POOL_ACQUIRE_TIMEOUT}
server-host = "127.0.0.1"
server-port = ${PGRST_PORT}
jwt-secret = "${JWT_SECRET_BASE64}"
jwt-secret-is-base64 = true
openapi-mode = "follow-privileges"
CFG

sudo -n tee /etc/systemd/system/postgrest-matchlife.service >/dev/null <<UNIT
[Unit]
Description=PostgREST MatchLife Self Hosted
After=network.target postgresql.service

[Service]
Type=simple
User=sevensmile
Group=sevensmile
ExecStart=/usr/local/bin/postgrest /etc/postgrest/matchlife.conf
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT

sudo -n systemctl daemon-reload
sudo -n systemctl enable postgrest-matchlife >/dev/null
sudo -n systemctl restart postgrest-matchlife
sudo -n -u postgres psql -d "${DB_NAME}" -c "SELECT pg_notify('pgrst', 'reload schema');" >/dev/null

sudo -n install -d /etc/nginx/ssl/matchlife-supabase
if [[ ! -f /etc/nginx/ssl/matchlife-supabase/ip.crt || ! -f /etc/nginx/ssl/matchlife-supabase/ip.key ]]; then
  sudo -n openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/nginx/ssl/matchlife-supabase/ip.key \
    -out /etc/nginx/ssl/matchlife-supabase/ip.crt \
    -subj "/CN=175.178.236.183"
fi

sudo -n tee /etc/nginx/conf.d/matchlife-supabase-upstream.conf >/dev/null <<NGUP
upstream matchlife_postgrest_local {
  server 127.0.0.1:${PGRST_PORT};
  keepalive ${PGRST_NGINX_KEEPALIVE};
}
NGUP

sudo -n tee /etc/nginx/conf.d/matchlife-supabase-ip.conf >/dev/null <<NG
server {
  listen 8000;
  listen [::]:8000;
  server_name _;
  client_max_body_size 200m;
  add_header Access-Control-Allow-Origin "*" always;
  add_header Access-Control-Allow-Headers "authorization, x-client-info, apikey, content-type, prefer" always;
  add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
  if (\$request_method = OPTIONS) { return 204; }
  location ^~ /rest/v1/ {
    rewrite ^/rest/v1/(.*)$ /\$1 break;
    proxy_pass http://matchlife_postgrest_local;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_socket_keepalive on;
    proxy_connect_timeout 15s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location / {
    proxy_pass http://matchlife_postgrest_local;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_socket_keepalive on;
    proxy_connect_timeout 15s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}

server {
  listen 8443 ssl;
  listen [::]:8443 ssl;
  server_name _;
  ssl_certificate /etc/nginx/ssl/matchlife-supabase/ip.crt;
  ssl_certificate_key /etc/nginx/ssl/matchlife-supabase/ip.key;
  client_max_body_size 200m;
  add_header Access-Control-Allow-Origin "*" always;
  add_header Access-Control-Allow-Headers "authorization, x-client-info, apikey, content-type, prefer" always;
  add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
  if (\$request_method = OPTIONS) { return 204; }
  location ^~ /rest/v1/ {
    rewrite ^/rest/v1/(.*)$ /\$1 break;
    proxy_pass http://matchlife_postgrest_local;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_socket_keepalive on;
    proxy_connect_timeout 15s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location / {
    proxy_pass http://matchlife_postgrest_local;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_socket_keepalive on;
    proxy_connect_timeout 15s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NG

sudo -n nginx -t
sudo -n systemctl reload nginx

mkdir -p /home/sevensmile/release/runtime
cat > /home/sevensmile/release/runtime/matchlife-supabase.env <<ENV
VITE_SUPABASE_URL=http://175.178.236.183:8000
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
ENV
chmod 600 /home/sevensmile/release/runtime/matchlife-supabase.env

echo "self-hosted supabase setup complete"
