{ config, lib, pkgs, defs }:

let
  inherit (defs) resolveGatewayCredsDir;

  mkGatewayTokenService = b:
    let
      credsDir = resolveGatewayCredsDir b;
      envFile = "${credsDir}/gateway.env";
    in
      {
        "openclaw-gateway-token-${b}" = {
          description = "Ensure Gateway auth token for gateway ${b}";
          path = [ pkgs.bash pkgs.coreutils pkgs.openssl ];
          environment = {
            CLAWLETS_GATEWAY_ENV_FILE = envFile;
            CLAWLETS_GATEWAY_USER = "gateway-${b}";
            CLAWLETS_GATEWAY_GROUP = "gateway-${b}";
          };
          serviceConfig = {
            Type = "oneshot";
            ExecStart = "/etc/clawlets/bin/ensure-gateway-token";

            User = "root";
            Group = "root";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = [ credsDir ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
        };
      };
in
{
  inherit mkGatewayTokenService;
}
