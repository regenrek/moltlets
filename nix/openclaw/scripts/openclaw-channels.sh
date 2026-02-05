#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  openclaw-channels --gateway <gatewayId> <login|logout|status|capabilities> [args...]

Runs `openclaw channels ...` for a gateway using the same Environment/EnvironmentFile
as the systemd service `openclaw-<gatewayId>.service`, executed as the gateway user.
USAGE
}

gateway_id=""
if [[ "${1:-}" == "--gateway" ]]; then
  gateway_id="${2:-}"
  shift 2 || true
fi

if [[ -z "${gateway_id}" ]]; then
  echo "error: missing --gateway" >&2
  usage
  exit 2
fi
if ! [[ "${gateway_id}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "error: invalid gateway id: ${gateway_id}" >&2
  exit 2
fi

subcmd="${1:-}"
shift || true

case "${subcmd}" in
  login|logout|status|capabilities) ;;
  *)
    echo "error: invalid channels subcommand: ${subcmd}" >&2
    usage
    exit 2
    ;;
esac

unit="openclaw-${gateway_id}.service"

user="$(systemctl show "${unit}" -p User --value || true)"
group="$(systemctl show "${unit}" -p Group --value || true)"
workdir="$(systemctl show "${unit}" -p WorkingDirectory --value || true)"
environment_raw="$(systemctl show "${unit}" -p Environment --value || true)"
envfiles_raw="$(systemctl show "${unit}" -p EnvironmentFile --value || true)"

if [[ -z "${user}" || -z "${group}" ]]; then
  echo "error: missing systemd User/Group for ${unit}" >&2
  exit 1
fi
if [[ -z "${workdir}" ]]; then
  workdir="/"
fi

if [[ -z "${environment_raw}" ]]; then
  echo "error: missing systemd Environment for ${unit}" >&2
  exit 1
fi
if [[ "${environment_raw}" != *"OPENCLAW_CONFIG_PATH="* || "${environment_raw}" != *"OPENCLAW_STATE_DIR="* ]]; then
  echo "error: missing OPENCLAW_CONFIG_PATH/OPENCLAW_STATE_DIR in ${unit} Environment" >&2
  exit 1
fi

systemd_run="/run/current-system/sw/bin/systemd-run"
openclaw="/run/current-system/sw/bin/openclaw"

if [[ ! -x "${systemd_run}" ]]; then
  echo "error: missing ${systemd_run}" >&2
  exit 1
fi
if [[ ! -x "${openclaw}" ]]; then
  echo "error: missing ${openclaw}" >&2
  exit 1
fi

cmd=(
  "${systemd_run}"
  --collect
  --wait
  --pipe
  --quiet
  --uid "${user}"
  --gid "${group}"
  --property "WorkingDirectory=${workdir}"
)

cmd+=(--property "Environment=${environment_raw}")
if [[ -n "${envfiles_raw}" ]]; then
  cmd+=(--property "EnvironmentFile=${envfiles_raw}")
fi

cmd+=(-- "${openclaw}" channels "${subcmd}" "$@")

exec "${cmd[@]}"
