{ lib, pkgs, nix-openclaw, ... }:

let
  system = pkgs.system;
  openclawPkgs =
    nix-openclaw.packages.${system} or
      (throw "nix-openclaw.packages.${system} missing (must consume flake outputs, not outPath internals)");
  invariants = builtins.fromJSON (builtins.readFile ../../lib/openclaw-invariants.json);

  normalizeJson = v: builtins.fromJSON (builtins.toJSON v);
in {
  options.services.openclawFleet = {
    enable = lib.mkEnableOption "OpenClaw fleet";

    package = lib.mkOption {
      type = lib.types.package;
      default = openclawPkgs.openclaw-gateway;
      description = "OpenClaw package used by fleet services.";
    };

    tools = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Install the optional OpenClaw tools bundle into the system PATH.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = openclawPkgs.openclaw-tools;
        description = "OpenClaw tools package installed when tools.enable is true.";
      };
    };

    codex = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Install the Codex CLI on the host (headless usage).";
      };
      gateways = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Gateways expected to use Codex CLI (for documentation + onboarding).";
      };
    };

    gateways = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ "maren" "sonja" "gunnar" "melinda" ];
      description = "Gateway instance names (also used for system users).";
    };

    secretEnv = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "Global secret env mapping (ENV_VAR -> sops secret name). Merged into each gateway's env file; per-gateway overrides via gatewayProfiles.<gateway>.secretEnv.";
    };

    secretFiles = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
        options = {
          secretName = lib.mkOption {
            type = lib.types.str;
            description = "Sops secret name for this file.";
          };
          targetPath = lib.mkOption {
            type = lib.types.strMatching "^/var/lib/clawlets/.*";
            description = "Absolute target path for the rendered secret file (host-scoped; must be under /var/lib/clawlets/).";
          };
          mode = lib.mkOption {
            type = lib.types.str;
            default = "0400";
            description = "File mode (octal string).";
          };
          owner = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Optional file owner (default: root).";
          };
          group = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Optional file group (default: root).";
          };
          format = lib.mkOption {
            type = lib.types.nullOr (lib.types.enum [ "raw" "dotenv" "json" "yaml" ]);
            default = null;
            description = "Optional format hint (currently raw-only; future expansion).";
          };
        };
      }));
      default = {};
      description = "Host-scoped secret files (id -> spec).";
    };

    gatewayPortBase = lib.mkOption {
      type = lib.types.int;
      default = invariants.defaults.gatewayPortBase;
      description = "Base port for per-gateway OpenClaw servers.";
    };

    gatewayPortStride = lib.mkOption {
      type = lib.types.int;
      default = invariants.defaults.gatewayPortStride;
      description = "Port stride per gateway (port = base + gateway index * stride).";
    };

    githubSync = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Periodically sync GitHub PRs/issues into each gateway workspace memory dir (pure IO inventory).";
      };
      schedule = lib.mkOption {
        type = lib.types.str;
        default = "*:0/15";
        description = "systemd OnCalendar schedule for GitHub sync (default: every 15 minutes).";
      };
      org = lib.mkOption {
        type = lib.types.str;
        default = "openclaw";
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
        default = "/var/lib/clawlets/ops/snapshots";
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
      description = ''
        Optional workspace seed root for docs and prompt policy.

        Expected structure:
        - common/<files> (shared)
        - gateways/<gateway>/<files> (per-gateway overrides; overlay on common)

        On start:
        - seeds empty workspaces (common then gateway overlay)
        - syncs a managed allowlist (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, USER.md, HEARTBEAT.md) into the workspace
      '';
    };

    disableBonjour = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Disable Bonjour/mDNS discovery (sets OPENCLAW_DISABLE_BONJOUR=1).";
    };

    hardening = {
      nodeExecMem = lib.mkOption {
        type = lib.types.enum [ "jit" "jitless" ];
        default = "jit";
        description = ''
          Node/V8 execution mode.

          - jit: allows W^X violations (required for default Node JIT); sets MemoryDenyWriteExecute=false.
          - jitless: sets MemoryDenyWriteExecute=true and sets NODE_OPTIONS=--jitless (may impact performance/compat).
        '';
      };
    };

    resources = {
      memoryMax = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = "4G";
        description = "systemd MemoryMax default for gateway services (null disables).";
      };
      cpuQuota = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = "200%";
        description = "systemd CPUQuota default for gateway services (null disables).";
      };
      tasksMax = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = 4096;
        description = "systemd TasksMax default for gateway services (null disables).";
      };
      ioWeight = lib.mkOption {
        type = lib.types.nullOr lib.types.int;
        default = null;
        description = "systemd IOWeight default for gateway services (null disables).";
      };
    };

    gatewayProfiles = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
        options = {
          skipBootstrap = lib.mkOption {
            type = lib.types.nullOr lib.types.bool;
            default = null;
            description = "Override agents.defaults.skipBootstrap for this gateway (defaults true when workspace.seedDir is set).";
          };

          env = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Per-gateway service env vars (non-secret).";
          };

          secretEnv = lib.mkOption {
            type = lib.types.attrsOf lib.types.str;
            default = {};
            description = "Per-gateway secret env mapping (ENV_VAR -> sops secret name) merged into the gateway env file.";
          };

          secretEnvAllowlist = lib.mkOption {
            type = lib.types.nullOr (lib.types.listOf lib.types.str);
            default = null;
            description = "Optional allowlist of secret env vars written into this gateway's env file (least-privilege injection).";
          };

          secretFiles = lib.mkOption {
            type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
              options = {
                secretName = lib.mkOption {
                  type = lib.types.str;
                  description = "Sops secret name for this file.";
                };
                targetPath = lib.mkOption {
                  type = lib.types.str;
                  description = "Absolute target path for the rendered secret file (gateway-scoped; must be under the gateway state dir).";
                };
                mode = lib.mkOption {
                  type = lib.types.str;
                  default = "0400";
                  description = "File mode (octal string).";
                };
                owner = lib.mkOption {
                  type = lib.types.nullOr lib.types.str;
                  default = null;
                  description = "Optional file owner (default: gateway user).";
                };
                group = lib.mkOption {
                  type = lib.types.nullOr lib.types.str;
                  default = null;
                  description = "Optional file group (default: gateway group).";
                };
                format = lib.mkOption {
                  type = lib.types.nullOr (lib.types.enum [ "raw" "dotenv" "json" "yaml" ]);
                  default = null;
                  description = "Optional format hint (currently raw-only; future expansion).";
                };
              };
            }));
            default = {};
            description = "Per-gateway secret files (id -> spec).";
          };

          workspace = {
            dir = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Workspace directory (defaults to <stateDir>/workspace).";
            };
            seedDir = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = "Optional per-gateway workspace seed root (same overlay structure as services.openclawFleet.documentsDir); also enables managed-docs sync on each start.";
            };
          };

          skills = {
            allowBundled = lib.mkOption {
              type = lib.types.nullOr (lib.types.listOf lib.types.str);
              default = null;
              description = "Per-gateway skills.allowBundled (bundled skill allowlist).";
            };
            load = {
              extraDirs = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                default = [];
                description = "Per-gateway skills.load.extraDirs.";
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
                    description = "Inline apiKey (deprecated; use apiKeySecret + env var injection).";
                  };
          apiKeySecret = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Sops secret name used to set skills.entries.<skill>.apiKey via OPENCLAW_SKILL_<SKILL>_API_KEY.";
          };
                  env = lib.mkOption {
                    type = lib.types.attrsOf lib.types.str;
                    default = {};
                    description = "Inline env vars merged into skills.entries.<skill>.env.";
                  };
                  passthrough = lib.mkOption {
                    type = lib.types.attrs;
                    default = {};
                    apply = normalizeJson;
                    description = "Additional per-skill config (passthrough; forward-compat).";
                  };
                };
              }));
              default = {};
              description = "Per-gateway skills.entries with secret injection support.";
            };
          };

          hooks = {
            enabled = lib.mkOption {
              type = lib.types.nullOr lib.types.bool;
              default = null;
              description = "Per-gateway hooks.enabled (set true to enable webhooks).";
            };
          tokenSecret = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Sops secret name injected as hooks.token via OPENCLAW_HOOKS_TOKEN.";
          };
          gmailPushTokenSecret = lib.mkOption {
            type = lib.types.nullOr lib.types.str;
            default = null;
            description = "Sops secret name injected as hooks.gmail.pushToken via OPENCLAW_HOOKS_GMAIL_PUSH_TOKEN.";
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

          passthrough = lib.mkOption {
            type = lib.types.attrs;
            default = {};
            apply = normalizeJson;
            description = "Extra OpenClaw config merged into this gateway's root config (passthrough; forward-compat).";
          };

          gatewayPort = lib.mkOption {
            type = lib.types.nullOr lib.types.int;
            default = null;
            description = "Optional per-gateway gateway port override (otherwise computed from gatewayPortBase/Stride).";
          };

          resources = {
            memoryMax = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Per-gateway override for MemoryMax (null uses global default).";
            };
            cpuQuota = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Per-gateway override for CPUQuota (null uses global default).";
            };
            tasksMax = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "Per-gateway override for TasksMax (null uses global default).";
            };
            ioWeight = lib.mkOption {
              type = lib.types.nullOr lib.types.int;
              default = null;
              description = "Per-gateway override for IOWeight (null uses global default).";
            };
          };
        };
      }));
      default = {};
      description = "Per-gateway profile config (service/runtime + secret injection + passthrough).";
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
      default = invariants.defaults.stateDirBase;
      description = "Base directory for per-gateway state dirs.";
    };
  };
}
