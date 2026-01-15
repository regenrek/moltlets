# Upstream tracking (nix-clawdbot)

We consume `nix-clawdbot` upstream; we do not re-implement its features here.

## Update procedure

### Option A: automated weekly bump PR (recommended)

This repo has a scheduled workflow that bumps `flake.lock` for `nix-clawdbot` and opens a PR.

- Review the PR like any other change (CI + secret scan required).
- If it breaks, close the PR (no impact) or revert the merge commit.

### Option B: manual bump (one-off)

1) Bump the input locally:

```bash
nix flake lock --update-input nix-clawdbot
```

2) Deploy on a staging host (pinned):

```bash
clawdlets server manifest --host <host> --out deploy-manifest.<host>.json
clawdlets server deploy --manifest deploy-manifest.<host>.json
```

3) Verify:
- gateway starts cleanly
- bot configs render
- no schema errors in logs
- discord routing works

## What to watch for

- Config schema changes (new/removed keys)
- Gateway flags or startup behavior
- Secrets/env expectations
- Skills/plugin wiring compatibility
