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

common_dir="${seed_root}/common"
gateway_dir="${seed_root}/gateways/${gateway_id}"

sync_overlay_dir() {
  local rel="$1"
  local dst="$2"

  local tmp_root=""
  tmp_root="$(mktemp -d)"
  mkdir -p "${tmp_root}/out"

  if [[ -d "${common_dir}/${rel}" ]]; then
    cp -a "${common_dir}/${rel}/." "${tmp_root}/out/"
  fi
  if [[ -d "${gateway_dir}/${rel}" ]]; then
    cp -a "${gateway_dir}/${rel}/." "${tmp_root}/out/"
  fi

  if [[ -e "${dst}" || -L "${dst}" ]]; then
    rm -rf "${dst}"
  fi
  mkdir -p "$(dirname "${dst}")"
  mv "${tmp_root}/out" "${dst}"
  rm -rf "${tmp_root}"
}

pick_src() {
  local name="$1"
  if [[ -f "${gateway_dir}/${name}" ]]; then
    printf '%s\n' "${gateway_dir}/${name}"
    return 0
  fi
  if [[ -f "${common_dir}/${name}" ]]; then
    printf '%s\n' "${common_dir}/${name}"
    return 0
  fi
  return 1
}

managed=(
  "AGENTS.md"
  "SOUL.md"
  "IDENTITY.md"
  "TOOLS.md"
  "USER.md"
  "HEARTBEAT.md"
)

for name in "${managed[@]}"; do
  if src="$(pick_src "${name}")"; then
    cp -f "${src}" "${ws}/${name}"
  fi
done

# Custom/local skills: keep canonical skill trees in the repo and sync them into each workspace.
# Expected shape:
# - <seed_root>/common/skills/<skill>/SKILL.md
# - <seed_root>/gateways/<gateway>/skills/<skill>/SKILL.md
sync_overlay_dir "skills" "${ws}/skills"

if [[ -f "${ws}/TOOLS.md" && -r "${tools_md}" ]]; then
  if ! grep -q 'clawlets-tools:begin' "${ws}/TOOLS.md"; then
    {
      printf '\n<!-- clawlets-tools:begin -->\n'
      cat "${tools_md}"
      printf '\n<!-- clawlets-tools:end -->\n'
    } >>"${ws}/TOOLS.md"
  fi
fi
