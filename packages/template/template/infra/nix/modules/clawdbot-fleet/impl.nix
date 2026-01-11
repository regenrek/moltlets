{ config, lib, pkgs, flakeInfo ? {}, ... }:

let
  cfg = config.services.clawdbotFleet;
  knownBundledSkills = builtins.fromJSON (builtins.readFile ../../../configs/bundled-skills.json);

  resolvedSopsDir =
    if (cfg.sopsDir or null) != null
    then cfg.sopsDir
    else "/var/lib/clawdlets/secrets/hosts/${config.networking.hostName}";

  mkSopsSecret = {
    owner = "root";
    group = "root";
    mode = "0400";
  };

  mkSopsSecretFor = secretName: mkSopsSecret // { sopsFile = "${resolvedSopsDir}/${secretName}.yaml"; };

  resticPaths =
    if cfg.backups.restic.paths != []
    then cfg.backups.restic.paths
    else [ cfg.stateDirBase ] ++ lib.optional cfg.opsSnapshot.enable cfg.opsSnapshot.outDir;

  mkChannels = channels: requireMention:
    lib.listToAttrs (map (ch: {
      name = ch;
      value = {
        allow = true;
        requireMention = requireMention;
      };
    }) channels);

  getBotProfile = b: cfg.botProfiles.${b} or {
    agent = {};
    workspace = {};
    skills = {};
    hooks = {};
    github = {};
    extraConfig = {};
  };

  resolveBotWorkspace = b:
    let
      profile = getBotProfile b;
      stateDir = "${cfg.stateDirBase}/${b}";
    in
      if (profile.agent.workspace or null) != null then profile.agent.workspace else "${stateDir}/workspace";

  resolveBotCredsDir = b: "${cfg.stateDirBase}/${b}/credentials";

  hasGitHubAppAuth =
    lib.any (b:
      let
        gh = (getBotProfile b).github or {};
      in
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null
    ) cfg.bots;

  hasCodingAgent =
    lib.any (b:
      let
        allowBundled = ((getBotProfile b).skills.allowBundled or null);
      in
        allowBundled != null && lib.elem "coding-agent" allowBundled
    ) cfg.bots;

  hasGithubSkill =
    lib.any (b:
      let
        allowBundled = ((getBotProfile b).skills.allowBundled or null);
      in
        allowBundled != null && lib.elem "github" allowBundled
    ) cfg.bots;

  hasGh = hasGithubSkill || hasCodingAgent || cfg.githubSync.enable;

  hasCodex =
    cfg.codex.enable
    || cfg.codex.bots != []
    || hasCodingAgent;

  toolsInventoryMd = pkgs.runCommand "clawdlets-tools.md" {} ''
    set -euo pipefail

    cat >"$out" <<'MD'
## Installed tools (generated)

Do not edit. Generated from NixOS config.

