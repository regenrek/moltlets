# OpenTofu (Hetzner) — infra state

Clawdlets uses OpenTofu for Hetzner provisioning (runtime state dir: `.clawdlets/infra/opentofu/**`).

Notes:
- State lives in `.clawdlets/infra/opentofu/terraform.tfstate` (gitignored).
- Policy (recommended): single operator at a time; always `plan` before `apply`.
- Preferred workflow: use the CLI (`clawdlets bootstrap` / `clawdlets infra apply`) so vars/outputs match what the rest of the repo expects.

Manual runs (debugging):

```bash
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu init
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu plan
nix run --impure nixpkgs#opentofu -- -chdir=.clawdlets/infra/opentofu apply
```
