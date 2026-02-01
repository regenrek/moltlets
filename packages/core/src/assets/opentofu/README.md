# OpenTofu (Hetzner) — infra state

Clawlets uses OpenTofu for Hetzner provisioning (runtime state dir: `.clawlets/infra/opentofu/<host>/**`).

Notes:
- State lives in `.clawlets/infra/opentofu/<host>/terraform.tfstate` (gitignored).
- Policy (recommended): single operator at a time; always `plan` before `apply`.
- Preferred workflow: use the CLI (`clawlets bootstrap` / `clawlets infra apply`) so vars/outputs match what the rest of the repo expects.

Manual runs (debugging):

```bash
nix run --impure nixpkgs#opentofu -- -chdir=.clawlets/infra/opentofu/<host> init
nix run --impure nixpkgs#opentofu -- -chdir=.clawlets/infra/opentofu/<host> plan
nix run --impure nixpkgs#opentofu -- -chdir=.clawlets/infra/opentofu/<host> apply
```
