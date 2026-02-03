# Changelog
All notable changes to this repository will be documented in this file.

The format is based on Keep a Changelog and this project follows SemVer for npm releases.

## Unreleased
### Added
- First-class typed gateway config surfaces (`channels`, `agents`, `hooks`, `skills`, `plugins`) across core/CLI/web/Nix.
- OpenClaw invariants/specs shared via JSON assets for Nix + core validation.
- Pinned upstream OpenClaw JSON Schema snapshot + deterministic TS type generation (Nix/CI guarded).

### Changed
- Bots are now host-scoped: `hosts.<host>.botsOrder` / `hosts.<host>.bots` replace `fleet.gatewayOrder` / `fleet.gateways` (schema bumped to v17; manual update required, no auto-migration).
- `fleet.codex.gateways` replaced by `fleet.codex.bots` (if used).
- Rename `clawdbot` → `openclaw` across config, CLI, docs, and Nix; schema bumped to v15 with migration path.
- Validate `hosts.<host>.bots.<bot>.openclaw` passthrough against pinned upstream schema (fail fast, full-path errors).

### Fixed
- Config batch validation now rejects ambiguous ops early; migration now moves legacy `openclaw.*` typed surfaces.
- Prevent bots/gateways from fan-out across all enabled hosts by enforcing host-scoped bot lists.

## [0.4.4] - 2026-02-01
### Added
- Add project-level **Security** area (tabs for API keys + SSH keys).
- Add agent detail pages (Overview/Logs/Settings/Skills), capability presets with schema-backed channel dropdown, and user settings page with logout.
- Add pinned schema diff helpers + config diff preview utilities for agent settings.

### Changed
- Replace default favicons with Clawlets branding (generated from `clawlets-icon.png`).
- Refine host settings UX by splitting into smaller “settings sections” and clarifying SSH connectivity vs SSH key management.
- Bootstrap UI: move post-bootstrap checklist below the bootstrap flow; simplify “deploy source” with Local vs Remote options and hide verbose git info behind a “Show details” toggle.
- Default web auth to Better Auth (remove legacy auth-disabled path) and enforce sign-in redirect.
- Regenerate pinned OpenClaw schema to include channel plugin schemas for capability selection.
- Move SSH keys from host scope to project scope (`fleet.sshAuthorizedKeys` / `fleet.sshKnownHosts`) and update migrations/UI accordingly.
- Rename clawdlets → clawlets across CLI, docs, templates, and runtime (`.clawlets/`).

### Fixed
- Allow `deploy` run kinds in web/Convex schema.
- Avoid config fetch failures during project creation and ensure template pin resolves to a `fleet/clawlets.json` root.

## [0.4.3] - 2026-01-26
### Fixed
- Publish only `clawlets` + `@clawlets/plugin-cattle` to npm; bundle internal workspace packages into dist to avoid broken installs.
- Keep CLF nix build workspace-scoped to avoid offline pnpm fetches outside the CLF workspace.

### Changed
- Simplify npm publish guardrails: block only local-protocol deps (`workspace:`/`file:`/`link:`) in prepared package.
- Simplify CLI asset copy step (no forced delete; overwrite in place).

### Docs
- Relax packaging sanity check to focus on local-protocol deps.

## [0.4.2] - 2026-01-26
### Fixed
- Fix `pnpm -g add clawlets` installs by removing `file:vendor/...` deps from published packages (rewrite `workspace:*` to real versions and publish required `@clawlets/*` packages to npm).

## [0.4.1] - 2026-01-25
### Fixed
- Ensure npm release fails fast if vendored workspace deps are missing (prevents broken `file:vendor/...` installs).

### Docs
- Document vendoring behavior and add a packaging sanity check for hotfix releases.

## [0.4.0] - 2026-01-25
### Breaking
- Config schema bumped to v9: replace `guildId` / `discordTokenSecret` / `modelSecrets` with `secretEnv` + `secretFiles` (generic secret wiring).
- Package split: `@clawlets/core` cattle-related modules moved to `@clawlets/cattle-core`; shared utilities (identifiers, llm-provider-env) moved to `@clawlets/shared`.

### Changed
- Web setup: remove Providers/Models pages; configure channels via bot config + integrations UI.
- Nix runtime: inject secrets via per-bot env files + secret files (sops-nix templates/secrets); stop injecting secret values into clawdbot config.
- CLI: `server channels {status|capabilities|login|logout}` for stateful channel auth (e.g. WhatsApp).
- CLF build moved to Nix subflake (`nix/subflakes/clf`) with its own lock file; avoids hash update churn for non-cattle users.
- Bootstrap token TTL now uses single source of truth constant from `cattle-cloudinit` (max 15 min).
- Tailscale auth key expiry resolved at spawn time (not config load) to prevent stale fallback after 55 min.

