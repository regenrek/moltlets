# __PROJECT_NAME__

This repo is your fleet config (public-safe).

- Config: `fleet/clawlets.json`
- Secrets: `secrets/` (sops-encrypted; safe to commit)
- Runtime: `.clawlets/` (gitignored; operator keys + nixos-anywhere extra-files)

Quickstart
1) install `clawlets` (global)
2) set host basics: `clawlets host set --admin-cidr <your-ip>/32 --disk-device /dev/sda --add-ssh-key-file $HOME/.ssh/id_ed25519.pub --enable true`
3) `clawlets env init` (set `HCLOUD_TOKEN` in `.clawlets/env`)
4) `clawlets secrets init --host <host>` (fills `.clawlets/secrets.json`)
5) `clawlets secrets init --host <host> --from-json .clawlets/secrets.json --yes`
6) `clawlets doctor --scope bootstrap`
7) `clawlets bootstrap`
8) join tailnet, then: `clawlets host set --target-host admin@<tailscale-ip>` then `clawlets server update apply --host <host>` and `clawlets lockdown`

Docs: https://docs.clawlets.com

Updates
- `flake.lock` pins `clawlets` and `nix-openclaw`; use the repo’s `bump-clawlets` and `bump-nix-openclaw` PRs to stay current.
- Recommended (Path 1): publish signed desired-state manifests to GitHub Pages (gh-pages branch):
  - enable Pages: Settings → Pages → Deploy from branch → `gh-pages` / root
  - add Actions secret: `MINISIGN_PRIVATE_KEY` (contents of `minisign.key`, generated via `minisign -G -n`)
  - run workflow: `updates: publish` (writes `deploy/<host>/<channel>/<releaseId>.json` + `latest.json`)
  - promote workflow: `updates: promote` (staging → prod, no rebuild; new `releaseId`)

Safety
- `clawlets project init` installs git hooks to block plaintext secrets.
- Rules live in `.forbidden-paths.regex`; sops checks run on `secrets/*.yaml`.
