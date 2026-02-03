{
  description = "Clawlets (CLI + infra framework)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";

    nixos-generators.url = "github:nix-community/nixos-generators";
    nixos-generators.inputs.nixpkgs.follows = "nixpkgs";

    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";

    nix-openclaw.url = "github:openclaw/nix-openclaw";
    nix-openclaw.inputs.nixpkgs.follows = "nixpkgs";

    openclaw-src = {
      url = "github:openclaw/openclaw/92112a61db519296a7258d508677aa6c49f9a558";
      flake = false;
    };

  };

  outputs = { self, nixpkgs, nix-openclaw, openclaw-src, ... }:
    let
      systemLinux = "x86_64-linux";
      systemDarwin = "aarch64-darwin";
      pkgsLinux = import nixpkgs { system = systemLinux; };
      pkgsDarwin = import nixpkgs { system = systemDarwin; };
      dev = import ./devenv.nix { pkgs = pkgsLinux; };
      openclawSourceInfo = import "${nix-openclaw}/nix/sources/openclaw-source.nix";

      mkCliPackages = (system:
        let
          pkgs = import nixpkgs { inherit system; };
          lib = pkgs.lib;
          rootSrc = lib.cleanSource ./.;

          pnpm = pkgs.pnpm_10;
          nodejs = pkgs.nodejs_22;

          pnpmWorkspacesCli = [
            "@clawlets/shared"
            "@clawlets/cattle-core"
            "@clawlets/core"
            "clawlets"
          ];

          pnpmDepsCli = pkgs.fetchPnpmDeps {
            pname = "clawlets-cli";
            version = "0.4.3";
            src = rootSrc;
            inherit pnpm;
            fetcherVersion = 3;
            pnpmWorkspaces = pnpmWorkspacesCli;
            # Update this when pnpm-lock.yaml changes
            hash = "sha256-COCa0vwB173TYDBJYMDNY707W2rkRbGPSrKe/wh3ro8=";
          };

          pnpmWorkspacesOpenclaw = [ "openclaw" ];
          pnpmDepsOpenclaw = pkgs.fetchPnpmDeps {
            pname = "openclaw-src";
            version = openclaw-src.rev or "unknown";
            src = openclaw-src;
            inherit pnpm;
            fetcherVersion = 3;
            pnpmWorkspaces = pnpmWorkspacesOpenclaw;
            # Update this when the OpenClaw pnpm-lock.yaml changes
            hash = "sha256-5r44dpkWymFcEqPuxx2QlGXctXIucYTff3rxXY1Jjkw=";
          };

          openclawSrcWithDeps = pkgs.buildNpmPackage {
            pname = "openclaw-src-with-deps";
            version = openclaw-src.rev or "unknown";
            src = openclaw-src;

            inherit nodejs;

            npmDeps = null;
            pnpmDeps = pnpmDepsOpenclaw;
            nativeBuildInputs = [ pnpm ];
            npmConfigHook = pkgs.pnpmConfigHook;
            pnpmWorkspaces = pnpmWorkspacesOpenclaw;

            dontNpmBuild = true;
            dontNpmInstall = true;
            dontNpmPrune = true;

            npm_config_ignore_scripts = "true";

            buildPhase = ''
              runHook preBuild
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p $out
              cp -r src extensions package.json pnpm-lock.yaml pnpm-workspace.yaml $out/
              cp -r node_modules $out/node_modules

              runHook postInstall
            '';
          };

          openclawSchemaArtifacts = pkgs.buildNpmPackage {
            pname = "openclaw-schema-artifacts";
            version = "0.0.0";
            src = rootSrc;

            inherit nodejs;

            npmDeps = null;
            inherit pnpmDepsCli;
            pnpmDeps = pnpmDepsCli;
            nativeBuildInputs = [ pnpm ];
            npmConfigHook = pkgs.pnpmConfigHook;
            inherit pnpmWorkspacesCli;
            pnpmWorkspaces = pnpmWorkspacesCli;

            dontNpmBuild = true;
            dontNpmInstall = true;
            dontNpmPrune = true;

            installPhase = ''
              runHook preInstall

              mkdir -p $out
              pnpm --filter=@clawlets/core exec tsx scripts/sync-openclaw-schema.ts \
                --mode generate \
                --src ${openclawSrcWithDeps} \
                --out-dir $out

              runHook postInstall
            '';
          };

          clawletsCli = pkgs.buildNpmPackage {
            pname = "clawlets";
            version = "0.4.3";
            src = rootSrc;

            inherit nodejs;

            npmDeps = null;
            inherit pnpmDepsCli;
            pnpmDeps = pnpmDepsCli;
            nativeBuildInputs = [ pnpm pkgs.makeWrapper ];
            npmConfigHook = pkgs.pnpmConfigHook;
            inherit pnpmWorkspacesCli;
            pnpmWorkspaces = pnpmWorkspacesCli;

            dontNpmBuild = true;
            dontNpmInstall = true;
            dontNpmPrune = true;

            buildPhase = ''
              runHook preBuild

              # Dependencies are installed by pnpmConfigHook (offline, workspace-scoped).
              pnpm --filter=@clawlets/shared build
              pnpm --filter=@clawlets/cattle-core build
              pnpm --filter=@clawlets/core build
              pnpm --filter=clawlets build

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p $out/lib/clawlets
              mkdir -p $out/bin

              cp -r node_modules $out/lib/clawlets/node_modules
              cp -r packages $out/lib/clawlets/packages

              makeWrapper ${nodejs}/bin/node $out/bin/clawlets \
                --add-flags "$out/lib/clawlets/packages/cli/dist/main.mjs" \
                --prefix PATH : ${pkgs.minisign}/bin

              runHook postInstall
            '';

            meta = {
              description = "clawlets CLI";
              mainProgram = "clawlets";
            };
          };
        in
          {
            clawlets = clawletsCli;
            "openclaw-schema-artifacts" = openclawSchemaArtifacts;
            default = clawletsCli;
          }
      );
    in {
      devShells.${systemLinux}.default = pkgsLinux.mkShell {
        packages = dev.packages or [ ];
      };

      packages.${systemLinux} = mkCliPackages systemLinux;
      packages.${systemDarwin} = mkCliPackages systemDarwin;

      checks.${systemLinux} = {
        openclaw-pin-align = pkgsLinux.runCommand "openclaw-pin-align" {} ''
          set -euo pipefail
          pinned_rev="${openclawSourceInfo.rev or ""}"
          src_rev="${openclaw-src.rev or ""}"

          if [ -z "$pinned_rev" ] || [ -z "$src_rev" ]; then
            echo "error: missing openclaw rev (nix-openclaw pinned=$pinned_rev openclaw-src=$src_rev)" >&2
            exit 1
          fi

          if [ "$pinned_rev" != "$src_rev" ]; then
            echo "error: openclaw-src rev mismatch (nix-openclaw=$pinned_rev openclaw-src=$src_rev)" >&2
            exit 1
          fi

          touch "$out"
        '';

        openclaw-schema-up-to-date = pkgsLinux.runCommand "openclaw-schema-up-to-date" {
          buildInputs = [ pkgsLinux.diffutils ];
        } ''
          set -euo pipefail
          generated="${self.packages.${systemLinux}."openclaw-schema-artifacts"}"

          diff -u ${./packages/core/src/generated/openclaw-config.schema.json} "$generated/openclaw-config.schema.json"
          diff -u ${./packages/core/src/generated/openclaw-config.types.ts} "$generated/openclaw-config.types.ts"

          touch "$out"
        '';
      };

      checks.${systemDarwin} = {
        openclaw-pin-align = pkgsDarwin.runCommand "openclaw-pin-align" {} ''
          set -euo pipefail
          pinned_rev="${openclawSourceInfo.rev or ""}"
          src_rev="${openclaw-src.rev or ""}"

          if [ -z "$pinned_rev" ] || [ -z "$src_rev" ]; then
            echo "error: missing openclaw rev (nix-openclaw pinned=$pinned_rev openclaw-src=$src_rev)" >&2
            exit 1
          fi

          if [ "$pinned_rev" != "$src_rev" ]; then
            echo "error: openclaw-src rev mismatch (nix-openclaw=$pinned_rev openclaw-src=$src_rev)" >&2
            exit 1
          fi

          touch "$out"
        '';

        openclaw-schema-up-to-date = pkgsDarwin.runCommand "openclaw-schema-up-to-date" {
          buildInputs = [ pkgsDarwin.diffutils ];
        } ''
          set -euo pipefail
          generated="${self.packages.${systemDarwin}."openclaw-schema-artifacts"}"

          diff -u ${./packages/core/src/generated/openclaw-config.schema.json} "$generated/openclaw-config.schema.json"
          diff -u ${./packages/core/src/generated/openclaw-config.types.ts} "$generated/openclaw-config.types.ts"

          touch "$out"
        '';
      };

      apps.${systemLinux}.update-openclaw-schema = {
        type = "app";
        program = "${pkgsLinux.writeShellScript "update-openclaw-schema" ''
          set -euo pipefail

          root="$PWD"
          while [ "$root" != "/" ] && [ ! -f "$root/flake.nix" ]; do
            root="$(dirname "$root")"
          done
          if [ ! -f "$root/flake.nix" ]; then
            echo "error: run from within the clawlets repo" >&2
            exit 1
          fi

          out="$(nix build --print-out-paths "$root#openclaw-schema-artifacts" | tail -n 1)"
          if [ -z "$out" ]; then
            echo "error: nix build returned empty output path" >&2
            exit 1
          fi

          target="$root/packages/core/src/generated"
          mkdir -p "$target"

          cp "$out/openclaw-config.schema.json" "$target/openclaw-config.schema.json"
          cp "$out/openclaw-config.types.ts" "$target/openclaw-config.types.ts"
          chmod 644 "$target/openclaw-config.schema.json" "$target/openclaw-config.types.ts"

          echo "ok: updated $target"
        ''}";
      };

      apps.${systemDarwin}.update-openclaw-schema = {
        type = "app";
        program = "${pkgsDarwin.writeShellScript "update-openclaw-schema" ''
          set -euo pipefail

          root="$PWD"
          while [ "$root" != "/" ] && [ ! -f "$root/flake.nix" ]; do
            root="$(dirname "$root")"
          done
          if [ ! -f "$root/flake.nix" ]; then
            echo "error: run from within the clawlets repo" >&2
            exit 1
          fi

          out="$(nix build --print-out-paths "$root#openclaw-schema-artifacts" | tail -n 1)"
          if [ -z "$out" ]; then
            echo "error: nix build returned empty output path" >&2
            exit 1
          fi

          target="$root/packages/core/src/generated"
          mkdir -p "$target"

          cp "$out/openclaw-config.schema.json" "$target/openclaw-config.schema.json"
          cp "$out/openclaw-config.types.ts" "$target/openclaw-config.types.ts"
          chmod 644 "$target/openclaw-config.schema.json" "$target/openclaw-config.types.ts"

          echo "ok: updated $target"
        ''}";
      };

      nixosModules = {
        clawletsProjectHost = import ./nix/hosts/project-host.nix;
        clawletsCattleImage = import ./nix/cattle/image.nix;

        # Advanced / reuse. Projects should generally import clawletsProjectHost only.
        clawletsHostMeta = import ./nix/modules/clawlets-host-meta.nix;
        clawletsHostBaseline = import ./nix/modules/clawlets-host-baseline.nix;
        clawletsSelfUpdate = import ./nix/modules/clawlets-self-update.nix;
        clawletsCacheAtticServer = import ./nix/modules/clawlets-cache-attic-server.nix;
        clawletsCacheHarmoniaServer = import ./nix/modules/clawlets-cache-harmonia-server.nix;
        clawletsImageFormats = import ./nix/modules/clawlets-image-formats.nix;

        openclawFleet = import ./nix/modules/openclaw-fleet.nix;
        openclawCattle = import ./nix/modules/openclaw-cattle.nix;
        clfOrchestrator = import ./nix/modules/clf-orchestrator.nix;

        diskoHetznerExt4 = import ./nix/disko/hetzner-ext4.nix;
      };
    };
}
