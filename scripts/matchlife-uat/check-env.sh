#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/Users/FYP/Documents/WorkSpace/7Smile/subproducts/SevenSmile-MatchLife}"
SERVER_IP="${SERVER_IP:-121.41.195.46}"
SERVER_SSH_PORT="${SERVER_SSH_PORT:-22}"
REMOTE_USER="${REMOTE_USER:-cheersai}"
APP_RUN_USER="${APP_RUN_USER:-sevensmile}"
APP_SLUG="${APP_SLUG:-7smile-matchlife}"
REMOTE_STAGE_DIR="${REMOTE_STAGE_DIR:-/home/${REMOTE_USER}/release/staging/${APP_SLUG}}"
REMOTE_WWW_DIR="${REMOTE_WWW_DIR:-/home/${APP_RUN_USER}/apps/${APP_SLUG}/current}"
DOMAIN_NAME="${DOMAIN_NAME:-tools.cheersai.cloud}"
APP_PATH="${APP_PATH:-/${APP_SLUG}}"

ERROR_COUNT=0
WARN_COUNT=0

section() { printf '\n[%s] %s\n' "$1" "$2"; }
ok() { printf '✅ %s\n' "$1"; }
warn() { WARN_COUNT=$((WARN_COUNT + 1)); printf '⚠️  %s\n' "$1"; }
fail() { ERROR_COUNT=$((ERROR_COUNT + 1)); printf '❌ %s\n' "$1"; }

check_cmd() {
  local cmd="$1"
  if command -v "${cmd}" >/dev/null 2>&1; then
    ok "命令可用: ${cmd}"
  else
    fail "命令缺失: ${cmd}"
  fi
}

ssh_cmd() {
  ssh -p "${SERVER_SSH_PORT}" -o BatchMode=yes -o ConnectTimeout=5 "${REMOTE_USER}@${SERVER_IP}" "$@"
}

check_repo() {
  section 1 "本地源码"
  if [[ -d "${PROJECT_ROOT}" ]]; then
    ok "源码目录存在: ${PROJECT_ROOT}"
  else
    fail "源码目录不存在: ${PROJECT_ROOT}"
    return
  fi

  if git -C "${PROJECT_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    ok "Git 仓库有效"
    ok "当前分支: $(git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref HEAD)"
    ok "当前提交: $(git -C "${PROJECT_ROOT}" rev-parse --short HEAD)"
  else
    fail "当前目录不是 Git 仓库"
  fi

  [[ -f "${PROJECT_ROOT}/package.json" ]] && ok "前端定义存在: package.json" || fail "缺少 package.json"
  [[ -f "${PROJECT_ROOT}/pnpm-lock.yaml" ]] && ok "锁文件存在: pnpm-lock.yaml" || warn "缺少 pnpm-lock.yaml"
  [[ -f "${PROJECT_ROOT}/vite.config.ts" ]] && ok "构建配置存在: vite.config.ts" || fail "缺少 vite.config.ts"
}

check_dependencies() {
  section 2 "本地依赖"
  check_cmd git
  check_cmd ssh
  check_cmd scp
  check_cmd rsync
  check_cmd pnpm
}

check_remote() {
  section 3 "远端连通性与资源"
  if ssh_cmd "echo ok" >/dev/null 2>&1; then
    ok "SSH 连通正常: ${REMOTE_USER}@${SERVER_IP}:${SERVER_SSH_PORT}"
  else
    fail "SSH 连通失败：请为 ${REMOTE_USER} 配置免密登录（authorized_keys）"
    return
  fi

  if ssh_cmd "sudo -n /usr/bin/mkdir -p /tmp/matchlife-sudo-check" >/dev/null 2>&1; then
    ok "sudo 免密可用: ${REMOTE_USER}"
  else
    warn "sudo 免密不可用：迁移阶段需要创建 ${APP_RUN_USER}、写入 /etc/nginx 并安装 systemd，请为 ${REMOTE_USER} 配置 sudo NOPASSWD（或用 root 执行发布脚本）"
  fi

  if ssh_cmd "test -d '${REMOTE_STAGE_DIR}' || mkdir -p '${REMOTE_STAGE_DIR}'" >/dev/null 2>&1; then
    ok "远端暂存目录可用: ${REMOTE_STAGE_DIR}"
  else
    fail "远端暂存目录不可用: ${REMOTE_STAGE_DIR}"
  fi

  ssh_cmd "set -e; echo '--- os ---'; uname -a; echo '--- cpu ---'; (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo '?'); echo '--- mem ---'; (free -h 2>/dev/null || cat /proc/meminfo | head -n 5); echo '--- disk ---'; df -h /; echo '--- docker ---'; (docker --version 2>/dev/null || echo 'no docker'); echo '--- nginx ---'; (nginx -v 2>/dev/null || echo 'no nginx');" || warn "远端资源信息获取失败（权限不足或命令缺失）"
}

print_summary() {
  printf '\nCheck Complete. errors=%s warnings=%s\n' "${ERROR_COUNT}" "${WARN_COUNT}"
  [[ "${ERROR_COUNT}" -eq 0 ]] || exit 1
}

echo "========================================================"
echo "      MatchLife Target Environment Check"
echo "========================================================"
echo "Time: $(date)"
echo "Project: ${PROJECT_ROOT}"
echo "Remote: ${REMOTE_USER}@${SERVER_IP}:${SERVER_SSH_PORT}"
echo "Run User: ${APP_RUN_USER}"
echo "Domain: https://${DOMAIN_NAME}${APP_PATH}/"

check_repo
check_dependencies
check_remote
print_summary