- Base: `clawdbot` (gateway) + `git` + `jq`
MD

    ${lib.optionalString cfg.tools.enable ''
    cat >>"$out" <<'MD'

### Tool bundle binaries
MD
    if [ -d "${cfg.tools.package}/bin" ]; then
      ls -1 "${cfg.tools.package}/bin" | LC_ALL=C sort | sed 's/^/- `/' | sed 's/$/`/' >>"$out"
    else
      echo "- (missing \`bin/\`)" >>"$out"
    fi
    ''}

    ${lib.optionalString (!cfg.tools.enable) ''
    cat >>"$out" <<'MD'

- Tool bundle: disabled (`services.clawdbotFleet.tools.enable = false`)
MD
    ''}

    ${lib.optionalString hasCodex ''
    cat >>"$out" <<MD

### Codex CLI (headless)

- Installed: \`codex\`
- Login (one-time): \`sudo -u bot-<bot> env HOME=${cfg.stateDirBase}/<bot> codex login --device-auth\`
MD
    ''}
  '';

  buildInfoJson = pkgs.writeText "clawdlets-build-info.json" (builtins.toJSON flakeInfo);

  botIndexByName = lib.listToAttrs (lib.imap0 (i: name: { name = name; value = i; }) cfg.bots);

  botIndex = b: botIndexByName.${b} or (throw "unknown bot index for ${b}");

  botGatewayPort = b: cfg.gatewayPortBase + ((botIndex b) * cfg.gatewayPortStride);

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
            base // (entry.extraConfig or {});
    in
      if entries == {} then null else builtins.mapAttrs mkEntry entries;

  mkSkillsConfig = b:
    let
      profile = getBotProfile b;
      allowBundled = profile.skills.allowBundled or null;
      extraDirs = (profile.skills.load or {}).extraDirs or [];
      entries = mkSkillEntries b;
    in
      lib.optionalAttrs (allowBundled != null) { allowBundled = allowBundled; }
      // lib.optionalAttrs (extraDirs != []) { load.extraDirs = extraDirs; }
      // lib.optionalAttrs (entries != null) { entries = entries; };

  mkBotConfig = b:
    let
      route = cfg.routing.${b};
      profile = getBotProfile b;
      workspace = resolveBotWorkspace b;
      skipBootstrap =
        if (profile.agent.skipBootstrap or null) != null then profile.agent.skipBootstrap
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
      discordConfig = lib.recursiveUpdate discordBase cfg.discord.extraConfig;
      hooksTokenSecret = profile.hooks.tokenSecret or null;
      hooksGmailPushTokenSecret = profile.hooks.gmailPushTokenSecret or null;
      hooksEnabled = profile.hooks.enabled or null;
      hooksExtraConfig = profile.hooks.config or {};
      hooksConfig =
        let
          hooksBase =
            lib.optionalAttrs (hooksEnabled != null) { enabled = hooksEnabled; }
            // lib.optionalAttrs (hooksTokenSecret != null) { token = config.sops.placeholder.${hooksTokenSecret}; }
            // lib.optionalAttrs (hooksGmailPushTokenSecret != null) { gmail.pushToken = config.sops.placeholder.${hooksGmailPushTokenSecret}; };
        in
          if hooksTokenSecret != null && lib.hasAttrByPath [ "token" ] hooksExtraConfig then
            throw "services.clawdbotFleet.botProfiles.${b}.hooks.config must not set hooks.token when hooks.tokenSecret is set"
          else if hooksGmailPushTokenSecret != null && lib.hasAttrByPath [ "gmail" "pushToken" ] hooksExtraConfig then
            throw "services.clawdbotFleet.botProfiles.${b}.hooks.config must not set hooks.gmail.pushToken when hooks.gmailPushTokenSecret is set"
          else
            lib.recursiveUpdate hooksBase hooksExtraConfig;
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
    in {
      discord = discordConfig;
      gateway = {
        mode = "local";
        bind = "loopback";
        port = botGatewayPort b;
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
    // (profile.extraConfig or {});

  mkBotSecret = b: {
    "discord_token_${b}" = {
      inherit (mkSopsSecretFor "discord_token_${b}") owner group mode sopsFile;
    };
  };

  mkBotSkillSecrets = b:
    let
      profile = getBotProfile b;
      entries = profile.skills.entries or {};
      botEnvSecrets = builtins.attrValues (profile.envSecrets or {});
      hooksSecrets =
        (lib.optional ((profile.hooks.tokenSecret or null) != null) profile.hooks.tokenSecret)
        ++ (lib.optional ((profile.hooks.gmailPushTokenSecret or null) != null) profile.hooks.gmailPushTokenSecret);
      githubSecrets =
        lib.optional ((profile.github.privateKeySecret or null) != null) profile.github.privateKeySecret;
      perEntrySecrets = lib.concatLists (lib.mapAttrsToList (_: entry:
        (lib.optional ((entry.apiKeySecret or null) != null) entry.apiKeySecret)
        ++ (builtins.attrValues (entry.envSecrets or {}))
      ) entries);
      allSecrets = lib.unique (lib.filter (s: s != null && s != "") (hooksSecrets ++ githubSecrets ++ perEntrySecrets ++ botEnvSecrets));
    in
      builtins.listToAttrs (map (secretName: { name = secretName; value = mkSopsSecretFor secretName; }) allSecrets);

  mkTemplate = b:
    {
      "clawdbot-${b}.json" = {
        owner = "bot-${b}";
        group = "bot-${b}";
        mode = "0400";
        # Important: keep template content pure at eval time.
        # `builtins.readFile (pkgs.formats.json.generate ...)` forces a local build/eval-store write,
        # which breaks remote-build workflows on hosts that reject unsigned local store paths.
        content = builtins.toJSON (mkBotConfig b);
      };
    };

  mkEnvTemplate = b:
    let
      profile = getBotProfile b;
      envSecrets = profile.envSecrets or {};
      secretEnv = builtins.mapAttrs (_: secretName: config.sops.placeholder.${secretName}) envSecrets;
      lines = lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "${k}=${v}") secretEnv);
    in
      lib.optionalAttrs (secretEnv != {}) {
        "clawdbot-${b}.env" = {
          owner = "bot-${b}";
          group = "bot-${b}";
          mode = "0400";
          content = lines + "\n";
        };
      };

  mkBotUser = b: {
    name = "bot-${b}";
    value =
      let
        stateDir = "${cfg.stateDirBase}/${b}";
      in {
        isSystemUser = true;
        group = "bot-${b}";
        home = stateDir;
        createHome = false;
        shell = pkgs.bashInteractive;
      };
  };

  mkBotGroup = b: { name = "bot-${b}"; value = {}; };

  mkStateDir = b:
    let
      dir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      credsDir = resolveBotCredsDir b;
    in [
      "d ${dir} 0700 bot-${b} bot-${b} - -"
      "d ${workspace} 0700 bot-${b} bot-${b} - -"
      "d ${credsDir} 0700 bot-${b} bot-${b} - -"
    ];

  mkGithubTokenService = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      enabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      stateDir = "${cfg.stateDirBase}/${b}";
      credsDir = resolveBotCredsDir b;
      envFile = "${credsDir}/gh.env";
      gitCredsFile = "${credsDir}/git-credentials";
      gitConfigFile = "${stateDir}/.gitconfig";
      privateKeyPath = config.sops.secrets.${gh.privateKeySecret}.path;
      appId = toString gh.appId;
      installationId = toString gh.installationId;
      mintScript = pkgs.writeShellScript "clawdbot-gh-token-${b}" ''
        set -euo pipefail

        b64url() {
          ${pkgs.coreutils}/bin/base64 -w0 | tr '+/' '-_' | tr -d '='
        }

        now="$(${pkgs.coreutils}/bin/date +%s)"
        iat="$((now - 30))"
        exp="$((now + 540))" # GitHub requires exp within 10 minutes

        header='{"alg":"RS256","typ":"JWT"}'
        payload="{\"iat\":$iat,\"exp\":$exp,\"iss\":\"${appId}\"}"

        h64="$(printf '%s' "$header" | b64url)"
        p64="$(printf '%s' "$payload" | b64url)"
        signing_input="$h64.$p64"
        sig="$(
          printf '%s' "$signing_input" \
            | ${pkgs.openssl}/bin/openssl dgst -sha256 -sign '${privateKeyPath}' -binary \
            | b64url
        )"
        jwt="$signing_input.$sig"

        token_json="$(
          ${pkgs.curl}/bin/curl -fsS \
            -X POST \
            -H "Authorization: Bearer $jwt" \
            -H "Accept: application/vnd.github+json" \
            "https://api.github.com/app/installations/${installationId}/access_tokens"
        )"

        token="$(printf '%s' "$token_json" | ${pkgs.jq}/bin/jq -r '.token')"
        if [ -z "$token" ] || [ "$token" = "null" ]; then
          echo "failed to mint GitHub installation token (no .token field)" >&2
          printf '%s\n' "$token_json" >&2
          exit 1
        fi

        umask 077

        tmp_env="$(${pkgs.coreutils}/bin/mktemp)"
        printf 'GH_TOKEN=%s\n' "$token" > "$tmp_env"
        ${pkgs.coreutils}/bin/chown "bot-${b}:bot-${b}" "$tmp_env"
        ${pkgs.coreutils}/bin/chmod 0400 "$tmp_env"
        ${pkgs.coreutils}/bin/mv "$tmp_env" '${envFile}'

        tmp_creds="$(${pkgs.coreutils}/bin/mktemp)"
        printf 'https://x-access-token:%s@github.com\n' "$token" > "$tmp_creds"
        ${pkgs.coreutils}/bin/chown "bot-${b}:bot-${b}" "$tmp_creds"
        ${pkgs.coreutils}/bin/chmod 0600 "$tmp_creds"
        ${pkgs.coreutils}/bin/mv "$tmp_creds" '${gitCredsFile}'

        tmp_gitcfg="$(${pkgs.coreutils}/bin/mktemp)"
        cat > "$tmp_gitcfg" <<EOF
[credential]
	helper = store --file ${gitCredsFile}
EOF
        ${pkgs.coreutils}/bin/chown "bot-${b}:bot-${b}" "$tmp_gitcfg"
        ${pkgs.coreutils}/bin/chmod 0600 "$tmp_gitcfg"
        ${pkgs.coreutils}/bin/mv "$tmp_gitcfg" '${gitConfigFile}'
      '';
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-token-${b}" = {
          description = "Mint GitHub App installation token for bot ${b}";
          after = [ "network-online.target" "sops-nix.service" ];
          wants = [ "network-online.target" "sops-nix.service" ];
          serviceConfig = {
            Type = "oneshot";
            ExecStart = mintScript;

            User = "root";
            Group = "root";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = [ stateDir ];
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

  mkGithubTokenTimer = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      enabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      refreshMinutes = toString (gh.refreshMinutes or 45);
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-token-${b}" = {
          description = "Refresh GitHub App token for bot ${b}";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnBootSec = "2m";
            OnUnitActiveSec = "${refreshMinutes}m";
            RandomizedDelaySec = "2m";
            Persistent = true;
            Unit = "clawdbot-gh-token-${b}.service";
          };
        };
      };

  mkGithubSyncService = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      stateDir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      credsDir = resolveBotCredsDir b;
      ghEnvFile = "${credsDir}/gh.env";
      reposEnv = lib.concatStringsSep " " cfg.githubSync.repos;
      enabled = cfg.githubSync.enable && ghEnabled;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-sync-${b}" = {
          description = "Sync GitHub PRs/issues into bot workspace memory (${b})";
          after = [ "network-online.target" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          wants = [ "network-online.target" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
          serviceConfig = {
            Type = "oneshot";
            User = "bot-${b}";
            Group = "bot-${b}";
            WorkingDirectory = stateDir;
            EnvironmentFile = lib.optional ghEnabled "-${ghEnvFile}";

            NoNewPrivileges = true;
            PrivateTmp = true;
            ProtectSystem = "strict";
            ProtectHome = true;
            ReadWritePaths = lib.unique [ stateDir workspace ];
            UMask = "0077";

            CapabilityBoundingSet = "";
            AmbientCapabilities = "";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
            SystemCallArchitectures = "native";
          };
          path = [ pkgs.bash pkgs.coreutils pkgs.gh pkgs.jq ];
          environment = {
            GH_PAGER = "cat";
            GIT_PAGER = "cat";
            MEMORY_DIR = "${workspace}/memory";
            ORG = cfg.githubSync.org;
          } // lib.optionalAttrs (cfg.githubSync.repos != []) { REPOS = reposEnv; };
          script = ''
            exec /etc/clawdlets/bin/gh-sync
          '';
        };
      };

  mkGithubSyncTimer = b:
    let
      profile = getBotProfile b;
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      enabled = cfg.githubSync.enable && ghEnabled;
    in
      lib.optionalAttrs enabled {
        "clawdbot-gh-sync-${b}" = {
          description = "Periodic GitHub sync for bot ${b}";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnCalendar = cfg.githubSync.schedule;
            RandomizedDelaySec = "2m";
            Persistent = true;
            Unit = "clawdbot-gh-sync-${b}.service";
          };
        };
      };

  mkService = b:
    let
      stateDir = "${cfg.stateDirBase}/${b}";
      workspace = resolveBotWorkspace b;
      profile = getBotProfile b;
      cfgPath = "/run/secrets/rendered/clawdbot-${b}.json";
      clawPkg = cfg.package;
      seedDir = profile.workspace.seedDir or cfg.documentsDir or null;
      credsDir = resolveBotCredsDir b;
      env = profile.env or {};
      envSecrets = profile.envSecrets or {};
      envDupes = lib.intersectLists (builtins.attrNames env) (builtins.attrNames envSecrets);
      gh = profile.github or {};
      ghEnabled =
        (gh.appId or null) != null
        && (gh.installationId or null) != null
        && (gh.privateKeySecret or null) != null;
      ghEnvFile = "${credsDir}/gh.env";
      envSecretsFile =
        if envSecrets == {}
        then null
        else "/run/secrets/rendered/clawdbot-${b}.env";
      seedWorkspaceScript =
        if seedDir != null
        then pkgs.writeShellScript "clawdbot-seed-workspace-${b}" ''
          set -euo pipefail
          ws='${workspace}'
          if [ -z "$(ls -A "$ws" 2>/dev/null || true)" ]; then
            cp -a '${seedDir}/.' "$ws/"

            tools_md='/etc/clawdlets/tools.md'
            if [ -f "$ws/TOOLS.md" ] && [ -r "$tools_md" ]; then
              if ! grep -q 'clawdlets-tools:begin' "$ws/TOOLS.md"; then
                {
                  printf '\n<!-- clawdlets-tools:begin -->\n'
                  cat "$tools_md"
                  printf '\n<!-- clawdlets-tools:end -->\n'
                } >>"$ws/TOOLS.md"
              fi
            fi
          fi
        ''
        else null;
    in {
      name = "clawdbot-${b}";
      value = {
        description = "Clawdbot Discord gateway (${b})";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" "sops-nix.service" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";
        wants = [ "network-online.target" "sops-nix.service" ] ++ lib.optional ghEnabled "clawdbot-gh-token-${b}.service";

        environment =
          if envDupes != []
          then throw "services.clawdbotFleet.botProfiles.${b}.envSecrets has duplicate env keys: ${lib.concatStringsSep "," envDupes}"
          else {
          CLAWDBOT_NIX_MODE = "1";
          CLAWDBOT_STATE_DIR = stateDir;
          CLAWDBOT_CONFIG_PATH = cfgPath;
          HOME = stateDir;
          } // lib.optionalAttrs cfg.disableBonjour { CLAWDBOT_DISABLE_BONJOUR = "1"; }
          // env;

        serviceConfig = {
          User = "bot-${b}";
          Group = "bot-${b}";
          WorkingDirectory = stateDir;

          ExecStartPre = lib.optional (seedWorkspaceScript != null) seedWorkspaceScript;
          ExecStart = "${clawPkg}/bin/clawdbot gateway --allow-unconfigured";

          Restart = "always";
          RestartSec = "3";

          EnvironmentFile = lib.flatten [
            (lib.optional (envSecretsFile != null) "-${envSecretsFile}")
            (lib.optional ghEnabled "-${ghEnvFile}")
          ];

          NoNewPrivileges = true;
          PrivateTmp = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          ReadWritePaths = lib.unique [ stateDir workspace ];
          UMask = "0077";

          CapabilityBoundingSet = "";
          AmbientCapabilities = "";
          LockPersonality = true;
          # Node/V8 JIT needs to toggle executable memory permissions.
          MemoryDenyWriteExecute = false;
          RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_NETLINK" "AF_UNIX" ];
          SystemCallArchitectures = "native";
        };
      };
    };

  perBotSecrets = lib.mkMerge (map mkBotSecret cfg.bots);
  perBotSkillSecrets = lib.mkMerge (map mkBotSkillSecrets cfg.bots);
  perBotTemplates = lib.mkMerge (map mkTemplate cfg.bots);
  perBotEnvTemplates = lib.mkMerge (map mkEnvTemplate cfg.bots);
  sshListen = [
    # NixOS' OpenSSH module formats `ListenAddress` as `${addr}:${port}` when `port` is set.
    # For IPv6 this becomes `:::22` and sshd rejects it. Keep `port = null` and rely on `services.openssh.ports` (default: 22).
    { addr = "0.0.0.0"; port = null; }
    { addr = "::"; port = null; }
  ];

in {
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = builtins.isList knownBundledSkills && lib.all builtins.isString knownBundledSkills;
        message = "infra/configs/bundled-skills.json must be a JSON list of strings.";
      }
      {
        assertion = cfg.guildId != "";
        message = "services.clawdbotFleet.guildId must be set.";
      }
      {
        assertion = lib.all (b: lib.hasAttr b cfg.routing) cfg.bots;
        message = "services.clawdbotFleet.routing must define every bot in services.clawdbotFleet.bots.";
      }
      {
        assertion = lib.all (b: lib.elem b cfg.bots) (builtins.attrNames cfg.botProfiles);
        message = "services.clawdbotFleet.botProfiles keys must be a subset of services.clawdbotFleet.bots.";
      }
      {
        assertion = lib.all (b: lib.elem b cfg.bots) cfg.codex.bots;
        message = "services.clawdbotFleet.codex.bots must be a subset of services.clawdbotFleet.bots.";
      }
      {
        assertion = lib.all (b: ((getBotProfile b).skills.allowBundled or null) != null) cfg.bots;
        message = "services.clawdbotFleet.botProfiles.<bot>.skills.allowBundled must be set (no null allow-all).";
      }
      {
        assertion = (!cfg.githubSync.enable) || (cfg.githubSync.org != "" || cfg.githubSync.repos != []);
        message = "services.clawdbotFleet.githubSync requires githubSync.org or githubSync.repos.";
      }
      {
        assertion =
          (!cfg.githubSync.enable)
          || lib.any (b:
            let
              gh = (getBotProfile b).github or {};
            in
              (gh.appId or null) != null
              && (gh.installationId or null) != null
              && (gh.privateKeySecret or null) != null
          ) cfg.bots;
        message = "services.clawdbotFleet.githubSync.enable requires at least one botProfiles.<bot>.github App config.";
      }
      {
        assertion =
          lib.all (b:
            let
              allow = (getBotProfile b).skills.allowBundled or null;
            in
              allow == null || lib.all (s: lib.elem s knownBundledSkills) allow
          ) cfg.bots;
        message = "services.clawdbotFleet.botProfiles.<bot>.skills.allowBundled contains unknown skills (see infra/configs/bundled-skills.json).";
      }
      {
        assertion =
          lib.all (b:
            let
              allow = (getBotProfile b).skills.allowBundled or null;
              gh = (getBotProfile b).github or {};
            in
              !(allow != null && lib.elem "github" allow)
              || ((gh.appId or null) != null && (gh.installationId or null) != null && (gh.privateKeySecret or null) != null && (gh.privateKeySecret or "") != "")
          ) cfg.bots;
        message = "bundled skill \"github\" requires botProfiles.<bot>.github.{ appId, installationId, privateKeySecret }.";
      }
      {
        assertion =
          lib.all (b:
            let
              allow = (getBotProfile b).skills.allowBundled or null;
              brave = (getBotProfile b).skills.entries."brave-search" or {};
              apiKeySecret = brave.apiKeySecret or null;
              envSecrets = brave.envSecrets or {};
            in
              !(allow != null && lib.elem "brave-search" allow)
              || ((apiKeySecret != null && apiKeySecret != "") || envSecrets != {})
          ) cfg.bots;
        message = "bundled skill \"brave-search\" requires botProfiles.<bot>.skills.entries.\"brave-search\".{ apiKeySecret or envSecrets }.";
      }
      {
        assertion =
          (!cfg.backups.restic.enable)
          || (cfg.backups.restic.repository != "" && cfg.backups.restic.passwordSecret != "");
        message = "services.clawdbotFleet.backups.restic requires repository + passwordSecret when enabled.";
      }
      {
        assertion =
          (!cfg.tailscale.enable)
          || (cfg.tailscale.authKeySecret != null && cfg.tailscale.authKeySecret != "");
        message = "services.clawdbotFleet.tailscale.authKeySecret must be set when tailscale is enabled.";
      }
    ];

    swapDevices = lib.mkDefault [
      {
        device = "/var/lib/swapfile";
        size = 16384;
      }
    ];

    nix.settings = {
      max-jobs = lib.mkDefault 1;
      cores = lib.mkDefault 2;

      extra-substituters = lib.mkDefault [ "https://cache.garnix.io" ];
      extra-trusted-public-keys = lib.mkDefault [
        "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g="
      ];
    };

    boot.loader.grub = {
      enable = true;
      efiSupport = false;
      useOSProber = false;
    };

    boot.initrd.availableKernelModules = [
      "virtio_pci"
      "virtio_scsi"
      "virtio_blk"
      "virtio_net"
    ];

    services.qemuGuest.enable = true;

    services.openssh = {
      enable = true;
      openFirewall = false;
      settings = {
        PasswordAuthentication = false;
        KbdInteractiveAuthentication = false;
        PermitRootLogin = "no";
        AllowUsers = [ "admin" ];
      };
      listenAddresses = sshListen;
    };

    security.sudo.wheelNeedsPassword = true;

    networking.firewall = {
      enable = true;
      allowedTCPPorts = lib.mkIf cfg.bootstrapSsh [ 22 ];
      interfaces.tailscale0.allowedTCPPorts =
        lib.mkIf (!cfg.bootstrapSsh && cfg.tailscale.enable) [ 22 ];
    };

    networking.nftables.enable = true;
    networking.nftables.ruleset = builtins.readFile ../../nftables/egress-block.nft;

    services.tailscale = lib.mkIf cfg.tailscale.enable {
      enable = true;
      openFirewall = cfg.tailscale.openFirewall;
      authKeyFile = lib.mkIf (cfg.tailscale.authKeySecret != null)
        config.sops.secrets.${cfg.tailscale.authKeySecret}.path;
      extraUpFlags = lib.optional cfg.tailscale.ssh "--ssh";
    };

    sops = {
      age.keyFile = cfg.sopsAgeKeyFile;
      validateSopsFiles = false;

      secrets = lib.mkMerge [
        perBotSecrets
        perBotSkillSecrets
        (lib.optionalAttrs (cfg.tailscale.enable && cfg.tailscale.authKeySecret != null) {
          "${cfg.tailscale.authKeySecret}" = mkSopsSecretFor cfg.tailscale.authKeySecret;
        })
        (lib.optionalAttrs (cfg.backups.restic.enable && cfg.backups.restic.passwordSecret != "") {
          "${cfg.backups.restic.passwordSecret}" = mkSopsSecretFor cfg.backups.restic.passwordSecret;
        })
        (lib.optionalAttrs (cfg.backups.restic.enable && cfg.backups.restic.environmentSecret != null && cfg.backups.restic.environmentSecret != "") {
          "${cfg.backups.restic.environmentSecret}" = mkSopsSecretFor cfg.backups.restic.environmentSecret;
        })
      ];

      templates = lib.mkMerge [ perBotTemplates perBotEnvTemplates ];
    };

    users.users = builtins.listToAttrs (map mkBotUser cfg.bots);
    users.groups = builtins.listToAttrs (map mkBotGroup cfg.bots);

    systemd.tmpfiles.rules =
      (lib.concatLists (map mkStateDir cfg.bots))
      ++ lib.optionals cfg.opsSnapshot.enable [
        "d ${cfg.opsSnapshot.outDir} 0750 root root - -"
      ];

    environment.etc."clawdlets/tools.md" = {
      source = toolsInventoryMd;
      mode = "0444";
    };

    environment.etc."clawdlets/build-info.json" = {
      source = buildInfoJson;
      mode = "0444";
    };

    environment.etc."clawdlets/bin/gh-sync" = {
      source = ../../../../../../../scripts/gh-sync.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/bin/gh-sync-read" = {
      source = ../../../../../../../scripts/gh-sync-read.sh;
      mode = "0755";
    };

    environment.etc."clawdlets/bin/ops-snapshot" = {
      source = ../../../../../../../scripts/ops-snapshot.sh;
      mode = "0755";
    };

    environment.systemPackages =
      [ cfg.package pkgs.git pkgs.jq ]
      ++ lib.optional cfg.tools.enable cfg.tools.package
      ++ lib.optional hasCodex pkgs.codex
      ++ lib.optional cfg.backups.restic.enable pkgs.restic
      ++ lib.optionals hasGitHubAppAuth [ pkgs.curl pkgs.openssl ]
      ++ lib.optional hasGh pkgs.gh
      ++ lib.optional hasCodingAgent pkgs.glab
      ++ lib.optional cfg.tailscale.enable pkgs.tailscale;

    systemd.services = lib.mkMerge [
      (builtins.listToAttrs (map mkService cfg.bots))
      (lib.mkMerge (map mkGithubTokenService cfg.bots))
      (lib.mkMerge (map mkGithubSyncService cfg.bots))
      (lib.optionalAttrs cfg.opsSnapshot.enable {
        clawdlets-ops-snapshot = {
          description = "Clawdlets ops snapshot (no secrets)";
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
            exec /etc/clawdlets/bin/ops-snapshot
          '';
        };
      })
    ];

    systemd.timers = lib.mkMerge [
      (lib.mkMerge (map mkGithubTokenTimer cfg.bots))
      (lib.mkMerge (map mkGithubSyncTimer cfg.bots))
      (lib.optionalAttrs cfg.opsSnapshot.enable {
        clawdlets-ops-snapshot = {
          description = "Periodic clawdlets ops snapshot";
          wantedBy = [ "timers.target" ];
          timerConfig = {
            OnCalendar = cfg.opsSnapshot.schedule;
            RandomizedDelaySec = "5m";
            Persistent = true;
            Unit = "clawdlets-ops-snapshot.service";
          };
        };
      })
    ];

    services.restic.backups = lib.mkIf cfg.backups.restic.enable {
      clawdbotFleet = {
        repository = cfg.backups.restic.repository;
        passwordFile = config.sops.secrets.${cfg.backups.restic.passwordSecret}.path;
        environmentFile =
          if cfg.backups.restic.environmentSecret != null
          then config.sops.secrets.${cfg.backups.restic.environmentSecret}.path
          else null;
        paths = resticPaths;
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
