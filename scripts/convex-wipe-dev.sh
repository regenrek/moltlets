#!/usr/bin/env bash
set -euo pipefail

# Wipe (dev) Convex deployment data fast.
#
# This uses `convex import --replace` with an empty snapshot ZIP generated from
# `apps/web/convex/schema.ts`, so it wipes only the app's schema tables.
# It does NOT deploy/push code, so it's useful when schema validation is blocked
# by legacy rows that no longer match the current schema.
#
# Safety:
# - Refuses to run unless deployment starts with "dev:" (unless --allow-non-dev)
# - Requires explicit --yes
# - Uses your local Convex CLI access token (~/.convex/config.json) when present
#
# Usage:
#   ./scripts/convex-wipe-dev.sh --yes
#   ./scripts/convex-wipe-dev.sh --yes --env-file apps/web/.env.local
#   ./scripts/convex-wipe-dev.sh --yes --allow-non-dev
#   ./scripts/convex-wipe-dev.sh --yes --replace-all

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

YES=0
ALLOW_NON_DEV=0
REPLACE_ALL=0
ENV_FILE="$ROOT_DIR/apps/web/.env.local"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      YES=1
      shift
      ;;
    --allow-non-dev)
      ALLOW_NON_DEV=1
      shift
      ;;
    --replace-all)
      REPLACE_ALL=1
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '1,120p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

if [[ $YES -ne 1 ]]; then
  echo "Refusing to wipe without --yes" >&2
  exit 2
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 2
fi

# Normalize env-file to an absolute path so it remains valid even when we `cd`.
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

DEPLOYMENT="$(node "$ROOT_DIR/scripts/convex-wipe-dev.mjs" --print-deployment --env-file "$ENV_FILE")"
if [[ -z "$DEPLOYMENT" ]]; then
  echo "Could not determine CONVEX_DEPLOYMENT from: $ENV_FILE" >&2
  exit 2
fi

if [[ $ALLOW_NON_DEV -ne 1 ]] && [[ "$DEPLOYMENT" != dev:* ]]; then
  echo "Refusing to wipe non-dev deployment: $DEPLOYMENT" >&2
  echo "If you really mean it, pass --allow-non-dev." >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ZIP_PATH="$TMP_DIR/empty-snapshot.zip"

node "$ROOT_DIR/scripts/convex-wipe-dev.mjs" \
  --make-empty-snapshot-zip "$ZIP_PATH" \
  --schema "$ROOT_DIR/apps/web/convex/schema.ts"

echo "Wiping deployment: $DEPLOYMENT"
echo "Env file: $ENV_FILE"
echo "Tables (from schema.ts):"
node "$ROOT_DIR/scripts/convex-wipe-dev.mjs" --print-tables --schema "$ROOT_DIR/apps/web/convex/schema.ts" | sed 's/^/  /'

IMPORT_MODE=(--replace)
if [[ $REPLACE_ALL -eq 1 ]]; then
  IMPORT_MODE=(--replace-all)
fi

ACCESS_TOKEN="$(node "$ROOT_DIR/scripts/convex-wipe-dev.mjs" --print-access-token || true)"
if [[ -n "$ACCESS_TOKEN" ]]; then
  export CONVEX_OVERRIDE_ACCESS_TOKEN="$ACCESS_TOKEN"
fi
export CONVEX_DEPLOYMENT="$DEPLOYMENT"

set +e
(cd "$ROOT_DIR/apps/web" && npx convex import "${IMPORT_MODE[@]}" --yes "$ZIP_PATH")
status=$?
set -e

if [[ $status -ne 0 ]]; then
  echo "" >&2
  echo "Import failed (exit $status)." >&2
  echo "If you see MissingAccessToken / 401 Unauthorized, authenticate once with:" >&2
  echo "  (cd \"$ROOT_DIR/apps/web\" && npx convex dev --once)" >&2
  echo "Or set CONVEX_DEPLOY_KEY to a dev deploy key, e.g.:" >&2
  echo "  CONVEX_DEPLOY_KEY='dev:...|...' ./scripts/convex-wipe-dev.sh --yes" >&2
  exit $status
fi

echo "Done. Deployment wiped: $DEPLOYMENT"

