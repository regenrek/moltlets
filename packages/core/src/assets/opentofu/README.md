# OpenTofu provider assets

Clawlets stores provider OpenTofu assets under:

- `providers/hetzner/`
- `providers/aws/` (scaffold until aws driver is implemented)

Runtime state dir:

- `.clawlets/infra/opentofu/<host>/providers/<provider>/**`

Notes:
- State is provider-scoped to avoid cross-provider state collisions.
- Policy (recommended): single operator at a time; always `plan` before `apply`.
- Preferred workflow: use the CLI (`clawlets bootstrap` / `clawlets infra apply`) so vars/outputs match what the rest of the repo expects.

Manual runs (debugging):

```bash
nix run --impure nixpkgs#opentofu -- -chdir=.clawlets/infra/opentofu/<host> init
nix run --impure nixpkgs#opentofu -- -chdir=.clawlets/infra/opentofu/<host> plan
nix run --impure nixpkgs#opentofu -- -chdir=.clawlets/infra/opentofu/<host> apply
```
