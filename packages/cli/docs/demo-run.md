# Demo Run: Hetzner + Discord (Golden Path)

## Prerequisites

- Nix installed (`nix --version`)
- Hetzner Cloud API Token
- Tailscale Auth Key (reusable + ephemeral recommended)
- Discord Bot Token (+ bot invited to demo server)

## Golden Path

```bash
# Scaffold repo
clawlets project init --dir demo-fleet --host clawlets-openclaw --gitInit
cd demo-fleet

# Deploy creds (edit OFF-SCREEN 🔒)
clawlets env init
# edit .clawlets/env:
#   HCLOUD_TOKEN=... 🔒

# Host config (Hetzner)
clawlets host set --host clawlets-openclaw \
  --enable true \
  --server-type cx22 \
  --hetzner-location nbg1 \
  --disk-device /dev/sda \
  --ssh-exposure bootstrap \
  --tailnet tailscale \
  --ssh-pubkey-file ~/.ssh/id_ed25519.pub

# Gateway + Discord config
clawlets gateway add --host clawlets-openclaw --gateway main
clawlets config set --path hosts.clawlets-openclaw.gateways.main.channels.discord.enabled --value-json true
clawlets config set --path hosts.clawlets-openclaw.gateways.main.channels.discord.groupPolicy --value open
clawlets config set --path hosts.clawlets-openclaw.gateways.main.channels.discord.token --value '${DISCORD_BOT_TOKEN}'

# Wire secrets + init (cut/blur this segment 🔒)
clawlets config wire-secrets --host clawlets-openclaw --write
clawlets secrets init --host clawlets-openclaw --scope all --interactive

# Gate + bootstrap
clawlets doctor --scope bootstrap --strict
clawlets bootstrap --host clawlets-openclaw

# After bootstrap: switch SSH to tailnet (get 100.x from `tailscale status`)
clawlets host set --host clawlets-openclaw --target-host admin@100.x.y.z
clawlets host set --host clawlets-openclaw --ssh-exposure tailnet
clawlets server update apply --host clawlets-openclaw

# Lockdown (remove public SSH via Hetzner firewall)
clawlets lockdown --host clawlets-openclaw

# Enable OpenClaw gateway
clawlets host set --host clawlets-openclaw --openclaw-enable true
clawlets server update apply --host clawlets-openclaw

# Verify
clawlets server audit --host clawlets-openclaw
clawlets server status --host clawlets-openclaw
clawlets server logs --host clawlets-openclaw --unit openclaw-main.service --follow
clawlets server channels status --host clawlets-openclaw --gateway main --probe
```

## Alternative: auto-lockdown (shorter)

Replace the bootstrap + lockdown steps with:

```bash
clawlets bootstrap --host clawlets-openclaw --lockdownAfter
```

## Redaction checklist (video)

| What | Where visible | Redact? |
|------|--------------|---------|
| `HCLOUD_TOKEN` | `.clawlets/env` edit | YES |
| Tailscale auth key | `secrets init` prompt | YES |
| Admin password | `secrets init` prompt | YES |
| Discord bot token | `secrets init` prompt | YES |
| Server IPv4 | bootstrap output | Optional |
| Tailscale IP (100.x.y.z) | lockdown output | Optional |
