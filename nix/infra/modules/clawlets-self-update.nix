{ config, lib, pkgs, ... }:

let
  cfg = config.clawlets;
in {
  options.clawlets.selfUpdate = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable pull-based updates from a signed desired-state release manifest (pointer + immutable manifest).";
    };

    baseUrls = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Mirror base URLs for this host+channel (must contain latest.json and <releaseId>.json). First success wins.";
    };

    interval = lib.mkOption {
      type = lib.types.str;
      default = "30min";
      description = "systemd OnCalendar value for self-update checks.";
    };

    channel = lib.mkOption {
      type = lib.types.str;
      default = "prod";
      description = "Release channel this host follows (staging|prod|...).";
    };

    publicKeys = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Trusted minisign public keys (newline-delimited).";
    };

    previousPublicKeys = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Key rotation safe mode: previous minisign public keys accepted until previousPublicKeysValidUntil.";
    };

    previousPublicKeysValidUntil = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "UTC timestamp (RFC3339/ISO) until which previousPublicKeys are accepted. After that, previous keys are rejected automatically.";
    };

    allowUnsigned = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Dev-only: allow unsigned pointers/manifests (NOT recommended).";
    };

    allowRollback = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Break-glass: allow applying a manifest with lower releaseId (replay protection bypass).";
    };

    healthCheckUnit = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional systemd unit to require active after switch (record-only).";
    };
  };

  config = {
    assertions = [
      {
        assertion = (!cfg.selfUpdate.enable) || (cfg.selfUpdate.baseUrls != [ ]);
        message = "clawlets.selfUpdate.baseUrls must be set when self-update is enabled.";
      }
      {
        assertion = (cfg.selfUpdate.previousPublicKeys == [ ]) || (cfg.selfUpdate.previousPublicKeysValidUntil != null);
        message = "clawlets.selfUpdate.previousPublicKeysValidUntil must be set when previousPublicKeys is non-empty.";
      }
    ];

    environment.etc."clawlets/bin/update-fetch" = {
      source = ../scripts/update-fetch.sh;
      mode = "0755";
    };

    environment.etc."clawlets/bin/update-apply" = {
      source = ../scripts/update-apply.sh;
      mode = "0755";
    };

    environment.etc."clawlets/bin/update-status" = {
      source = ../scripts/update-status.sh;
      mode = "0755";
    };

    environment.etc."clawlets/updater/manifest.keys" = lib.mkIf cfg.selfUpdate.enable {
      mode = "0444";
      text = lib.concatStringsSep "\n" cfg.selfUpdate.publicKeys + "\n";
    };

    environment.etc."clawlets/updater/manifest.previous.keys" = lib.mkIf (cfg.selfUpdate.enable && cfg.selfUpdate.previousPublicKeys != [ ]) {
      mode = "0444";
      text = lib.concatStringsSep "\n" cfg.selfUpdate.previousPublicKeys + "\n";
    };

    systemd.services.clawlets-update-fetch = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawlets update: fetch desired state (pointer + manifest)";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = [ pkgs.bash pkgs.curl pkgs.jq pkgs.coreutils pkgs.minisign pkgs.util-linux ];
      environment = {
        CLAWLETS_UPDATER_BASE_URLS = lib.concatStringsSep " " cfg.selfUpdate.baseUrls;
        CLAWLETS_UPDATER_STATE_DIR = "/var/lib/clawlets/updates";
        CLAWLETS_UPDATER_KEYS_FILE = "/etc/clawlets/updater/manifest.keys";
        CLAWLETS_UPDATER_PREVIOUS_KEYS_FILE = if cfg.selfUpdate.previousPublicKeys != [ ] then "/etc/clawlets/updater/manifest.previous.keys" else "";
        CLAWLETS_UPDATER_PREVIOUS_KEYS_VALID_UNTIL = if cfg.selfUpdate.previousPublicKeysValidUntil != null then cfg.selfUpdate.previousPublicKeysValidUntil else "";
        CLAWLETS_UPDATER_ALLOW_UNSIGNED = if cfg.selfUpdate.allowUnsigned then "true" else "false";
      };
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        UMask = "0077";
        StateDirectory = "clawlets/updates";
        StateDirectoryMode = "0700";
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        NoNewPrivileges = true;
        ReadWritePaths = [ "/nix" "/var" ];
      };
      script = ''
        set -euo pipefail

        /etc/clawlets/bin/update-fetch
        /run/current-system/sw/bin/systemctl start clawlets-update-apply.service
      '';
    };

    systemd.services.clawlets-update-apply = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawlets update: apply desired state";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = [ pkgs.bash pkgs.curl pkgs.jq pkgs.coreutils pkgs.minisign pkgs.util-linux pkgs.nix ];
      environment = {
        CLAWLETS_UPDATER_BASE_URLS = lib.concatStringsSep " " cfg.selfUpdate.baseUrls;
        CLAWLETS_UPDATER_STATE_DIR = "/var/lib/clawlets/updates";
        CLAWLETS_UPDATER_KEYS_FILE = "/etc/clawlets/updater/manifest.keys";
        CLAWLETS_UPDATER_PREVIOUS_KEYS_FILE = if cfg.selfUpdate.previousPublicKeys != [ ] then "/etc/clawlets/updater/manifest.previous.keys" else "";
        CLAWLETS_UPDATER_PREVIOUS_KEYS_VALID_UNTIL = if cfg.selfUpdate.previousPublicKeysValidUntil != null then cfg.selfUpdate.previousPublicKeysValidUntil else "";
        CLAWLETS_UPDATER_HOST_NAME = config.networking.hostName;
        CLAWLETS_UPDATER_CHANNEL = cfg.selfUpdate.channel;
        CLAWLETS_UPDATER_SECRETS_DIR = config.clawlets.secrets.hostDir;
        CLAWLETS_UPDATER_ALLOW_UNSIGNED = if cfg.selfUpdate.allowUnsigned then "true" else "false";
        CLAWLETS_UPDATER_ALLOW_ROLLBACK = if cfg.selfUpdate.allowRollback then "true" else "false";
        CLAWLETS_UPDATER_HEALTHCHECK_UNIT = if cfg.selfUpdate.healthCheckUnit != null then cfg.selfUpdate.healthCheckUnit else "";
        CLAWLETS_UPDATER_ALLOWED_SUBSTITUTERS = lib.concatStringsSep " " (config.nix.settings.substituters or []);
        CLAWLETS_UPDATER_ALLOWED_TRUSTED_PUBLIC_KEYS = lib.concatStringsSep " " (config.nix.settings."trusted-public-keys" or []);
      };
      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        UMask = "0077";
        StateDirectory = "clawlets/updates";
        StateDirectoryMode = "0700";
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "strict";
        NoNewPrivileges = true;
        ReadWritePaths = [ "/nix" "/var" ];
      };
      script = ''
        set -euo pipefail
        /etc/clawlets/bin/update-apply
      '';
    };

    systemd.timers.clawlets-update-fetch = lib.mkIf cfg.selfUpdate.enable {
      description = "Clawlets update: fetch+apply timer";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnCalendar = cfg.selfUpdate.interval;
        Persistent = true;
        RandomizedDelaySec = "2m";
        Unit = "clawlets-update-fetch.service";
      };
    };
  };
}