### Fixed
- Core tests now import from `@clawlets/shared` / `@clawlets/cattle-core` (fixes CI breakage from package split).
- `cattle-run.sh` tolerates missing `expiresAt`/`oneTime` fields for backward compatibility with older control planes.
- CI hash updater uses `persist-credentials: false` and injects token only for push step (reduced credential exposure).

## [0.3.4] - 2026-01-21
### Fixed
- Update the pinned `clawlets-template` ref used by `clawlets project init` so new projects start from the latest template.

## [0.3.3] - 2026-01-21
### Fixed
- Ensure `/srv/clawdbot` (stateDirBase) is created via tmpfiles so gateway-token services can write credentials on fresh hosts under `ProtectSystem=strict`.

### Tests
- Add nix-eval regression test asserting tmpfiles create `stateDirBase` + per-bot state dirs (and that bot homes are isolated).

### CI
- Enable auto-merge for scheduled “bump” PRs.

## [0.3.2] - 2026-01-20
### Fixed
- Add repository metadata to the cattle plugin so npm OIDC provenance publish succeeds.

## [0.3.1] - 2026-01-20
### Fixed
- Auto-repair stale operator age public keys during `clawlets secrets init` to prevent recipient drift.
- Recover host age key from extra-files when encrypted host key cannot be decrypted.
- Add `secrets verify`/doctor preflight checks for operator recipient mismatch with a clear fix hint.

### Docs
- Add troubleshooting guidance for secrets init/verify when age keys drift.

## [0.3.0] - 2026-01-20
### Breaking
- Move cattle commands into the `@clawlets/plugin-cattle` plugin. Install via `clawlets plugin add cattle`.

### Added
- Plugin system with `clawlets plugin add|list|rm` and runtime dispatch.

## [0.2.5] - 2026-01-19
### Fixed
- Allow npm CLI builds (bundled dist) to locate the template-source config.

## [0.2.4] - 2026-01-19
### Fixed
- Resolve CLI package root so `clawlets --version` works after global installs.

## [0.2.3] - 2026-01-19
### Fixed
- Include bash in the gateway-token systemd unit path so the helper script runs on hosts.

## [0.2.2] - 2026-01-19
### Fixed
- Allow `clawlets config set` to repair invalid configs by applying the change before validation.

## [0.2.1] - 2026-01-19
### Fixed
- Handle null `fleet.modelSecrets` in Nix runtime env wiring (prevents eval failure during bootstrap).

## [0.2.0] - 2026-01-18
### Breaking
- Remove `envSecrets` indirection. Secrets now live in `fleet.modelSecrets` (provider → secret) and `fleet.bots.<bot>.profile.discordTokenSecret`. Config schema bumped to v8.
- Drop `fleet/workspaces/bots/<bot>/clawdbot.json5` `$include` path; clawdbot config is inline only.

## [0.1.1] - 2026-01-18

### Added
- Base flake resolution: `fleet/clawlets.json.baseFlake` (fallback: `git remote origin`) used by deploy commands (`bootstrap`, `lockdown`).
- Non-interactive secrets provisioning: `clawlets secrets init --from-json <path|->`.
- Fleet-level secret env wiring: `fleet/clawlets.json.fleet.envSecrets` (env var → sops secret name), used for LLM API keys.
- New docs: `apps/docs/content/docs/configuration/config.mdx` (canonical config + host knobs).
- Doctor check: `discord routing` now verifies `fleet.guildId` and per-bot `fleet.routingOverrides.<bot>.channels` to prevent “silent” bots.
- `clawlets bootstrap --force` skips doctor preflight gate (advanced usage).
- Destroy command: `clawlets infra destroy` (with `--force` for non-interactive automation).
- Local deploy creds: `clawlets env init` + `clawlets env show` (default env file: `.clawlets/env`).
- Cache-only updates flow: `clawlets server update apply` (trigger fetch+apply) via signed desired-state manifest.
- Host deploy entrypoints: `/etc/clawlets/bin/install-secrets` + `/etc/clawlets/bin/switch-system` (sudo allowlist via `clawlets.operator.deploy`).
- Authenticated cache support: `clawlets.cache.netrc.*` (netrc + narinfo TTL).
- CI workflows: build+publish signed desired-state manifests (GitHub Pages).
- Manifest signing support in CI (minisign) + self-update signature verification.
- Release manifest commands: `clawlets release manifest build|sign|verify`.
- Self-update module: `clawlets.selfUpdate.*` (baseUrl + keys + timer).
- Image pipeline: `nixos-generators` outputs (`<host>-image`), `clawlets image build|upload`, and `bootstrap --mode image`.
- Hetzner image/location config fields (`hosts.<host>.hetzner.image/location`).
- Separate template repo (`regenrek/clawlets-template`) with CI checks for generated projects.
- Cattle mode (Hetzner): `clawlets cattle spawn|list|destroy|reap|logs|ssh` (ephemeral single-task VMs).
- ClawletFleet control plane (`clf`): sqlite-backed jobs queue + unix-socket orchestrator + CLI for bot-driven orchestration.
- Cattle secrets channel: one-time bootstrap token + tailnet-only HTTP endpoint to fetch runtime env (no long-lived LLM keys in Hetzner user_data).

