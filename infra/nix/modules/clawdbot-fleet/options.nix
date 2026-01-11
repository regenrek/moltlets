{ lib, pkgs, nix-clawdbot, ... }:

let
  sourceInfo = import ../../sources/clawdbot-source.nix;
  steipetePkgs =
    if nix-clawdbot ? inputs && nix-clawdbot.inputs ? nix-steipete-tools
       && nix-clawdbot.inputs.nix-steipete-tools ? packages
       && builtins.hasAttr pkgs.system nix-clawdbot.inputs.nix-steipete-tools.packages
    then nix-clawdbot.inputs.nix-steipete-tools.packages.${pkgs.system}
    else {};
  clawdbotPackages = import "${nix-clawdbot.outPath}/nix/packages" {
    inherit pkgs sourceInfo steipetePkgs;
  };
in {
  options.services.clawdbotFleet = {
    enable = lib.mkEnableOption "Clawdbot fleet";

    package = lib.mkOption {
      type = lib.types.package;
      default = clawdbotPackages.clawdbot-gateway;
      description = "Clawdbot package used by fleet services.";
    };

    tools = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Install the optional Clawdbot tools bundle into the system PATH.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = clawdbotPackages.clawdbot-tools;
        description = "Clawdbot tools package installed when tools.enable is true.";
      };
    };

    codex = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Install the Codex CLI on the host (headless usage).";
      };
      bots = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Bots expected to use Codex CLI (for documentation + onboarding).";
      };
    };

    bots = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "maren" "sonja" "gunnar" "melinda" ];
      description = "Bot instance names (also used for system users).";
    };

    guildId = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Discord guild ID for routing.";
    };

    gatewayPortBase = lib.mkOption {
      type = lib.types.int;
      default = 18789;
      description = "Base port for per-bot gateway servers.";
    };

    gatewayPortStride = lib.mkOption {
      type = lib.types.int;
      default = 10;
      description = "Port stride per bot (port = base + bot index * stride).";
    };

    routing = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          channels = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [];
            description = "Allowed Discord channels for this bot (slugged names).";
          };
          requireMention = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "Require mention in allowed channels.";
          };
        };
      });
      default = {};
      description = "Per-bot routing rules.";
    };

    routingQueue = {
      mode = lib.mkOption {
        type = lib.types.enum [ "queue" "interrupt" ];
        default = "interrupt";
        description = "Queue mode when a run is active.";
      };
      byProvider = lib.mkOption {
        type = lib.types.attrs;
        default = { discord = "queue"; };
        description = "Per-provider queue mode overrides.";
      };
    };

    githubSync = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Periodically sync GitHub PRs/issues into each bot workspace memory dir (pure IO inventory).";
      };
      schedule = lib.mkOption {
        type = lib.types.str;
        default = "*:0/15";
        description = "systemd OnCalendar schedule for GitHub sync (default: every 15 minutes).";
      };
      org = lib.mkOption {
        type = lib.types.str;
        default = "clawdbot";
        description = "GitHub org to sync when repos is empty.";
      };
      repos = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Optional explicit repo list (owner/repo). When set, org listing is skipped.";
      };
    };

    opsSnapshot = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Write periodic host ops snapshots to disk (no secrets; for debugging and drift detection).";
      };
      schedule = lib.mkOption {
        type = lib.types.str;
        default = "daily";
        description = "systemd OnCalendar schedule for ops snapshot.";
      };
      outDir = lib.mkOption {
        type = lib.types.str;
        default = "/var/lib/clawdlets/ops/snapshots";
        description = "Directory holding JSON snapshots (latest.json + timestamped files).";
      };
      keepDays = lib.mkOption {
        type = lib.types.int;
        default = 30;
        description = "Retention: delete snapshot files older than this many days (0 disables).";
      };
      keepLast = lib.mkOption {
        type = lib.types.int;
        default = 200;
        description = "Retention: keep at most this many snapshot files (0 disables).";
      };
    };

    agentModelPrimary = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Default model for agents (provider/model), e.g. zai/glm-4.7.";
    };

    agentModels = lib.mkOption {
      type = lib.types.attrs;
      default = {};
      description = "Additional model entries for agents.defaults.models.";
    };

    documentsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "Optional documents directory (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md) seeded into bot workspaces.";
    };

    identity = lib.mkOption {
      type = lib.types.nullOr lib.types.attrs;
      default = null;
      description = "Default agent identity injected into agents.list (name/emoji/etc).";
    };

    discord = {
      dm = {
        enabled = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Enable Discord DMs.";
        };
        policy = lib.mkOption {
          type = lib.types.enum [ "pairing" "allowlist" "open" "disabled" ];
          default = "disabled";
          description = "Discord DM policy.";
        };
      };

      extraConfig = lib.mkOption {
        type = lib.types.attrs;
        default = {};
        description = "Extra Discord config merged into each bot config.";
      };
    };

    disableBonjour = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Disable Bonjour/mDNS discovery (sets CLAWDBOT_DISABLE_BONJOUR=1).";
    };

    botProfiles = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
        options = {
          agent = {
            workspace = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Override agent.workspace for this bot (defaults to <stateDir>/workspace).";
            };
            skipBootstrap = lib.mkOption {
              type = lib.types.nullOr lib.types.bool;
              default = null;
              description = "Override agent.skipBootstrap for this bot (defaults true when workspace.seedDir is set).";
            };
          };

          env = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Per-bot service env vars (non-secret).";
          };

          envSecrets = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Map of env var name -> sops secret name for bot service env.";
          };

          workspace = {
            seedDir = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "Optional workspace seed directory copied into an empty workspace before first start.";
            };
          };

          skills = {
            allowBundled = lib.mkOption {
              type = lib.types.nullOr (lib.types.listOf lib.types.str);
              default = null;
              description = "Per-bot skills.allowBundled (bundled skill allowlist).";
            };
            load = {
              extraDirs = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [];
                description = "Per-bot skills.load.extraDirs.";
              };
            };
            entries = lib.mkOption {
              type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
                options = {
                  enabled = lib.mkOption {
                    type = lib.types.nullOr lib.types.bool;
                    default = null;
                    description = "Enable/disable the skill explicitly.";
                  };
                  apiKey = lib.mkOption {
                    type = lib.types.nullOr lib.types.str;
                    default = null;
                    description = "Inline apiKey (prefer apiKeySecret for secrets).";
                  };
                  apiKeySecret = lib.mkOption {
                    type = lib.types.nullOr lib.types.str;
                    default = null;
                    description = "Sops secret name used as skills.entries.<skill>.apiKey.";
                  };
                  env = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "Inline env vars merged into skills.entries.<skill>.env.";
                  };
                  envSecrets = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "Map of env var name -> sops secret name (injected into skills.entries.<skill>.env).";
                  };
                  extraConfig = lib.mkOption {
                    type = lib.types.attrs;
                    default = {};
                    description = "Additional per-skill config (Clawdbot passthrough).";
                  };
                };
              }));
              default = {};
              description = "Per-bot skills.entries with secret injection support.";
            };
          };

          hooks = {
            enabled = lib.mkOption {
              type = lib.types.nullOr lib.types.bool;
              default = null;
              description = "Per-bot hooks.enabled (set true to enable webhooks).";
            };
            tokenSecret = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Sops secret name used as hooks.token.";
            };
            gmailPushTokenSecret = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Sops secret name used as hooks.gmail.pushToken.";
            };
            config = lib.mkOption {
              type = lib.types.attrs;
              default = {};
              description = "Extra hooks config merged into hooks (gmail/topic/subscription/hookUrl/etc).";
            };
          };

          github = {
            appId = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "GitHub App ID used to mint installation tokens for gh/git.";
            };
            installationId = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "GitHub App installation ID for the target org/repo set.";
            };
            privateKeySecret = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Sops secret name containing the GitHub App private key PEM.";
            };
            refreshMinutes = lib.mkOption {
              type = lib.types.int;
              default = 45;
              description = "Refresh interval for GitHub installation tokens (minutes).";
            };
          };

          extraConfig = lib.mkOption {
            type = lib.types.attrs;
            default = {};
            description = "Extra Clawdbot config merged into this bot's root config.";
          };
        };
      }));
      default = {};
      description = "Per-bot profile config (skills/workspace/agent overrides).";
    };

    backups = {
      restic = {
        enable = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Enable restic backups for the fleet state dirs.";
        };
        repository = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Restic repository (e.g. s3:s3.amazonaws.com/bucket/path).";
        };
        passwordSecret = lib.mkOption {
          type = lib.types.str;
          default = "";
          description = "Sops secret name containing the restic repository password.";
        };
        environmentSecret = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          description = "Optional sops secret name containing restic env file contents (AWS_* etc).";
        };
        paths = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [];
          description = "Paths to back up (empty => defaults to stateDirBase).";
        };
        timerConfig = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { OnCalendar = "daily"; RandomizedDelaySec = "1h"; Persistent = "true"; };
          description = "systemd timer config for restic backup job.";
        };
      };
    };

    stateDirBase = lib.mkOption {
      type = lib.types.str;
      default = "/srv/clawdbot";
      description = "Base directory for per-bot state dirs.";
    };

    sopsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Directory containing encrypted sops YAML files on the host filesystem (one secret per file).

        Recommended (keeps secrets out of the Nix store):
        - /var/lib/clawdlets/secrets/hosts/<host>/

        If null, defaults to /var/lib/clawdlets/secrets/hosts/<host>/ (derived from networking.hostName).
      '';
    };

    sopsAgeKeyFile = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/sops-nix/key.txt";
      description = "Path to the age key on the host.";
    };

    bootstrapSsh = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Allow public SSH during initial bootstrap.";
    };

    tailscale = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Enable Tailscale on the host (recommended for admin access).";
      };

      openFirewall = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Allow Tailscale UDP/DERP ports via firewall (services.tailscale.openFirewall).";
      };

      ssh = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Enable Tailscale SSH (tailscale up --ssh).";
      };

      authKeySecret = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Sops secret name containing a Tailscale auth key for non-interactive login.";
      };
    };
  };
}
