# Going public (safe)

Goal: publish repo without leaking:
- SSH keys / WireGuard peers / IPs / guild IDs
- Tokens (Discord/Hetzner/GitHub/ZAI/etc)
- age keys / sops config

## Rules

- `.clawlets/` must never be tracked.
- Don’t commit plaintext tokens or private keys. Encrypted secrets live under `secrets/` (sops+age); local operator private keys stay in `.clawlets/`.
- Keep host-specific values out of `fleet/clawlets.json` before publishing (ship placeholders).

## Recommended process (no history)

1) Create a clean export from the project repo:

```bash
mkdir -p /tmp/clawlets-public
git archive --format=tar HEAD | tar -x -C /tmp/clawlets-public
cd /tmp/clawlets-public
git init
git add -A
git commit -m "chore: initial public import"
```

2) Run secret scanners (before pushing):
- trivy (misconfig/secret checks)

3) Add CI guardrails:
- fail if `.clawlets/**` is tracked
- fail if `infra/secrets/**` exists (legacy path; project repo should not use it)

## What users do in public repo

- run `CLAWLETS_INTERACTIVE=1 clawlets secrets init` → generates local operator keys + creates `secrets/` (encrypted) + generates `.clawlets/extra-files/<host>/...`
