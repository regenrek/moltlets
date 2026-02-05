#!/usr/bin/env bash
set -euo pipefail

ws="${CLAWLETS_WORKSPACE_DIR:-}"
seed_root="${CLAWLETS_SEED_DIR:-}"
gateway_id="${CLAWLETS_GATEWAY_ID:-}"
tools_md="${CLAWLETS_TOOLS_MD:-/etc/clawlets/tools.md}"

if [[ -z "${ws}" || -z "${seed_root}" || -z "${gateway_id}" ]]; then
  echo "error: CLAWLETS_WORKSPACE_DIR, CLAWLETS_SEED_DIR, and CLAWLETS_GATEWAY_ID must be set" >&2
  exit 2
fi

if [[ ! -d "${ws}" ]]; then
  echo "error: workspace dir missing: ${ws}" >&2
  exit 2
fi

if [[ ! -d "${seed_root}" ]]; then
  echo "error: seed dir missing: ${seed_root}" >&2
  exit 2
fi

if find "${ws}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
  exit 0
fi

common_dir="${seed_root}/common"
gateway_dir="${seed_root}/gateways/${gateway_id}"

srcs=()
if [[ -d "${common_dir}" ]]; then
  srcs+=("${common_dir}")
fi
if [[ -d "${gateway_dir}" ]]; then
  srcs+=("${gateway_dir}")
fi

if [[ "${#srcs[@]}" -eq 0 ]]; then
  echo "error: seed dir has no overlay sources (expected ${seed_root}/common and/or ${seed_root}/gateways/${gateway_id})" >&2
  exit 2
fi

for src in "${srcs[@]}"; do
  cp -a "${src}/." "${ws}/"
done

if [[ -f "${ws}/TOOLS.md" && -r "${tools_md}" ]]; then
  if ! grep -q 'clawlets-tools:begin' "${ws}/TOOLS.md"; then
    {
      printf '\n<!-- clawlets-tools:begin -->\n'
      cat "${tools_md}"
      printf '\n<!-- clawlets-tools:end -->\n'
    } >>"${ws}/TOOLS.md"
  fi
fi
