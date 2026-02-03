#!/usr/bin/env bash
set -euo pipefail

gateway="${1:-}"
kind="${2:-}"
lines="${3:-}"

usage() {
  echo "usage: gh-sync-read <gateway> <prs|issues> [lines]" >&2
}

if [ -z "$gateway" ] || [ -z "$kind" ]; then
  usage
  exit 2
fi

if ! [[ "$gateway" =~ ^[a-z][a-z0-9_-]*$ ]]; then
  echo "gh-sync-read: invalid gateway id: $gateway" >&2
  exit 2
fi

case "$kind" in
  prs) file="prs.md" ;;
  issues) file="issues.md" ;;
  *)
    echo "gh-sync-read: invalid kind: $kind" >&2
    usage
    exit 2
    ;;
esac

cfg="/run/secrets/rendered/openclaw-${gateway}.json"
if [ ! -r "$cfg" ]; then
  echo "gh-sync-read: missing config: $cfg" >&2
  exit 1
fi

workspace="$(jq -r '.agents.defaults.workspace // empty' "$cfg")"
if [ -z "$workspace" ]; then
  echo "gh-sync-read: missing agents.defaults.workspace in $cfg" >&2
  exit 1
fi

path="${workspace}/memory/github/${file}"
if [ ! -r "$path" ]; then
  echo "gh-sync-read: missing snapshot: $path" >&2
  exit 1
fi

if [ -n "$lines" ]; then
  if ! [[ "$lines" =~ ^[0-9]+$ ]] || [ "$lines" -le 0 ]; then
    echo "gh-sync-read: invalid lines: $lines" >&2
    exit 2
  fi
  head -n "$lines" "$path"
else
  cat "$path"
fi
