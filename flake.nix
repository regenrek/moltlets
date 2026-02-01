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

    nix-clawdbot.url = "github:clawdbot/nix-clawdbot";
    nix-clawdbot.inputs.nixpkgs.follows = "nixpkgs";

    clawdbot-src = {
      url = "github:moltbot/moltbot";
      flake = false;
    };

  };

  outputs = { self, nixpkgs, nix-clawdbot, clawdbot-src, ... }:
    let
      systemLinux = "x86_64-linux";
      pkgsLinux = import nixpkgs { system = systemLinux; };
      dev = import ./devenv.nix { pkgs = pkgsLinux; };
      clawdbotSourceInfo = import "${nix-clawdbot}/nix/sources/moltbot-source.nix";

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
            hash = "sha256-A3izetIxONv5hwMCrqqaE4WcJE9RkkSKrSLSGjYyZ9Q=";
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
            default = clawletsCli;
          }
      );
    in {
      devShells.${systemLinux}.default = pkgsLinux.mkShell {
        packages = dev.packages or [ ];
      };

      packages.${systemLinux} = mkCliPackages systemLinux;
      packages.aarch64-darwin = mkCliPackages "aarch64-darwin";

      checks.${systemLinux} = {
        clawdbot-pin-align = pkgsLinux.runCommand "clawdbot-pin-align" {} ''
          set -euo pipefail
          pinned_rev="${clawdbotSourceInfo.rev or ""}"
          src_rev="${clawdbot-src.rev or ""}"

          if [ -z "$pinned_rev" ] || [ -z "$src_rev" ]; then
            echo "error: missing clawdbot rev (nix-clawdbot pinned=$pinned_rev clawdbot-src=$src_rev)" >&2
            exit 1
          fi

          if [ "$pinned_rev" != "$src_rev" ]; then
            echo "error: clawdbot-src rev mismatch (nix-clawdbot=$pinned_rev clawdbot-src=$src_rev)" >&2
            exit 1
          fi

          touch "$out"
        '';
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

        clawdbotFleet = import ./nix/modules/clawdbot-fleet.nix;
        clawdbotCattle = import ./nix/modules/clawdbot-cattle.nix;
        clfOrchestrator = import ./nix/modules/clf-orchestrator.nix;

        diskoHetznerExt4 = import ./nix/disko/hetzner-ext4.nix;
      };
    };
}
