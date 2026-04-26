#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/check-env.sh"
"${SCRIPT_DIR}/01-build.sh"
"${SCRIPT_DIR}/02-push.sh"
"${SCRIPT_DIR}/03-release.sh"
"${SCRIPT_DIR}/04-monitor.sh"