### Changed
- Workflow automation: `nix-clawdbot` bump PRs are created using a GitHub App token (so normal PR checks run) and are compatible with strict branch protection.
- Repo layout: runtime state is `.clawlets/` (gitignored); repo-canonical secrets are sops-encrypted in `secrets/`.
- Config schema bump: `fleet/clawlets.json` schemaVersion `5` (replace `publicSsh/provisioning` with `sshExposure.mode` as the single SSH exposure policy).
- OpenTofu firewall rules now follow `sshExposure.mode` and separate baseline vs SSH exposure firewalls.
- CLI flag rename: `--stack-dir` → `--runtime-dir`.
- Secrets init JSON: replaces `zAiApiKey` with `secrets.<secretName>` map.
- Doctor UX: output grouped by scope/category with status coloring; add `clawlets doctor --show-ok` to include ok checks.
- Server ops: `server logs|status|audit` now use sudoers-compatible `systemctl`/`journalctl` invocation order; `server logs` defaults to `-n 200` and adds `--lines`.
- Secrets sync now uses the allowlisted `install-secrets` host entrypoint (no `sudo sh -lc`).
- SSH capture: `sshCapture(..., { tty: true })` now actually allocates a TTY (fixes `ssh: Pseudo-terminal will not be allocated...` for capture use-cases).
- Doctor gate split into `bootstrap` vs `updates`; `server update apply`/`lockdown` no longer require Hetzner creds or nixos-anywhere extra-files.
- Garnix config now explicitly builds `packages.x86_64-linux.*-system`.
- Secrets tar digest is now deterministic (canonical tar+gzip).
- Project init now pulls templates from `regenrek/clawlets-template` (no embedded template dist in this repo).

### Fixed
- Nix build for `packages.x86_64-linux.clf` (layout + symlinks) so Garnix packaging succeeds.
- Orchestrator hardening: safer bearer parsing, no cleartext env logging, no stacktrace exposure in error responses.

### Removed
- Stack concept + `clawlets stack` command.
- `clawlets secrets migrate` and stack docs.
- `clawlets server rebuild` and `/etc/clawlets/bin/rebuild-host` (replaced by cache-only deploy flow).
- Embedded template package (`packages/template`) and base-repo `garnix.yaml`.

## [0.1.0] - 2026-01-11
### Added
- Canonical config: `fleet/clawlets.json` (single source of truth) + CLI subcommands (`config`, `host`, `fleet`).
- CLI-first project scaffolding (`clawlets project init`) using the embedded template package.
- Supply-chain hardening: Dependabot (npm + GitHub Actions), pinned GitHub Actions by SHA, TruffleHog secret scanning workflow.
- Local security gate: `scripts/secleak-check.sh` (gitleaks + trivy).
- npm publishing via GitHub Actions Trusted Publishing (OIDC) + release automation docs/scripts.

### Changed
- Nix flake now derives `nixosConfigurations` from `fleet/clawlets.json` hosts list (multi-host ready).
- Default UX: non-interactive unless `--interactive` / `CLAWLETS_INTERACTIVE=1`.
- Docs updated to be CLI-first (no manual Nix edits; `fleet.nix` treated as derived output).

### Removed
- Legacy Nix template generation from the codebase (no more “render/ensure templates” path).
- Legacy `@clawlets/core` setup export + tests (unused).

## [0.0.0] - 2026-01-10
### Added
- ai-stack alignment: seeded `fleet/workspaces/common/` (AGENTS/SOUL/TOOLS/IDENTITY) and documented usage.
- Codex CLI support on server with per-bot headless login docs (gunnar + maren).
- Upstream tracking doc for `nix-clawdbot` updates.

### Changed
- Fleet config refactor to base/override pattern.
- Fleet module options extended with `documentsDir`, `identity`, and `codex` controls.
- Documentation updated for monorepo paths and operational guidance.
- Tests expanded for doctor/setup; coverage now above 80% across core package metrics.
