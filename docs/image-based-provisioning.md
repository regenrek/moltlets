# Image-based provisioning (Phase 4)

Goal: move from “pets” to **true cattle** by booting Hetzner hosts from a prebuilt image, without baking secrets.

## Reality check (Hetzner)

Hetzner Cloud does not provide a first-party “upload image” API. The reliable, automatable path today is
to use `hcloud-upload-image` (which provisions a rescue VM, writes the image, then snapshots it) or to
create a snapshot manually from a seeded VM.

## POC path (recommended)

Project repos now support a raw image build + upload flow:

1) **Build image** from the flake (no secrets baked):

```bash
clawlets image build --host <host>
```

This builds `packages.x86_64-linux.<host>-image` (raw) and writes it to `.clawlets/images/<host>/...`.

2) **Publish** the raw image to a public URL (S3/Backblaze/etc). Large files upload faster if you
compress them (`bz2`/`gz`/`xz`) before publishing.

3) **Import** to Hetzner using `hcloud-upload-image`:

```bash
clawlets image upload --host <host> --image-url https://<bucket>/<image>.raw --compression bz2
```

Requires `HCLOUD_TOKEN` in your environment.

4) **Pin** the image in config:

```bash
clawlets host set --host <host> --hetzner-image <image_id_or_name>
```

5) **Bootstrap** with the image:

```bash
clawlets bootstrap --mode image
```

6) **Apply updates** (same as normal updates):

```bash
clawlets server update apply --host <host> --target-host admin@<ipv4>
```

## Alternate POC (snapshot)

If you can’t upload, create a temporary VM, install NixOS, then snapshot it. This is less deterministic
and risks leaking secrets if you don’t scrub the host first.

## Security notes

- Never embed plaintext secrets in the image.
- The raw image build uses a bootstrap module that disables secrets + fleet services.
- Install encrypted secrets via CI-published bundles (preferred) or `clawlets secrets sync` after the host is reachable.

## Ops notes

- Images are pinned per host via `hosts.<host>.hetzner.image`.
- Provisioning will use the pinned image when creating new servers.
