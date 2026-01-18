# Clawdbot config (passed through)

Clawdlets does not invent a second routing/channels schema. Use clawdbot’s config schema directly.

## Where to put config

- `fleet/clawdlets.json` → `fleet.bots.<bot>.clawdbot` (raw clawdbot config object)

Clawdlets invariants always win:

- `gateway.bind` / `gateway.port`
- `gateway.auth` (always enabled)
- `agents.defaults.workspace`

## Secrets

Never commit plaintext tokens into config.

Files under `documentsDir` are copied into the Nix store during deploy. Treat them as public:
do **not** place secrets in `fleet/workspaces/**`.

Use explicit secret names in `fleet/clawdlets.json` and let Nix inject them:

- Discord: `fleet.bots.<bot>.profile.discordTokenSecret = "<secretName>"`
- Model providers: `fleet.modelSecrets.<provider> = "<secretName>"`

Example (Discord token):

```json
{
  "fleet": {
    "bots": {
      "maren": {
        "profile": { "discordTokenSecret": "discord_token_maren" },
        "clawdbot": {
          "channels": { "discord": { "enabled": true } }
        }
      }
    }
  }
}
```
