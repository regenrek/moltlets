{ lib, options, ... }:
{
  config = lib.optionalAttrs (options ? formatConfigs) {
    formatConfigs.raw = { ... }: {
      imports = [
        ./clawlets-image-bootstrap.nix
      ];

      boot.growPartition = lib.mkDefault true;
      fileSystems."/" = {
        device = lib.mkForce "/dev/disk/by-label/nixos";
        autoResize = lib.mkDefault true;
      };
    };
  };
}
