{ config, lib, pkgs, nix-clawdbot, ... }:

let
  cfg = config.services.clawdbotCattle;

  system = pkgs.system;
  clawdbotPkgs =
    nix-clawdbot.packages.${system} or
      (throw "nix-clawdbot.packages.${system} missing (must consume flake outputs, not outPath internals)");
  clawPkg = clawdbotPkgs.clawdbot-gateway;
in
{
  options.services.clawdbotCattle = {
    enable = lib.mkEnableOption "Clawdbot cattle (ephemeral single-task runner)";

    baseDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/clawlets/cattle";
      description = "Base directory for cattle runtime files (task, workspace, result).";
    };

    taskFile = lib.mkOption {
      type = lib.types.str;
      default = "${cfg.baseDir}/task.json";
      description = "Path to task.json written by cloud-init.";
    };

    resultFile = lib.mkOption {
      type = lib.types.str;
      default = "${cfg.baseDir}/result.json";
      description = "Path to result.json written by cattle-run.";
    };

    envFile = lib.mkOption {
      type = lib.types.str;
      default = "/run/clawlets/cattle/env";
      description = "Path for cattle-run to write fetched secret env exports (tmpfs).";
    };

    workspaceDir = lib.mkOption {
      type = lib.types.str;
      default = "${cfg.baseDir}/workspace";
      description = "Workspace dir for the task run.";
    };

    autoShutdown = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Power off the VM after the task completes (recommended for cattle).";
    };

    gatewayPort = lib.mkOption {
      type = lib.types.int;
      default = 18789;
      description = "Local Gateway port for the cattle run.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.cloud-init.enable = true;

    environment.etc."clawlets/bin/cattle-run" = {
      source = ../scripts/cattle-run.sh;
      mode = "0755";
    };

    environment.systemPackages = [
      clawPkg
      pkgs.bash
      pkgs.coreutils
      pkgs.curl
      pkgs.git
      pkgs.jq
    ];

    systemd.tmpfiles.rules = [
      "d ${cfg.baseDir} 0700 root root - -"
      "d ${cfg.workspaceDir} 0700 root root - -"
      "d /run/clawlets 0755 root root - -"
      "d /run/clawlets/cattle 0700 root root - -"
    ];

    systemd.services.clawlets-cattle = {
      description = "Clawlets cattle (single task)";
      wants = [ "network-online.target" "cloud-final.service" ];
      after = [ "network-online.target" "cloud-final.service" "tailscaled.service" ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        CLAWLETS_CATTLE_TASK_FILE = cfg.taskFile;
        CLAWLETS_CATTLE_RESULT_FILE = cfg.resultFile;
        CLAWLETS_CATTLE_WORKSPACE_DIR = cfg.workspaceDir;
        CLAWLETS_CATTLE_GATEWAY_PORT = toString cfg.gatewayPort;
        CLAWLETS_CATTLE_AUTO_SHUTDOWN = if cfg.autoShutdown then "1" else "0";
        CLAWLETS_CATTLE_ENV_FILE = cfg.envFile;
        CLAWDBOT_DISABLE_BONJOUR = "1";
      };

      serviceConfig = {
        Type = "oneshot";
        User = "root";
        Group = "root";
        WorkingDirectory = cfg.baseDir;

        ExecStart = "/etc/clawlets/bin/cattle-run";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [
          cfg.baseDir
          cfg.workspaceDir
          "/run/clawlets/cattle"
        ];
        UMask = "0077";

        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
        SystemCallArchitectures = "native";
      };
    };
  };
}
