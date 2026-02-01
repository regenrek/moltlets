#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="${CLAWLETS_BIN_DIR:-"$HOME/bin"}"
wrapper="$bin_dir/clawlets"

mkdir -p "$bin_dir"

# Build workspace deps first so cli runtime imports exist in dist/
pnpm -C "$repo_root" -r build >/dev/null

cat >"$wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
node "$repo_root/packages/cli/dist/main.mjs" "\$@"
EOF

chmod +x "$wrapper"
echo "ok: $wrapper"
