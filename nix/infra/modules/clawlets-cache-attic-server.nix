{ config, lib, ... }:

let
  cfg = config.clawlets.cacheServers.attic;
  allowMissingSecrets = config.clawlets.bootstrap.allowMissingSecrets or false;

  defaultHostSecretsDir = "/var/lib/clawlets/secrets/hosts/${config.networking.hostName}";
  hostSecretsDir =
    if (config.clawlets.secrets.hostDir or null) != null
    then config.clawlets.secrets.hostDir
    else defaultHostSecretsDir;
in
{
  options.clawlets.cacheServers.attic = {
    enable = lib.mkEnableOption "Attic binary cache server";

    environmentSecretName = lib.mkOption {
      type = lib.types.str;
      default = "atticd_env";
      description = "Sops secret name containing the atticd environment file (must include ATTIC_SERVER_TOKEN_RS256_SECRET_BASE64).";
    };

    environmentPath = lib.mkOption {
      type = lib.types.str;
      default = "/etc/atticd.env";
      description = "Filesystem path for the atticd environment file (root-owned, 0400).";
    };

    settings = lib.mkOption {
      type = lib.types.attrs;
      default = {
        listen = "[::]:8080";
        jwt = { };
      };
      description = "Attic server settings (services.atticd.settings).";
    };

    public = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Expose Attic publicly via nginx+ACME (recommended). If false, Attic listens locally and you should provide your own reverse proxy / tailnet access.";
    };

    domain = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Public hostname (required when public=true).";
    };

    acmeEmail = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "ACME account email (required when public=true).";
    };

    upstreamHost = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Upstream host for nginx proxy_pass.";
    };

    upstreamPort = lib.mkOption {
      type = lib.types.int;
      default = 8080;
      description = "Upstream port for nginx proxy_pass (Attic default).";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !allowMissingSecrets;
        message = "clawlets.cacheServers.attic.enable requires secrets (disable clawlets.bootstrap.allowMissingSecrets).";
      }
      {
        assertion = (!cfg.public) || (cfg.domain != null && cfg.domain != "" && cfg.acmeEmail != null && cfg.acmeEmail != "");
        message = "clawlets.cacheServers.attic: domain + acmeEmail are required when public=true.";
      }
    ];

    sops.secrets.${cfg.environmentSecretName} = {
      owner = "root";
      group = "root";
      mode = "0400";
      path = cfg.environmentPath;
      sopsFile = "${hostSecretsDir}/${cfg.environmentSecretName}.yaml";
    };

    services.atticd = {
      enable = true;
      environmentFile = config.sops.secrets.${cfg.environmentSecretName}.path;
      settings = cfg.settings;
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.public [ 80 443 ];

    security.acme = lib.mkIf cfg.public {
      acceptTerms = true;
      defaults.email = cfg.acmeEmail;
    };

    services.nginx = lib.mkIf cfg.public {
      enable = true;
      recommendedTlsSettings = true;

      virtualHosts.${cfg.domain} = {
        enableACME = true;
        forceSSL = true;
        locations."/".extraConfig = ''
          proxy_pass http://${cfg.upstreamHost}:${toString cfg.upstreamPort};
          proxy_set_header Host $host;
          proxy_redirect http:// https://;
          proxy_http_version 1.1;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection $connection_upgrade;
        '';
      };
    };
  };
}

