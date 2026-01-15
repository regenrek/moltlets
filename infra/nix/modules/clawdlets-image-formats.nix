{ lib, ... }:
{
  config = {
    formatConfigs.raw = { ... }: {
      imports = [
        ./clawdlets-image-bootstrap.nix
      ];

      boot.growPartition = lib.mkDefault true;
      fileSystems."/" = {
        autoResize = lib.mkDefault true;
      };
    };
  };
}
