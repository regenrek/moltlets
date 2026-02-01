{ lib, ... }:
{
  config = {
    clawlets.bootstrap.allowMissingSecrets = true;
    clawlets.cache.netrc.enable = lib.mkForce false;
    services.clawdbotFleet.enable = lib.mkForce false;
  };
}
