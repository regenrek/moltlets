# Golden Path (first-class)

Goal: one boring, cache-only workflow for bootstrap + updates.

## 0) Bootstrap once

```bash
clawlets secrets init
clawlets doctor --scope bootstrap
clawlets bootstrap
```

Optional (image-based bootstrap):

```bash
clawlets image build --host <host>
clawlets image upload --host <host> --image-url https://<bucket>/<image>.raw --compression bz2
clawlets host set --host <host> --hetzner-image <image_id_or_name>
clawlets bootstrap --mode image
```

After tailnet is up:

```bash
clawlets host set --target-host admin@<magicdns-or-100.x>
clawlets host set --ssh-exposure tailnet
clawlets server update apply --host <host>
clawlets lockdown
```

## 1) Push changes

Edit config/secrets, commit, push to `main`.

CI (Garnix + GH Actions):
- builds `packages.x86_64-linux.<host>-system`
- computes a signed desired-state release manifest (v1) per host+channel
- publishes manifests to GitHub Pages in the project repo (optional but recommended)
  - requires enabling GitHub Pages (Deploy from branch: `gh-pages` / root)
  - alternative: publish the manifest artifacts to any HTTPS static host

## 2) Apply updates (pull-only)

Hosts apply desired state on a timer (`clawlets.selfUpdate.interval`).
To apply immediately from your operator machine:

```bash
clawlets server update apply --host <host> --ssh-tty false
```

To inspect:

```bash
clawlets server update status --host <host>
clawlets server update logs --host <host> --since 5m
```

## 3) Promotion (staging → prod)

Promote to prod (manual approval) without rebuild:

- Run workflow `updates: promote` (staging → prod) to publish a prod manifest pointing at an already-built toplevel (new `releaseId`).
- Recommended rollout:
  - Keep a small canary set on `staging` (`hosts.<host>.selfUpdate.channel = "staging"`).
  - Validate `clawlets server update status|logs` + your health gate on canaries.
  - Promote the exact same `toplevel` to `prod` (new `releaseId`, re-signed).
  - Rollback = publish a new prod manifest (higher `releaseId`) pointing at the previous `toplevel`.

## 4) Enable self-update (host)

```nix
clawlets.selfUpdate.enable = true;
clawlets.selfUpdate.baseUrls = [ "https://<pages>/deploy/<host>/prod" ];
clawlets.selfUpdate.channel = "prod";
clawlets.selfUpdate.publicKeys = [ "<minisign-pubkey>" ];
```

The host fetches the manifest on a timer and switches by `/nix/store/...` (cache-only).
