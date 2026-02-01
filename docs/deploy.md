# Deploy / Updates (cache-only)

Goal: keep the **repo public-safe** (no plaintext secrets) and keep local operator private keys in `.clawlets/` (gitignored).

## Recommended: CI build + cache-only deploy

**Principle:** the host never evaluates a flake from GitHub. It only:

- downloads signed store paths from trusted caches (Garnix, optionally Attic)
- installs encrypted secrets to `/var/lib/clawlets/secrets/hosts/<host>`
- switches to a prebuilt NixOS system closure by store path

### CI build + release manifest (v1)

Build the host system output (per host):

```bash
nix build .#packages.x86_64-linux.<host>-system
```

Garnix is the canonical builder for `packages.x86_64-linux.<host>-system` (derived from `nixosConfigurations.<host>.config.system.build.toplevel`).

Generate a signed desired-state release manifest:

```bash
clawlets release manifest build --host <host> --channel prod --system x86_64-linux --release-id <n> --out deploy/<host>/prod/<n>.json
clawlets release manifest sign --in deploy/<host>/prod/<n>.json
clawlets release pointer write --release-id <n> --out deploy/<host>/prod/latest.json
clawlets release manifest sign --in deploy/<host>/prod/latest.json
```

Manifest format (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "host": "<host>",
  "system": "x86_64-linux",
  "channel": "prod",
  "releaseId": 123,
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "rev": "<40-hex-sha>",
  "toplevel": "/nix/store/<hash>-nixos-system-<host>-<version>",
  "secrets": {
    "digest": "<sha256>",
    "format": "sops-tar",
    "url": "secrets/<digest>.tgz"
  }
}
```

### GitOps (CI)

Recommended: use the built-in workflow shipped by the project template (in your project repo):

- `.github/workflows/updates-publish.yml` writes `deploy/<host>/<channel>/<releaseId>.json`, signs it, and publishes to GitHub Pages (including `latest.json` pointer).
- It also publishes an encrypted secrets bundle at `deploy/<host>/<channel>/secrets/<digest>.tgz` and pins it in the manifest (`secrets.url`).

If you publish to GitHub Pages, enable it in your project repo:
- Settings → Pages → Source: Deploy from a branch
- Branch: `gh-pages` / root

Required for signed manifests:
- `MINISIGN_PRIVATE_KEY` (passwordless; generated with `minisign -G -n`)

Optional: set GitHub environment protection rules for `prod` to require approvals.

Promote without rebuild (manual, approved):

- publish once to `staging`, then publish a new `prod` manifest pointing at the same `toplevel` (new `releaseId`).

### Apply now (operator)

```bash
clawlets server update apply --host <host>
```

This triggers `systemctl start clawlets-update-fetch.service` on the host (fetches pointer+manifest, verifies signature, then applies).

### Self-update (pull-based)

Enable on a host to pull a manifest and switch by store path:

```nix
clawlets.selfUpdate.enable = true;
clawlets.selfUpdate.baseUrls = [ "https://<pages>/deploy/<host>/prod" ];
clawlets.selfUpdate.channel = "prod";
clawlets.selfUpdate.publicKeys = [ "<minisign-pubkey>" ];
```

Secrets behavior:

- `secrets.digest` is the sha256 of the published secrets bundle bytes (the bundle contains **sops-encrypted** `.yaml` files).
- If `secrets.url` is set and installed secrets don't match `secrets.digest`, the updater downloads the bundle, verifies sha256, installs it, then proceeds.
- `secrets.url` may be an absolute `https://...` URL or a relative path (resolved against `selfUpdate.baseUrls`; first success wins).
- Secrets are never placed in the Nix store (downloaded to `/var/lib/clawlets/updates/`, installed into `/var/lib/clawlets/secrets/hosts/<host>`).

Signature workflow:

1) Generate keypair locally (passwordless for CI):

```bash
minisign -G -n -p minisign.pub -s minisign.key
```

2) Store `minisign.key` as `MINISIGN_PRIVATE_KEY` in GitHub Actions secrets.
3) Copy the public key value into `fleet/clawlets.json` (`hosts.<host>.selfUpdate.publicKeys = [ "<...>" ]`).

Key management + rotation:

- **Where keys live**
  - CI signing key: GitHub Actions secret `MINISIGN_PRIVATE_KEY` (passwordless minisign secret key contents).
  - Host trust roots: `hosts.<host>.selfUpdate.publicKeys` (optionally plus `previousPublicKeys` with a validity window).
- **Rotate (planned)**
  1) Generate a new minisign keypair.
  2) Add the new public key to `hosts.<host>.selfUpdate.publicKeys` **alongside** the old key.
  3) Deploy so hosts trust both keys.
  4) Switch CI to sign with the new key.
  5) After a safe window, remove the old public key from `hosts.<host>.selfUpdate.publicKeys` and deploy again.
- **Optional safe mode (auto-expire old keys)**
  - Keep new keys in `hosts.<host>.selfUpdate.publicKeys`.
  - Put old keys into `hosts.<host>.selfUpdate.previousPublicKeys` and set `hosts.<host>.selfUpdate.previousPublicKeysValidUntil` (UTC).
- **Emergency revoke**
  - If a signing key is compromised, treat update trust as compromised. You must replace the trusted key on hosts (manual access / out-of-band channel may be required) and re-issue manifests signed by the new key.

### Secrets only (optional)

If you want to update secrets without switching:

```bash
clawlets secrets sync --rev <sha|HEAD>
```

## Cache configuration (host)

Public cache only (default): just add substituters + trusted keys.

Authenticated cache (private Garnix / Attic / Harmonia / etc):

- set `hosts.<host>.cache.netrc.enable = true` in `fleet/clawlets.json`
- provide `/etc/nix/netrc` via sops secret (`hosts.<host>.cache.netrc.secretName`)
- set `hosts.<host>.cache.netrc.narinfoCachePositiveTtl` to match your cache behavior (private Garnix requires this due to presigned URLs)

See `nix/modules/clawlets-host-baseline.nix` (in this repo) for the module options.

## Self-hosted cache servers (optional)

If you cannot use Garnix, you can run your own binary cache server and point hosts at it via:

- `hosts.<host>.cache.substituters`
- `hosts.<host>.cache.trustedPublicKeys`
- optional: `hosts.<host>.cache.netrc.*` for auth

Clawlets ships optional NixOS modules to run common cache servers:

- Harmonia: `clawlets.nixosModules.clawletsCacheHarmoniaServer`
- Attic: `clawlets.nixosModules.clawletsCacheAtticServer`

Example (Harmonia behind nginx+ACME):

```nix
{
  imports = [
    clawlets.nixosModules.clawletsCacheHarmoniaServer
  ];

  clawlets.cacheServers.harmonia = {
    enable = true;
    public = true;
    domain = "cache.example.com";
    acmeEmail = "ops@example.com";
  };
}
```

Example secrets (per-host sops file layout):

- `secrets/hosts/<host>/harmonia_sign_key.yaml` (installed at `/var/lib/secrets/harmonia.secret`)
- `secrets/hosts/<host>/atticd_env.yaml` (installed at `/etc/atticd.env`)

## Other options (tradeoffs)

### Local build (workstation)

If you have a Linux builder, `clawlets release manifest build` can build the toplevel locally.
macOS builders are not supported for NixOS system builds.

### Private base repo + PAT (bootstrap/lockdown)

`bootstrap`/`lockdown` may still need `GITHUB_TOKEN` if your base flake is private.
Updates do not require GitHub access on the host.
