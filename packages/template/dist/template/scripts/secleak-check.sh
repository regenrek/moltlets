#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing tool: $1" >&2
    exit 2
  fi
}

need gitleaks
need trivy

gitleaks git --no-banner --redact=100 --config .gitleaks.toml .
trivy fs --scanners secret,misconfig --exit-code 1 .
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
