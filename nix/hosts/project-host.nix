{ config, lib, project, ... }:

let
  cfg = project.config;
  fleetCfg = (cfg.fleet or { });
  hostCfg = (cfg.hosts.${config.clawlets.hostName} or { });
  tailnet = (hostCfg.tailnet or { });
  tailnetMode = tailnet.mode or "none";
  sshExposureMode = ((hostCfg.sshExposure or { }).mode or "tailnet");
  cacheCfg = (hostCfg.cache or { });
  cacheNetrc = (cacheCfg.netrc or { });
  selfUpdate = (hostCfg.selfUpdate or { });
  allowMissingSecrets = config.clawlets.bootstrap.allowMissingSecrets;
  fleet = import ../lib/fleet-config.nix { inherit lib project; };
  enableRootPassword = false;
in {
  imports = [
    ../disko/hetzner-ext4.nix
    ../modules/clawlets-image-formats.nix
    ../modules/clawlets-host-baseline.nix
    ../modules/clawlets-self-update.nix
    ../modules/clawdbot-fleet.nix
    ../modules/clf-orchestrator.nix
    ../modules/clawlets-host-meta.nix
  ];

  clawlets.diskDevice = hostCfg.diskDevice or "/dev/sda";

  clawlets.sshExposure.mode = sshExposureMode;

  clawlets.tailnet.mode = tailnetMode;
  clawlets.tailnet.tailscale.authKeySecret =
    if tailnetMode == "tailscale" then "tailscale_auth_key" else null;
  clawlets.operator.deploy.enable =
    ((hostCfg.operator or { }).deploy or { }).enable or false;
  clawlets.cache.substituters =
    if (cacheCfg.substituters or null) != null then (cacheCfg.substituters or [ ]) else [
      "https://cache.nixos.org"
      "https://cache.garnix.io"
    ];
  clawlets.cache.trustedPublicKeys =
    if (cacheCfg.trustedPublicKeys or null) != null then (cacheCfg.trustedPublicKeys or [ ]) else [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g="
    ];

  clawlets.cache.netrc.enable = (cacheNetrc.enable or false);
  clawlets.cache.netrc.secretName = (cacheNetrc.secretName or "garnix_netrc");
  clawlets.cache.netrc.path = (cacheNetrc.path or "/etc/nix/netrc");
  clawlets.cache.netrc.narinfoCachePositiveTtl = (cacheNetrc.narinfoCachePositiveTtl or 3600);

  clawlets.selfUpdate.enable = (selfUpdate.enable or false);
  clawlets.selfUpdate.interval = (selfUpdate.interval or "30min");
  clawlets.selfUpdate.baseUrls = (selfUpdate.baseUrls or [ ]);
  clawlets.selfUpdate.channel = (selfUpdate.channel or "prod");
  clawlets.selfUpdate.publicKeys = (selfUpdate.publicKeys or [ ]);
  clawlets.selfUpdate.previousPublicKeys = (selfUpdate.previousPublicKeys or [ ]);
  clawlets.selfUpdate.previousPublicKeysValidUntil =
    let v = (selfUpdate.previousPublicKeysValidUntil or ""); in if v != "" then v else null;
  clawlets.selfUpdate.allowUnsigned = (selfUpdate.allowUnsigned or false);
  clawlets.selfUpdate.allowRollback = (selfUpdate.allowRollback or false);
  clawlets.selfUpdate.healthCheckUnit =
    let v = (selfUpdate.healthCheckUnit or ""); in if v != "" then v else null;

  # Set these in your own repo (or via a host-specific module).
  # Defaults are provided for Hetzner, but hostName must be set.
  networking.hostName = config.clawlets.hostName;
  networking.nameservers = config.clawlets.nameservers;

  networking.useDHCP = false;
  networking.useNetworkd = true;

  systemd.network.networks."10-uplink" = {
    matchConfig.Name = "en*";
    networkConfig = {
      DHCP = "ipv4";
      IPv6AcceptRA = true;
    };
  };

  time.timeZone = "UTC";
  system.stateVersion = "25.11";

  users.mutableUsers = false;

  sops.secrets.admin_password_hash = lib.mkIf (!allowMissingSecrets) {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
    sopsFile = "${config.clawlets.secrets.hostDir}/admin_password_hash.yaml";
  };

  sops.secrets.root_password_hash = lib.mkIf (!allowMissingSecrets && enableRootPassword) {
    owner = "root";
    group = "root";
    mode = "0400";
    neededForUsers = true;
    sopsFile = "${config.clawlets.secrets.hostDir}/root_password_hash.yaml";
  };

  users.users.admin = {
    isNormalUser = true;
    extraGroups = [ ];
    openssh.authorizedKeys.keys = fleetCfg.sshAuthorizedKeys or [ ];
  }
  // lib.optionalAttrs (!allowMissingSecrets) {
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
  }
  // lib.optionalAttrs allowMissingSecrets {
    hashedPassword = "!";
  };

  # Breakglass: console-only sudo/root access.
  # SSH password auth is disabled, so this user is not reachable over SSH unless you explicitly change SSH settings.
  users.users.breakglass = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
  }
  // lib.optionalAttrs (!allowMissingSecrets) {
    hashedPasswordFile = config.sops.secrets.admin_password_hash.path;
  }
  // lib.optionalAttrs allowMissingSecrets {
    hashedPassword = "!";
  };

  users.users.root.hashedPasswordFile =
    lib.mkIf (!allowMissingSecrets && enableRootPassword) config.sops.secrets.root_password_hash.path;

  security.sudo.extraConfig =
    let
      deploySudo =
        lib.optionalString config.clawlets.operator.deploy.enable ''
          Cmnd_Alias CLAWLETS_DEPLOY = \
            /etc/clawlets/bin/install-secrets --host * --tar * --rev *, \
            /etc/clawlets/bin/install-secrets --host * --tar * --rev * --digest *
        '';
      deployAlias =
        if config.clawlets.operator.deploy.enable
        then ", CLAWLETS_DEPLOY"
        else "";
    in ''
    Cmnd_Alias CLAWDBOT_SYSTEMCTL = \
      /run/current-system/sw/bin/systemctl is-active tailscaled.service, \
      /run/current-system/sw/bin/systemctl is-active tailscaled-autoconnect.service, \
      /run/current-system/sw/bin/systemctl show tailscaled.service, \
      /run/current-system/sw/bin/systemctl show tailscaled-autoconnect.service, \
      /run/current-system/sw/bin/systemctl status clawdbot-*, \
      /run/current-system/sw/bin/systemctl status clawdbot-* --no-pager, \
      /run/current-system/sw/bin/systemctl status clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl status clawdbot-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl start clawdbot-*, \
      /run/current-system/sw/bin/systemctl start clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl stop clawdbot-*, \
      /run/current-system/sw/bin/systemctl stop clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl restart clawdbot-*, \
      /run/current-system/sw/bin/systemctl restart clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl list-timers clawdbot-*, \
      /run/current-system/sw/bin/systemctl list-timers clawdbot-* --all, \
      /run/current-system/sw/bin/systemctl list-timers clawdbot-* --all --no-pager, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-* --no-pager, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl list-units clawdbot-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl list-units --all --plain --legend=false --no-pager clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl show clawdbot-*, \
      /run/current-system/sw/bin/systemctl show clawdbot-*.service, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*, \
      /run/current-system/sw/bin/systemctl cat clawdbot-*.service
    Cmnd_Alias CLAWDBOT_JOURNAL = \
      /run/current-system/sw/bin/journalctl -u clawdbot-* --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * -f --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --since * --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawdbot-* -n * --since * -f --no-pager
    Cmnd_Alias CLAWDBOT_SS = /run/current-system/sw/bin/ss -ltnp
    Cmnd_Alias CLAWDBOT_GH_SYNC_READ = /etc/clawlets/bin/gh-sync-read *
    Cmnd_Alias CLAWDBOT_CHANNELS = /etc/clawlets/bin/clawdbot-channels *
    Cmnd_Alias CLAWLETS_UPDATE_STATUS = /etc/clawlets/bin/update-status
    Cmnd_Alias CLAWLETS_UPDATE_SYSTEMCTL = \
      /run/current-system/sw/bin/systemctl is-active clawlets-update-*, \
      /run/current-system/sw/bin/systemctl is-active clawlets-update-*.service, \
      /run/current-system/sw/bin/systemctl show clawlets-update-*, \
      /run/current-system/sw/bin/systemctl show clawlets-update-*.service, \
      /run/current-system/sw/bin/systemctl status clawlets-update-*, \
      /run/current-system/sw/bin/systemctl status clawlets-update-* --no-pager, \
      /run/current-system/sw/bin/systemctl status clawlets-update-*.service, \
      /run/current-system/sw/bin/systemctl status clawlets-update-*.service --no-pager, \
      /run/current-system/sw/bin/systemctl start clawlets-update-fetch.service, \
      /run/current-system/sw/bin/systemctl start clawlets-update-apply.service, \
      /run/current-system/sw/bin/systemctl list-timers clawlets-update-*, \
      /run/current-system/sw/bin/systemctl list-timers clawlets-update-* --all, \
      /run/current-system/sw/bin/systemctl list-timers clawlets-update-* --all --no-pager
    Cmnd_Alias CLAWLETS_UPDATE_JOURNAL = \
      /run/current-system/sw/bin/journalctl -u clawlets-update-* --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawlets-update-* -n * --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawlets-update-* -n * -f --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawlets-update-* -n * --since * --no-pager, \
      /run/current-system/sw/bin/journalctl -u clawlets-update-* -n * --since * -f --no-pager
    ${deploySudo}
    admin ALL=(root) NOPASSWD: CLAWDBOT_SYSTEMCTL, CLAWDBOT_JOURNAL, CLAWDBOT_SS, CLAWDBOT_GH_SYNC_READ, CLAWDBOT_CHANNELS, CLAWLETS_UPDATE_STATUS, CLAWLETS_UPDATE_SYSTEMCTL, CLAWLETS_UPDATE_JOURNAL${deployAlias}
  '';

  services.clawdbotFleet = {
    enable = hostCfg.enable or false;
    bots = fleet.bots;
    secretEnv = fleet.secretEnv;
    secretFiles = fleet.secretFiles;
    botProfiles = fleet.botProfiles;
    backups = fleet.backups;
    documentsDir = fleet.documentsDir;
    codex = fleet.codex;
    opsSnapshot.enable = true;
    disableBonjour = true;
    agentModelPrimary = hostCfg.agentModelPrimary or "zai/glm-4.7";
  };
}
