# TOOLS.md

Workspace-local operator notes (no secrets). This file is seeded by Nix on first boot.

## Skills (bundled) allowlist

Bundled skills are an attack surface. Keep an explicit allowlist per gateway:

- `fleet/clawlets.json` → `fleet.gateways.<id>.skills.allowBundled = [ ... ];`
- Avoid `null` on servers (typically means “allow all bundled skills”).

## Tool inventory (generated)

The host writes a generated tool inventory to:

- `/etc/clawlets/tools.md`

This workspace may also include an appended copy of that inventory below on first seed.
