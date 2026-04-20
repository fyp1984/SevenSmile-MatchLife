#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/FYP/Documents/WorkSpace/7Smile/subproducts/SevenSmile-MatchLife}"
APP_BASE_PATH="${APP_BASE_PATH:-/7smile-matchlife/}"
WECHAT_ACCESS_VERSION="${WECHAT_ACCESS_VERSION:-$(date +%F)}"

cd "${PROJECT_ROOT}"

CI=1 pnpm install --frozen-lockfile --force
APP_BASE_PATH="${APP_BASE_PATH}" VITE_WECHAT_ACCESS_VERSION="${WECHAT_ACCESS_VERSION}" pnpm build

test -d dist
echo "build ok: ${PROJECT_ROOT}/dist"
