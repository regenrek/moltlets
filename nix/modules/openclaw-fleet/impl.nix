{ config, lib, pkgs, project, flakeInfo ? {}, ... }:

let
  defs = import ./impl/defs.nix { inherit config lib pkgs project flakeInfo; };
  gatewayConfig = import ./impl/bot-config.nix { inherit lib defs; };
  runtime = import ./impl/runtime.nix { inherit config lib pkgs defs gatewayConfig; };
  gatewayToken = import ./impl/gateway-token.nix { inherit config lib pkgs defs; };
  github = import ./impl/github.nix { inherit config lib pkgs defs; };

  cfg = defs.cfg;

in
{
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = (flakeInfo.clawlets.rev or null) != null;
        message = "refusing to build: flake source has no git revision (dirty tree or non-git source); deploy by pinning a git commit (?rev=<sha>)";
      }
      {
        assertion = builtins.isList defs.knownBundledSkills && lib.all builtins.isString defs.knownBundledSkills;
        message = "fleet/bundled-skills.json must be a JSON list of strings.";
      }
      {
        assertion = lib.all (b: lib.elem b cfg.gateways) (builtins.attrNames cfg.gatewayProfiles);
        message = "services.openclawFleet.gatewayProfiles keys must be a subset of services.openclawFleet.gateways.";
      }
      {
        assertion = lib.all (b: lib.elem b cfg.gateways) cfg.codex.bots;
        message = "services.openclawFleet.codex.bots must be a subset of services.openclawFleet.gateways.";
      }
      {
        assertion = lib.all (b: ((defs.getGatewayProfile b).skills.allowBundled or null) != null) cfg.gateways;
        message = "services.openclawFleet.gatewayProfiles.<gateway>.skills.allowBundled must be set (no null allow-all).";
      }
      {
        assertion = (!cfg.githubSync.enable) || (cfg.githubSync.org != "" || cfg.githubSync.repos != []);
        message = "services.openclawFleet.githubSync requires githubSync.org or githubSync.repos.";
      }
      {
        assertion =
          (!cfg.githubSync.enable)
          || lib.any (b:
            let
              gh = (defs.getGatewayProfile b).github or {};
            in
              (gh.appId or null) != null
              && (gh.installationId or null) != null
              && (gh.privateKeySecret or null) != null
          ) cfg.gateways;
        message = "services.openclawFleet.githubSync.enable requires at least one gatewayProfiles.<gateway>.github App config.";
      }
      {
        assertion =
          lib.all (b:
            let
              allow = (defs.getGatewayProfile b).skills.allowBundled or null;
            in
              allow == null || lib.all (s: lib.elem s defs.knownBundledSkills) allow
          ) cfg.gateways;
        message = "services.openclawFleet.gatewayProfiles.<gateway>.skills.allowBundled contains unknown skills (see fleet/bundled-skills.json).";
      }
      {
        assertion =
          lib.all (b:
            let
              allow = (defs.getGatewayProfile b).skills.allowBundled or null;
              gh = (defs.getGatewayProfile b).github or {};
            in
              !(allow != null && lib.elem "github" allow)
              || ((gh.appId or null) != null && (gh.installationId or null) != null && (gh.privateKeySecret or null) != null && (gh.privateKeySecret or "") != "")
          ) cfg.gateways;
        message = "bundled skill \"github\" requires gatewayProfiles.<gateway>.github.{ appId, installationId, privateKeySecret }.";
      }
      {
        assertion =
          lib.all (b:
            let
              allow = (defs.getGatewayProfile b).skills.allowBundled or null;
              brave = (defs.getGatewayProfile b).skills.entries."brave-search" or {};
              apiKeySecret = brave.apiKeySecret or null;
            in
              !(allow != null && lib.elem "brave-search" allow)
              || ((apiKeySecret != null && apiKeySecret != ""))
          ) cfg.gateways;
        message = "bundled skill \"brave-search\" requires gatewayProfiles.<gateway>.skills.entries.\"brave-search\".apiKeySecret.";
      }
      {
        assertion =
          (!cfg.backups.restic.enable)
          || (cfg.backups.restic.repository != "" && cfg.backups.restic.passwordSecret != "");
        message = "services.openclawFleet.backups.restic requires repository + passwordSecret when enabled.";
      }
    ]
    ++ (map (b:
      let
        profile = defs.getGatewayProfile b;
        dupes = defs.secretEnvDerivedDupes profile;
      in
        {
          assertion = dupes == [];
          message = "services.openclawFleet.gatewayProfiles.${b}: secretEnv conflicts with derived hooks/skill env vars: ${lib.concatStringsSep "," dupes}";
        }
    ) cfg.gateways)
    ++ (map (b:
      let
        profile = defs.getGatewayProfile b;
        allowlist = profile.secretEnvAllowlist or null;
        effective = defs.buildEffectiveSecretEnv profile;
        unknown =
          if allowlist == null
          then []
          else lib.filter (k: !(builtins.hasAttr k effective)) allowlist;
      in
        {
          assertion = unknown == [];
          message = "services.openclawFleet.gatewayProfiles.${b}.secretEnvAllowlist contains unknown env vars: ${lib.concatStringsSep "," unknown}";
        }
    ) cfg.gateways)
    ++ (map (b:
      let
        profile = defs.getGatewayProfile b;
        allowlist = profile.secretEnvAllowlist or null;
        required = builtins.attrNames (defs.buildDerivedSecretEnv profile);
        missing =
          if allowlist == null
          then []
          else lib.filter (k: !lib.elem k allowlist) required;
      in
        {
          assertion = missing == [];
          message = "services.openclawFleet.gatewayProfiles.${b}.secretEnvAllowlist missing hooks/skill env vars: ${lib.concatStringsSep "," missing}";
        }
    ) cfg.gateways)
    ++ (lib.concatLists (map (b:
      let
        entries = (defs.getGatewayProfile b).skills.entries or {};
      in
        lib.mapAttrsToList (skill: entry:
          let
            hasInline = defs.isNonEmptyString (entry.apiKey or null);
          in
            {
              assertion = !hasInline;
              message = "services.openclawFleet.gatewayProfiles.${b}.skills.entries.${skill}: inline apiKey is not supported; use apiKeySecret (env var injection).";
            }
        ) entries
    ) cfg.gateways));

    sops.secrets = lib.mkMerge [
      runtime.perGatewaySkillSecrets
      runtime.secretFileSecrets
      (lib.optionalAttrs (cfg.backups.restic.enable && cfg.backups.restic.passwordSecret != "") {
        "${cfg.backups.restic.passwordSecret}" = defs.mkSopsSecretFor cfg.backups.restic.passwordSecret;
      })
      (lib.optionalAttrs (cfg.backups.restic.enable && cfg.backups.restic.environmentSecret != null && cfg.backups.restic.environmentSecret != "") {
        "${cfg.backups.restic.environmentSecret}" = defs.mkSopsSecretFor cfg.backups.restic.environmentSecret;
      })
    ];

    sops.templates = lib.mkMerge [ runtime.perGatewayTemplates ];

    users.users = builtins.listToAttrs (map runtime.mkGatewayUser cfg.gateways);
    users.groups = builtins.listToAttrs (map runtime.mkGatewayGroup cfg.gateways);

    systemd.tmpfiles.rules =
      [
        # Ensure parent exists for nested per-gateway state dirs (service sandboxes rely on this).
        "d ${cfg.stateDirBase} 0755 root root - -"
      ]
      ++ (lib.concatLists (map runtime.mkStateDir cfg.gateways))
      ++ runtime.secretFileTmpfilesRules
      ++ lib.optionals cfg.opsSnapshot.enable [
        "d ${cfg.opsSnapshot.outDir} 0750 root root - -"
      ];

    environment.etc = {
      "clawlets/tools.md" = {
        source = defs.toolsInventoryMd;
        mode = "0444";
      };

        "clawlets/build-info.json" = {
          source = defs.buildInfoJson;
          mode = "0444";
        };

        "clawlets/bin/gh-sync" = {
          source = ../../scripts/gh-sync.sh;
          mode = "0755";
        };

        "clawlets/bin/gh-sync-read" = {
          source = ../../scripts/gh-sync-read.sh;
          mode = "0755";
        };

        "clawlets/bin/gh-mint-app-token" = {
          source = ../../scripts/gh-mint-app-token.sh;
          mode = "0755";
        };

        "clawlets/bin/ops-snapshot" = {
          source = ../../scripts/ops-snapshot.sh;
          mode = "0755";
        };

        "clawlets/bin/seed-workspace" = {
          source = ../../scripts/seed-workspace.sh;
          mode = "0755";
        };

        "clawlets/bin/ensure-gateway-token" = {
          source = ../../scripts/ensure-gateway-token.sh;
          mode = "0755";
        };

        "clawlets/bin/openclaw-channels" = {
          source = ../../scripts/openclaw-channels.sh;
          mode = "0755";
        };

        "clawlets/bin/sync-managed-docs" = {
          source = ../../scripts/sync-managed-docs.sh;
          mode = "0755";
        };
    };

    environment.systemPackages =
      [ cfg.package pkgs.git pkgs.jq ]
      ++ lib.optional cfg.tools.enable cfg.tools.package
      ++ lib.optional defs.hasCodex pkgs.codex
      ++ lib.optional cfg.backups.restic.enable pkgs.restic
      ++ lib.optionals defs.hasGitHubAppAuth [ pkgs.curl pkgs.openssl ]
      ++ lib.optional defs.hasGh pkgs.gh
      ++ lib.optional defs.hasCodingAgent pkgs.glab
      ;

    systemd.services = lib.mkMerge [
      (builtins.listToAttrs (map runtime.mkService cfg.gateways))
      (lib.mkMerge (map gatewayToken.mkGatewayTokenService cfg.gateways))
      (lib.mkMerge (map github.mkGithubTokenService cfg.gateways))
      (lib.mkMerge (map github.mkGithubSyncService cfg.gateways))
      (lib.optionalAttrs cfg.opsSnapshot.enable {
        clawlets-ops-snapshot = {
          description = "Clawlets ops snapshot (no secrets)";
          after = [ "network-online.target" ];
          wants = [ "network-online.target" ];
          serviceConfig = {
            Type = "oneshot";
            User = "root";
            Group = "root";
            WorkingDirectory = "/";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = [ cfg.opsSnapshot.outDir ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
          path = [ pkgs.bash pkgs.coreutils pkgs.findutils pkgs.gawk pkgs.jq ];
          environment = {
            OUT_DIR = cfg.opsSnapshot.outDir;
            KEEP_DAYS = toString cfg.opsSnapshot.keepDays;
            KEEP_LAST = toString cfg.opsSnapshot.keepLast;
          };
          script = ''
            exec /etc/clawlets/bin/ops-snapshot
          '';
        };
      })
    ];

    systemd.timers = lib.mkMerge [
      (lib.mkMerge (map github.mkGithubTokenTimer cfg.gateways))
      (lib.mkMerge (map github.mkGithubSyncTimer cfg.gateways))
      (lib.optionalAttrs cfg.opsSnapshot.enable {
        clawlets-ops-snapshot = {
          description = "Periodic clawlets ops snapshot";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnCalendar = cfg.opsSnapshot.schedule;
            RandomizedDelaySec = "5m";
            Persistent = true;
            Unit = "clawlets-ops-snapshot.service";
          };
        };
      })
    ];

    services.restic.backups = lib.mkIf cfg.backups.restic.enable {
      openclawFleet = {
        repository = cfg.backups.restic.repository;
        passwordFile = config.sops.secrets.${cfg.backups.restic.passwordSecret}.path;
        environmentFile =
          if cfg.backups.restic.environmentSecret != null
          then config.sops.secrets.${cfg.backups.restic.environmentSecret}.path
          else null;
        paths = defs.resticPaths;
        timerConfig = cfg.backups.restic.timerConfig;
        pruneOpts = [
          "--keep-daily 7"
          "--keep-weekly 4"
          "--keep-monthly 6"
        ];
      };
    };
  };
}
