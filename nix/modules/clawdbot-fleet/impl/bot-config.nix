{ config, lib, defs }:

let
  inherit (defs) cfg mkChannels getBotProfile resolveBotWorkspace botGatewayPort;

  mkSkillEntries = b:
    let
      profile = getBotProfile b;
      entries = profile.skills.entries or {};
      mkEntry = _: entry:
        let
          env = entry.env or {};
          envSecrets = entry.envSecrets or {};
          envDupes = lib.intersectLists (builtins.attrNames env) (builtins.attrNames envSecrets);
          secretEnv = builtins.mapAttrs (_: secretName: config.sops.placeholder.${secretName}) envSecrets;
          apiKey =
            if (entry.apiKeySecret or null) != null
            then config.sops.placeholder.${entry.apiKeySecret}
            else entry.apiKey or null;
          base = lib.optionalAttrs ((entry.enabled or null) != null) { enabled = entry.enabled; }
            // lib.optionalAttrs (apiKey != null) { apiKey = apiKey; }
            // lib.optionalAttrs ((env != {}) || (envSecrets != {})) { env = env // secretEnv; };
        in
          if envDupes != [] then
            throw "services.clawdbotFleet.botProfiles.${b}.skills.entries has duplicate env keys: ${lib.concatStringsSep "," envDupes}"
          else
            lib.recursiveUpdate base (entry.passthrough or {});
    in
      if entries == {} then null else builtins.mapAttrs mkEntry entries;

  mkSkillsConfig = b:
    let
      profile = getBotProfile b;
      allowBundled = profile.skills.allowBundled or null;
      workspace = resolveBotWorkspace b;
      extraDirs = (profile.skills.load or {}).extraDirs or [];
      effectiveExtraDirs = lib.unique ([ "${workspace}/skills" ] ++ extraDirs);
      entries = mkSkillEntries b;
    in
      lib.optionalAttrs (allowBundled != null) { allowBundled = allowBundled; }
      // lib.optionalAttrs (effectiveExtraDirs != []) { load.extraDirs = effectiveExtraDirs; }
      // lib.optionalAttrs (entries != null) { entries = entries; };

  mkBotConfig = b:
    let
      route = cfg.routing.${b};
      profile = getBotProfile b;
      workspace = resolveBotWorkspace b;
      skipBootstrap =
        if (profile.skipBootstrap or null) != null then profile.skipBootstrap
        else (profile.workspace.seedDir or null) != null;
      modelPrimary = cfg.agentModelPrimary;
      modelEntries =
        if cfg.agentModels != {}
        then cfg.agentModels
        else lib.optionalAttrs (modelPrimary != null) { "${modelPrimary}" = {}; };
      discordBase = {
        enabled = true;
        token = config.sops.placeholder."discord_token_${b}";
        dm = {
          enabled = cfg.discord.dm.enabled;
          policy = cfg.discord.dm.policy;
        };
        guilds = {
          "${cfg.guildId}" = {
            requireMention = route.requireMention;
            channels = mkChannels route.channels route.requireMention;
          };
        };
      };
      discordConfig = discordBase;
      hooksTokenSecret = profile.hooks.tokenSecret or null;
      hooksGmailPushTokenSecret = profile.hooks.gmailPushTokenSecret or null;
      hooksEnabled = profile.hooks.enabled or null;
      hooksConfig =
        lib.optionalAttrs (hooksEnabled != null) { enabled = hooksEnabled; }
        // lib.optionalAttrs (hooksTokenSecret != null) { token = config.sops.placeholder.${hooksTokenSecret}; }
        // lib.optionalAttrs (hooksGmailPushTokenSecret != null) { gmail.pushToken = config.sops.placeholder.${hooksGmailPushTokenSecret}; };
      identityList =
        if cfg.identity != null
        then [
          {
            id = "main";
            default = true;
            identity = cfg.identity;
          }
        ]
        else [];
      gatewayPort =
        if (profile.gatewayPort or null) != null
        then profile.gatewayPort
        else botGatewayPort b;
    in
      lib.recursiveUpdate
        ({
          discord = discordConfig;
          gateway = {
            mode = "local";
            bind = "loopback";
            port = gatewayPort;
          };
          messages = {
            queue = {
              mode = cfg.routingQueue.mode;
              byProvider = cfg.routingQueue.byProvider;
            };
          };
          agents = {
            defaults = {
              workspace = workspace;
              skipBootstrap = skipBootstrap;
            }
            // lib.optionalAttrs (modelPrimary != null) { model.primary = modelPrimary; }
            // lib.optionalAttrs (modelEntries != {}) { models = modelEntries; };
          }
          // lib.optionalAttrs (identityList != []) { list = identityList; };
        }
        // lib.optionalAttrs (hooksConfig != {}) { hooks = hooksConfig; }
        // lib.optionalAttrs ((mkSkillsConfig b) != {}) { skills = mkSkillsConfig b; }
        )
        (profile.passthrough or {});
in
{
  inherit mkSkillEntries mkSkillsConfig mkBotConfig;
}
