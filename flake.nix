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
      url = "github:openclaw/openclaw/7f7d49aef0e87bf49ac1b945ec4046f0918f9c22";
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
            hash = "sha256-9/nBsn2bsJvvJfyHLS3LdEZVgbt7Y3P8L3g0dV8y0fw=";
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
            hash = "sha256-vnnuR6JH3xtr0eItSuZu5FWvmcLReQP7QmDRKT+bVdQ=";
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

        nix-module-eval = let
          infraConfig = {
            schemaVersion = 2;
            fleet = {
              secretEnv = { };
              secretFiles = { };
              sshAuthorizedKeys = [ ];
              sshKnownHosts = [ ];
              backups = { restic = { enable = false; repository = ""; }; };
            };
            cattle = {
              enabled = false;
              hetzner = {
                image = "";
                serverType = "cx22";
                location = "nbg1";
                maxInstances = 10;
                defaultTtl = "2h";
                labels = { "managed-by" = "clawlets"; };
              };
              defaults = { autoShutdown = true; callbackUrl = ""; };
            };
            hosts = {
              "openclaw-fleet-host" = {
                enable = false;
                diskDevice = "/dev/sda";
                flakeHost = "";
                targetHost = "admin@127.0.0.1";
                tailnet = { mode = "none"; };
              };
            };
          };
          openclawConfig = {
            schemaVersion = 1;
            hosts = {
              "openclaw-fleet-host" = {
                enable = false;
                gatewaysOrder = [ "maren" ];
                gateways = { maren = { }; };
                agentModelPrimary = "zai/glm-4.7";
              };
            };
            fleet = {
              secretEnv = { };
              secretFiles = { };
              gatewayArchitecture = "multi";
              codex = { enable = false; gateways = [ ]; };
            };
          };
          project = {
            root = toString ./.;
            infraConfig = infraConfig;
            openclawConfig = openclawConfig;
            config = infraConfig;
          };
          flakeInfo = { project = { rev = "eval"; }; };
          evalSystem = nixpkgs.lib.nixosSystem {
            system = systemLinux;
            specialArgs = { inherit project flakeInfo; };
            modules = [
              self.inputs.disko.nixosModules.disko
              self.inputs.sops-nix.nixosModules.sops
              ./nix/hosts/project-host.nix
              ({ ... }: { clawlets.hostName = "openclaw-fleet-host"; })
            ];
          };
          forced = builtins.deepSeq evalSystem.config.system.stateVersion "ok";
        in pkgsLinux.runCommand "nix-module-eval" {} ''
          echo ${forced} > $out
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
        clawletsCattleImage = import ./nix/openclaw/cattle/image.nix;

        # Advanced / reuse. Projects should generally import clawletsProjectHost only.
        clawletsHostMeta = import ./nix/infra/modules/clawlets-host-meta.nix;
        clawletsHostBaseline = import ./nix/infra/modules/clawlets-host-baseline.nix;
        clawletsSelfUpdate = import ./nix/infra/modules/clawlets-self-update.nix;
        clawletsCacheAtticServer = import ./nix/infra/modules/clawlets-cache-attic-server.nix;
        clawletsCacheHarmoniaServer = import ./nix/infra/modules/clawlets-cache-harmonia-server.nix;
        clawletsImageFormats = import ./nix/infra/modules/clawlets-image-formats.nix;

        openclawFleet = import ./nix/openclaw/modules/openclaw-fleet.nix;
        openclawCattle = import ./nix/openclaw/modules/openclaw-cattle.nix;

        diskoHetznerExt4 = import ./nix/infra/disko/hetzner-ext4.nix;
      };
    };
}
