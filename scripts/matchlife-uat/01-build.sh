#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/FYP/Documents/WorkSpace/7Smile/subproducts/SevenSmile-MatchLife}"
APP_BASE_PATH="${APP_BASE_PATH:-/7smile-matchlife/}"
WECHAT_ACCESS_VERSION="${WECHAT_ACCESS_VERSION:-$(date +%F)}"
SUPABASE_PROXY_PATH="${SUPABASE_PROXY_PATH:-${APP_BASE_PATH%/}/supabase}"

cd "${PROJECT_ROOT}"

CI=1 pnpm install --frozen-lockfile --force
APP_BASE_PATH="${APP_BASE_PATH}" \
SUPABASE_PROXY_PATH="${SUPABASE_PROXY_PATH}" \
VITE_SUPABASE_PROXY_PATH="${SUPABASE_PROXY_PATH}" \
VITE_WECHAT_ACCESS_VERSION="${WECHAT_ACCESS_VERSION}" \
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
pnpm build

test -d dist
echo "build ok: ${PROJECT_ROOT}/dist"
