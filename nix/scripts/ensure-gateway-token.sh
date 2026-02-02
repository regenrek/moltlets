#!/usr/bin/env bash
set -euo pipefail

out_env_file="${CLAWLETS_GATEWAY_ENV_FILE:-}"
bot_user="${CLAWLETS_BOT_USER:-}"
bot_group="${CLAWLETS_BOT_GROUP:-}"

if [[ -z "${out_env_file}" ]]; then
  echo "error: missing CLAWLETS_GATEWAY_ENV_FILE" >&2
  exit 2
fi
if [[ -z "${bot_user}" || -z "${bot_group}" ]]; then
  echo "error: missing CLAWLETS_BOT_USER / CLAWLETS_BOT_GROUP" >&2
  exit 2
fi

umask 077
out_dir="$(dirname "${out_env_file}")"
mkdir -p "${out_dir}"

if [[ -f "${out_env_file}" ]]; then
  chmod 0400 "${out_env_file}"
  chown "${bot_user}:${bot_group}" "${out_env_file}"
  exit 0
fi

tmp=""
cleanup() {
  if [[ -n "${tmp}" && -f "${tmp}" ]]; then
    rm -f "${tmp}"
  fi
}
trap cleanup EXIT

token="$(openssl rand -hex 32)"
if [[ -z "${token}" ]]; then
  echo "error: failed to generate token" >&2
  exit 1
fi

tmp="$(mktemp --tmpdir="${out_dir}" ".clawlets-gateway-token.XXXXXX")"
printf 'OPENCLAW_GATEWAY_TOKEN=%s\n' "${token}" >"${tmp}"
chown "${bot_user}:${bot_group}" "${tmp}"
chmod 0400 "${tmp}"
mv "${tmp}" "${out_env_file}"
tmp=""
