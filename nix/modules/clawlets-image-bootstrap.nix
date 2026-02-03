{ lib, ... }:
{
  config = {
    clawlets.bootstrap.allowMissingSecrets = true;
    clawlets.cache.netrc.enable = lib.mkForce false;
    services.openclawFleet.enable = lib.mkForce false;
  };
}
