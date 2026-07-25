#!/usr/bin/env bash
#
# RoomMind – Deploy to Home Assistant via SSH
#
# Configuration (in order of priority):
#   1. Command-line args:  ./deploy.sh 192.168.1.100 22
#   2. Environment file:   .env (copy .env.example to get started)
#   3. Built-in defaults:  localhost:22
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORIGINAL_PATH="${PATH:-}"

# Load .env if present
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/.env"
fi

# Keep .env limited to deploy settings. A local .env that defines PATH should
# not hide Bun, uv/pixi, ssh, tar, or other required command-line tools.
PATH="${ORIGINAL_PATH}"
for dir in "${HOME}/.bun/bin" "${HOME}/.local/bin" "${HOME}/.pixi/bin"; do
  if [[ -d "${dir}" && ":${PATH}:" != *":${dir}:"* ]]; then
    PATH="${dir}:${PATH}"
  fi
done
export PATH

HA_IP="${1:-${HA_IP:-localhost}}"
SSH_PORT="${2:-${SSH_PORT:-22}}"
SSH_USER="${SSH_USER:-root}"
REMOTE_CONFIG="${REMOTE_CONFIG:-/config}"
BUN_BIN="${BUN_BIN:-}"

if [[ -n "${BUN_BIN}" && "${BUN_BIN}" != */* ]]; then
  BUN_NAME="${BUN_BIN}"
  if ! BUN_BIN="$(command -v "${BUN_NAME}")"; then
    echo "error: configured BUN_BIN is not on PATH: ${BUN_NAME}" >&2
    exit 1
  fi
elif [[ -z "${BUN_BIN}" ]]; then
  if BUN_BIN="$(command -v bun)"; then
    :
  elif [[ -x "${HOME}/.bun/bin/bun" ]]; then
    BUN_BIN="${HOME}/.bun/bin/bun"
  else
    echo "error: bun is required. Install Bun or set BUN_BIN=/absolute/path/to/bun in .env" >&2
    exit 1
  fi
fi

if [[ ! -x "${BUN_BIN}" ]]; then
  echo "error: BUN_BIN is not executable: ${BUN_BIN}" >&2
  exit 1
fi

# Suppress macOS resource fork files in tar
export COPYFILE_DISABLE=1

SSH_OPTS=(-p "${SSH_PORT}" -o StrictHostKeyChecking=no)
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS=(-i "${SSH_KEY}" "${SSH_OPTS[@]}")
SSH_BIN=(ssh)
if [[ -n "${SSHPASS:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "error: SSHPASS is set, but sshpass is not installed" >&2
    exit 1
  fi
  SSH_BIN=(sshpass -e ssh)
fi
SSH_CMD=("${SSH_BIN[@]}" "${SSH_OPTS[@]}")

remote_shell_quote() {
  local value=${1//\'/\'\\\'\'}
  printf "'%s'" "${value}"
}

# shellcheck disable=SC2016
REMOTE_PREPARE_SCRIPT='
set -eu
remote_config=$1
dest_parent="${remote_config}/custom_components"
dest="${remote_config}/custom_components/roommind"
run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@" || {
      echo "error: remote user is not root and passwordless sudo is unavailable" >&2
      exit 1
    }
  else
    echo "error: remote user is not root and sudo is unavailable" >&2
    exit 1
  fi
}
run_as_root mkdir -p "$dest_parent"
run_as_root rm -rf "$dest"
run_as_root mkdir -p "$dest"
'

# shellcheck disable=SC2016
REMOTE_EXTRACT_SCRIPT='
set -eu
remote_config=$1
dest="${remote_config}/custom_components/roommind"
if [ "$(id -u)" -eq 0 ]; then
  tar xzof - -C "$dest"
elif command -v sudo >/dev/null 2>&1; then
  sudo -n tar xzof - -C "$dest" || {
    echo "error: remote user is not root and passwordless sudo is unavailable" >&2
    exit 1
  }
else
  echo "error: remote user is not root and sudo is unavailable" >&2
  exit 1
fi
'
REMOTE_CONFIG_Q="$(remote_shell_quote "${REMOTE_CONFIG}")"
REMOTE_EXTRACT_SCRIPT_Q="$(remote_shell_quote "${REMOTE_EXTRACT_SCRIPT}")"

echo "==> Deploying RoomMind to ${SSH_USER}@${HA_IP}:${SSH_PORT}"

# 1. Build frontend
echo "--- Building frontend with Bun ---"
(
  cd "${SCRIPT_DIR}/frontend"
  "${BUN_BIN}" install --frozen-lockfile
  "${BUN_BIN}" run build
)
echo "    OK"

# 2. Deploy integration (backend + frontend bundle)
echo "--- Deploying integration ---"
# shellcheck disable=SC2029
"${SSH_CMD[@]}" "${SSH_USER}@${HA_IP}" "sh -s -- ${REMOTE_CONFIG_Q}" <<<"${REMOTE_PREPARE_SCRIPT}"
# shellcheck disable=SC2029
tar czf - \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='*.pyo' \
  --exclude='.DS_Store' \
  --exclude='*.map' \
  -C "${SCRIPT_DIR}/custom_components/roommind" . | \
  "${SSH_CMD[@]}" "${SSH_USER}@${HA_IP}" "sh -c ${REMOTE_EXTRACT_SCRIPT_Q} deploy-extract ${REMOTE_CONFIG_Q}"
echo "    OK"

echo ""
echo "==> Done! Next steps:"
echo "    - Python changes:        Settings → Integrations → RoomMind → ⋮ → Reload"
echo "    - Frontend changes:      Hard-refresh browser (Cmd+Shift+R / Ctrl+Shift+R)"
echo "    - WS schema / manifest:  Full HA restart (Settings → System → Restart)"
