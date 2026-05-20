#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${PROJECT_ROOT}/../../../.." && pwd)}"
TECH_SCRIPT_DIR="${TECH_SCRIPT_DIR:-${WORKSPACE_ROOT}/CheersAI/CheersAI - docs/技术/scripts/matchlife-uat}"

if [[ ! -f "${TECH_SCRIPT_DIR}/check-env.sh" ]]; then
  echo "missing deploy scripts: ${TECH_SCRIPT_DIR}" >&2
  exit 1
fi

exec env PROJECT_ROOT="${PROJECT_ROOT}" "${TECH_SCRIPT_DIR}/check-env.sh" "$@"
