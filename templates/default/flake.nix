{
  description = "__PROJECT_NAME__";

  inputs = {
    clawlets.url = "github:regenrek/clawlets";
  };

  outputs = { self, clawlets, ... }:
    let
      system = "x86_64-linux";
      nixpkgs = clawlets.inputs.nixpkgs;
      lib = nixpkgs.lib;

      cfg = builtins.fromJSON (builtins.readFile ./fleet/clawlets.json);
      hostNames =
        if builtins.attrNames (cfg.hosts or { }) == [ ] then
          throw "fleet/clawlets.json must define at least one host under .hosts"
        else
          builtins.attrNames cfg.hosts;
      imageHostNames =
        builtins.filter
          (hostName:
            let
              hostCfg = cfg.hosts.${hostName} or { };
              fleetCfg = cfg.fleet or { };
              keys = fleetCfg.sshAuthorizedKeys or [ ];
            in
              builtins.isList keys && keys != [ ]
          )
          hostNames;

      project = {
        root = ./.;
        config = cfg;
      };

      flakeInfo = {
        clawlets = {
          rev = self.rev or null;
          lastModifiedDate = self.lastModifiedDate or null;
        };
        nixpkgs = {
          rev = nixpkgs.rev or null;
          lastModifiedDate = nixpkgs.lastModifiedDate or null;
        };
        nix-openclaw = {
          rev = clawlets.inputs.nix-openclaw.rev or null;
          lastModifiedDate = clawlets.inputs.nix-openclaw.lastModifiedDate or null;
        };
        openclaw =
          if clawlets.inputs ? openclaw-src then {
            rev = clawlets.inputs.openclaw-src.rev or null;
            lastModifiedDate = clawlets.inputs.openclaw-src.lastModifiedDate or null;
          } else {
            rev = null;
            lastModifiedDate = null;
          };
      };
    in {
      nixosConfigurations =
        let
          hostConfigs = lib.genAttrs hostNames (hostName:
            lib.nixosSystem {
              inherit system;
              specialArgs = { inherit clawlets flakeInfo project; nix-openclaw = clawlets.inputs.nix-openclaw; };
              modules = [
                clawlets.inputs.disko.nixosModules.disko
                clawlets.inputs.nixos-generators.nixosModules.all-formats
                clawlets.inputs.sops-nix.nixosModules.sops
                ({ ... }: { clawlets.hostName = hostName; })
                clawlets.nixosModules.clawletsProjectHost
              ];
            });

          cattleConfig = lib.nixosSystem {
            inherit system;
            specialArgs = { inherit clawlets flakeInfo project; nix-clawdbot = clawlets.inputs.nix-clawdbot; };
            modules = [
              clawlets.inputs.disko.nixosModules.disko
              clawlets.inputs.nixos-generators.nixosModules.all-formats
              clawlets.nixosModules.clawletsCattleImage
            ];
          };
        in
          hostConfigs // {
            clawlets-cattle = cattleConfig;
          };

      packages = {
        ${system} =
          let
            byHost = builtins.listToAttrs (map (hostName: {
              name = "${hostName}-system";
              value = self.nixosConfigurations.${hostName}.config.system.build.toplevel;
            }) hostNames);
            byHostImages = builtins.listToAttrs (map (hostName: {
              name = "${hostName}-image";
              value = self.nixosConfigurations.${hostName}.config.formats.raw;
            }) imageHostNames);
            first = if hostNames == [ ] then null else builtins.elemAt hostNames 0;
            firstImage = if imageHostNames == [ ] then null else builtins.elemAt imageHostNames 0;
          in
            byHost
            // byHostImages
            // {
              clawlets-cattle-image = self.nixosConfigurations.clawlets-cattle.config.formats.raw;
              clawlets-cattle-system = self.nixosConfigurations.clawlets-cattle.config.system.build.toplevel;
              clawlets = clawlets.packages.${system}.clawlets;
            }
            // (
              if first == null then
                { }
              else
                {
                  default = byHost."${first}-system";
                }
            )
            // (
              if firstImage == null then
                { defaultImage = self.nixosConfigurations.clawlets-cattle.config.formats.raw; }
              else
                { defaultImage = byHostImages."${firstImage}-image"; }
            );
      };
    };
}
