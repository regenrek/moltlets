set shell := ["zsh", "-lc"]

default:
  @just --list

install:
  cd {{justfile_directory()}} && pnpm install

build:
  cd {{justfile_directory()}} && pnpm run build

test:
  cd {{justfile_directory()}} && pnpm run test

typecheck:
  cd {{justfile_directory()}} && pnpm run typecheck

clawlets-build:
  cd {{justfile_directory()}} && pnpm run clawlets:build

doctor:
  cd {{justfile_directory()}} && pnpm run clawlets:doctor

bootstrap +args="":
  cd {{justfile_directory()}} && pnpm run clawlets:bootstrap -- {{args}}

clawlets-lockdown +args="":
  cd {{justfile_directory()}} && pnpm run clawlets:lockdown -- {{args}}

tofu-lockdown:
  cd {{justfile_directory()}} && pnpm run clawlets:infra -- apply

config-validate:
  cd {{justfile_directory()}} && node packages/cli/dist/main.mjs config validate

config-show:
  cd {{justfile_directory()}} && node packages/cli/dist/main.mjs config show

secrets-init host="clawdbot-fleet-host":
  cd {{justfile_directory()}} && pnpm run clawlets:secrets -- init --host {{host}}

secrets-sync host="clawdbot-fleet-host":
  cd {{justfile_directory()}} && pnpm run clawlets:secrets -- sync --host {{host}}

infra-apply host="clawdbot-fleet-host":
  cd {{justfile_directory()}} && pnpm run clawlets:infra -- apply --host {{host}}

server-units target_host:
  cd {{justfile_directory()}} && pnpm run clawlets:server -- status --target-host {{target_host}}

server-health target_host since="15m":
  cd {{justfile_directory()}} && pnpm run clawlets:server -- logs --target-host {{target_host}} --since {{since}}

server-logs target_host args="":
  cd {{justfile_directory()}} && pnpm run clawlets:server -- logs --target-host {{target_host}} {{args}}

server-restart target_host args="":
  cd {{justfile_directory()}} && pnpm run clawlets:server -- restart --target-host {{target_host}} {{args}}

server-update-apply target_host args="":
  cd {{justfile_directory()}} && pnpm run clawlets:server -- update apply --target-host {{target_host}} {{args}}

nix-daemon-restart:
  ps -axo pid,command | rg 'nix-daemon' || true
  pids=$(ps -axo pid,command | rg 'nix-daemon' | awk '{print $1}' | tr '\n' ' ') && [ -n "$pids" ] && sudo kill $pids || true
  sleep 1
  ps -axo pid,command | rg 'nix-daemon' || true

clawlets-help:
  cd {{justfile_directory()}} && pnpm run clawlets:help

clawlets-dev-install:
  cd {{justfile_directory()}} && ./scripts/dev-install-clawlets-wrapper.sh

clean-node-modules:
  cd {{justfile_directory()}} && if command -v trash >/dev/null; then trash node_modules; else echo "error: trash not installed (brew install trash)"; exit 1; fi
