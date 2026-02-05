{ lib, project, hostName }:
let
  cfg = project.config;
  fleetCfg = (cfg.fleet or { });
  hostCfg =
    if hostName == null || hostName == ""
    then builtins.throw "hostName is required for fleet-config.nix"
    else (cfg.hosts.${hostName} or (builtins.throw "unknown host in config.hosts"));

  _ =
    if builtins.hasAttr "guildId" fleetCfg
    then builtins.throw "fleet.guildId was removed; configure Discord in hosts.<host>.gateways.<gatewayId>.channels.discord instead"
    else if builtins.hasAttr "modelSecrets" fleetCfg
    then builtins.throw "fleet.modelSecrets was removed; use fleet.secretEnv (ENV_VAR -> sops secret name)"
    else null;

  gatewaysById = hostCfg.gateways or { };

  # Single source of truth for gateway instances (deterministic order).
  gateways =
    let
      order = hostCfg.gatewaysOrder or [ ];
      derived =
        if builtins.isList order && order != [] then order
        else if builtins.isAttrs gatewaysById then builtins.attrNames gatewaysById
        else [ ];
    in
      if derived == [] then builtins.throw "hosts.<host>.gateways must define at least one gateway id"
      else derived;

  baseGateway = {
    secretEnv = {};
    secretEnvAllowlist = null;
    secretFiles = {};
    hooks = {};
    skills = {
      # Explicit allowlist required on servers. Avoid null (typically means “allow all bundled skills”).
      allowBundled = [ ];
      entries = { };
    };
    gatewayPort = null;
    passthrough = { };
  };

  mkGatewayProfile = b:
    let
      gatewayCfg = gatewaysById.${b} or { };
      profile = gatewayCfg.profile or { };
      _ =
        if builtins.hasAttr "discordTokenSecret" profile
        then builtins.throw "hosts.<host>.gateways.<gatewayId>.profile.discordTokenSecret was removed; use profile.secretEnv.DISCORD_BOT_TOKEN"
        else if builtins.hasAttr "modelSecrets" profile
        then builtins.throw "hosts.<host>.gateways.<gatewayId>.profile.modelSecrets was removed; use profile.secretEnv (OPENAI_API_KEY/etc)"
        else null;
      openclaw = gatewayCfg.openclaw or { };
      channels = gatewayCfg.channels or { };
      agents = gatewayCfg.agents or { };
      hooks = gatewayCfg.hooks or { };
      skills = gatewayCfg.skills or { };
      plugins = gatewayCfg.plugins or { };
      merged =
        let
          baseMerged = lib.recursiveUpdate baseGateway profile;
          mergedSkills =
            if skills == { }
            then baseMerged.skills or { }
            else lib.recursiveUpdate (baseMerged.skills or { }) skills;
        in
          baseMerged // { hooks = hooks; skills = mergedSkills; };
    in
      merged // {
        passthrough =
          lib.recursiveUpdate
            (lib.recursiveUpdate (merged.passthrough or { }) openclaw)
            {
              channels = channels;
              agents = agents;
              plugins = plugins;
            };
      };
in {
  inherit gateways;

  # Workspace seed root (common + per-gateway overlay). See fleet/workspaces/.
  documentsDir = project.root + "/fleet/workspaces";

  secretEnv = fleetCfg.secretEnv or {};
  secretFiles = fleetCfg.secretFiles or {};

  codex = {
    enable = (fleetCfg.codex or { }).enable or false;
    gateways = lib.filter (b: lib.elem b gateways) ((fleetCfg.codex or { }).gateways or [ ]);
  };

  gatewayProfiles = lib.genAttrs gateways mkGatewayProfile;

  backups = {
    restic = {
      enable = ((fleetCfg.backups or { }).restic or { }).enable or false;
      repository = ((fleetCfg.backups or { }).restic or { }).repository or "";
      passwordSecret = "restic_password";
      environmentSecret = null;
    };
  };
}
