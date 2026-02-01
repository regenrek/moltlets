# CLI (`clawlets`)

Canonical source: `clawlets --help`.

Related
- `clf` is the bot-facing CLI (`clf jobs ...`). See `docs/orchestrator.md`.

## Core workflow

- project scaffold: `clawlets project init --dir ./clawlets-myproject`
- note: `project init` already includes `fleet/clawlets.json` (skip `clawlets config init` unless resetting with `--force`)
- template source defaults to `config/template-source.json` (repo + path + 40-hex ref); override with `--template`, `--template-path`, `--template-ref`
- set fleet guild id: `clawlets fleet set --guild-id <id>`
- add bots: `clawlets bot add --bot <id>`
- harden Clawdbot config (optional): `clawlets clawdbot harden` (dry-run) / `clawlets clawdbot harden --write`
- set host basics: `clawlets host set --add-ssh-key-file ~/.ssh/id_ed25519.pub --disk-device /dev/sda --enable true`
- set SSH exposure for bootstrap: `clawlets host set --ssh-exposure bootstrap`
- init secrets: `clawlets secrets init` (TTY defaults to interactive; non-interactive uses `--from-json .clawlets/secrets.json`)
- preflight: `clawlets doctor --scope bootstrap`
- updates gate: `clawlets doctor --scope updates --strict`
- bootstrap: `clawlets bootstrap`
- image build (optional): `clawlets image build --host <host>`
- image upload (optional): `clawlets image upload --host <host> --image-url <url>`
- bootstrap (image): `clawlets bootstrap --mode image`
- set target host: `clawlets host set --target-host admin@<tailscale-ip>`
- set SSH exposure to tailnet: `clawlets host set --ssh-exposure tailnet`
- lockdown: `clawlets lockdown`

## Server ops

- status: `clawlets server status --target-host <host>`
- audit (includes `clawdbot security audit`): `clawlets server audit --host <host>` (or `--target-host <ssh-alias>`)
- logs: `clawlets server logs --target-host <host> --unit clawdbot-melinda.service --since 10m --follow`
- restart: `clawlets server restart --target-host <host> --unit clawdbot-melinda.service`
- release manifest: `clawlets release manifest build --host <host> --channel prod --release-id <releaseId> --out deploy/<host>/prod/<releaseId>.json`
- sign manifest: `clawlets release manifest sign --in deploy/<host>/prod/<releaseId>.json`
- pointer: `clawlets release pointer write --release-id <releaseId> --out deploy/<host>/prod/latest.json`
- apply updates: `clawlets server update apply --host <host>`
- GitHub sync timers: `clawlets server github-sync status --target-host <host>`
- GitHub sync run: `clawlets server github-sync run --target-host <host> --bot melinda`
- GitHub sync logs: `clawlets server github-sync logs --target-host <host> --bot melinda --follow`
- GitHub sync snapshot: `clawlets server github-sync show --target-host <host> --bot melinda --kind prs`

## Infra ops

- provisioning apply: `clawlets infra apply`

## Justfile shortcuts

Run `just --list`.
