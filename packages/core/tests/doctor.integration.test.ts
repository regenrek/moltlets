import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sopsPathRegexForDirFiles, sopsPathRegexForPathSuffix } from "../src/lib/security/sops-config";
import { makeEd25519PublicKey } from "./helpers/ssh-keys";

let mockFleetMain: any = null;
let mockFleetTemplate: any = null;
let mockWheelMain: any = null;
let mockWheelTemplate: any = null;
let templateRoot = "";

vi.mock("../src/lib/runtime/run.js", () => ({
  capture: vi.fn(async (_cmd: string, args: string[], opts?: any) => {
    if (args.includes("--version")) return "nix (mock) 2.0";
    if (args[0] === "eval" || args.includes("eval")) {
      const isTemplate = String(opts?.cwd || "") === templateRoot;
      const expr = String(args[args.length - 1] || "");
      if (expr.includes("adminHasWheel") || expr.includes("breakglassHasWheel")) {
        return JSON.stringify(isTemplate ? mockWheelTemplate : mockWheelMain);
      }
      return JSON.stringify(isTemplate ? mockFleetTemplate : mockFleetMain);
    }
    return "";
  }),
  run: vi.fn(async () => {}),
  captureWithInput: vi.fn(async () => ""),
}));

vi.mock("../src/lib/vcs/git.js", () => ({
  tryGetOriginFlake: vi.fn(async () => null),
}));

vi.mock("../src/lib/vcs/github.js", () => ({
  tryParseGithubFlakeUri: vi.fn((flakeBase: string) => {
    const m = flakeBase.trim().match(/^github:([^/]+)\/([^/]+)(?:\/.*)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
  }),
  checkGithubRepoVisibility: vi.fn(async () => ({ ok: true, status: "public" })),
}));

describe("doctor", () => {
  let repoRoot = "";
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "clawlets-doctor-"));
    templateRoot = path.join(repoRoot, "__template__");
    process.env.CLAWLETS_TEMPLATE_DIR = templateRoot;
    await writeFile(path.join(repoRoot, "flake.nix"), "{ }", "utf8");
    await mkdir(path.join(repoRoot, "scripts"), { recursive: true });
    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await mkdir(path.join(repoRoot, "fleet", "workspaces", "common"), { recursive: true });
    await mkdir(path.join(templateRoot, "docs"), { recursive: true });
    await mkdir(path.join(templateRoot, "fleet"), { recursive: true });
    await mkdir(path.join(templateRoot, "fleet", "workspaces", "common"), { recursive: true });
    await mkdir(path.join(repoRoot, "fleet"), { recursive: true });
    await mkdir(path.join(repoRoot, ".clawlets", "extra-files", "openclaw-fleet-host", "var", "lib", "sops-nix"), { recursive: true });

    const bundledSkillsText = ["[", '  "github",', '  "brave-search",', '  "coding-agent"', "]", ""].join("\n");
    await writeFile(path.join(repoRoot, "fleet", "bundled-skills.json"), bundledSkillsText, "utf8");
    await writeFile(path.join(templateRoot, "fleet", "bundled-skills.json"), bundledSkillsText, "utf8");

    const workspaceDocs = {
      "AGENTS.md": "# agents\n",
      "SOUL.md": "# soul\n",
      "IDENTITY.md": "# identity\n",
      "TOOLS.md": "# tools\n",
      "USER.md": "# user\n",
      "HEARTBEAT.md": "# heartbeat\n",
    };
    for (const [name, text] of Object.entries(workspaceDocs)) {
      await writeFile(path.join(repoRoot, "fleet", "workspaces", "common", name), text, "utf8");
      await writeFile(path.join(templateRoot, "fleet", "workspaces", "common", name), text, "utf8");
    }

    const repoDocsRoot = path.join(repoRoot, "apps", "docs", "content", "docs");
    await mkdir(repoDocsRoot, { recursive: true });
    await writeFile(path.join(repoDocsRoot, "index.mdx"), "# index\n", "utf8");
    await writeFile(path.join(repoDocsRoot, "meta.json"), JSON.stringify({ pages: ["index"] }, null, 2), "utf8");

    const templateDocsRoot = path.join(templateRoot, "apps", "docs", "content", "docs");
    await mkdir(templateDocsRoot, { recursive: true });
    await writeFile(path.join(templateDocsRoot, "index.mdx"), "# index\n", "utf8");
    await writeFile(path.join(templateDocsRoot, "meta.json"), JSON.stringify({ pages: ["index"] }, null, 2), "utf8");

    const sshPub = path.join(repoRoot, "id_ed25519.pub");
    await writeFile(sshPub, "ssh-ed25519 AAAATEST test\n", "utf8");

    const operatorKey = path.join(repoRoot, ".clawlets", "keys", "operators", "tester.agekey");
    await mkdir(path.dirname(operatorKey), { recursive: true });
    await writeFile(operatorKey, "AGE-SECRET-KEY-TEST\n", "utf8");

    const clawletsConfig = {
      schemaVersion: 2,
      defaultHost: "openclaw-fleet-host",
      baseFlake: "",
      fleet: {
        secretEnv: { ZAI_API_KEY: "z_ai_api_key" },
        secretFiles: {},
        sshAuthorizedKeys: ["ssh-ed25519 AAAATEST test"],
        sshKnownHosts: [],
        codex: { enable: false, gateways: [] },
        backups: { restic: { enable: false, repository: "" } },
      },
      hosts: {
        "openclaw-fleet-host": {
          enable: false,
          gatewaysOrder: ["alpha", "beta"],
          gateways: {
            alpha: {
              profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_alpha" }, secretFiles: {} },
              channels: { discord: { enabled: true, allowFrom: ["discord user:123"] } },
              openclaw: {},
            },
            beta: {
              profile: { secretEnv: { DISCORD_BOT_TOKEN: "discord_token_beta" }, secretFiles: {} },
              channels: { discord: { enabled: true, allowFrom: ["discord user:456"] } },
              openclaw: {},
            },
          },
          diskDevice: "/dev/disk/by-id/TEST",
          flakeHost: "",
          hetzner: { serverType: "cx43" },
          provisioning: { adminCidr: "203.0.113.10/32", adminCidrAllowWorldOpen: false, sshPubkeyFile: "id_ed25519.pub" },
          sshExposure: { mode: "tailnet" },
          tailnet: { mode: "none" },
          agentModelPrimary: "zai/glm-4.7",
        },
      },
    };

    await writeFile(path.join(repoRoot, "fleet", "clawlets.json"), JSON.stringify(clawletsConfig, null, 2) + "\n", "utf8");
    await writeFile(path.join(templateRoot, "fleet", "clawlets.json"), JSON.stringify(clawletsConfig, null, 2) + "\n", "utf8");

    mockFleetMain = {
      gateways: ["alpha", "beta"],
      gatewayProfiles: {
        alpha: { skills: { allowBundled: [], entries: {} }, github: {} },
        beta: { skills: { allowBundled: [], entries: {} }, github: {} },
      },
    };
    mockFleetTemplate = structuredClone(mockFleetMain);

    mockWheelMain = { adminHasWheel: false, breakglassHasWheel: true };
    mockWheelTemplate = structuredClone(mockWheelMain);

    await mkdir(path.join(repoRoot, "secrets", "hosts", "openclaw-fleet-host"), { recursive: true });
    await mkdir(path.join(repoRoot, "secrets", "keys", "hosts"), { recursive: true });

    await writeFile(
      path.join(repoRoot, "secrets", ".sops.yaml"),
      [
        "creation_rules:",
        `  - path_regex: ${sopsPathRegexForDirFiles("hosts/openclaw-fleet-host", "yaml")}`,
        "    key_groups:",
        "      - age:",
        "          - age1a",
        "          - age1b",
        `  - path_regex: ${sopsPathRegexForPathSuffix("keys/hosts/openclaw-fleet-host.agekey.yaml")}`,
        "    key_groups:",
        "      - age:",
        "          - age1a",
        "          - age1b",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(repoRoot, "secrets", "keys", "hosts", "openclaw-fleet-host.agekey.yaml"),
      "age_public_key: age1a\nage_secret_key: AGE-SECRET-KEY-TEST\nsops: {}\n",
      "utf8",
    );

    const secretsDir = path.join(repoRoot, "secrets", "hosts", "openclaw-fleet-host");
    const enc = "ENC[AES256_GCM,data:abc,iv:def,tag:ghi,type:str]";
    await writeFile(path.join(secretsDir, "admin_password_hash.yaml"), `admin_password_hash: ${enc}\nsops: {}\n`, "utf8");
    await writeFile(path.join(secretsDir, "discord_token_alpha.yaml"), `discord_token_alpha: ${enc}\nsops: {}\n`, "utf8");
    await writeFile(path.join(secretsDir, "discord_token_beta.yaml"), `discord_token_beta: ${enc}\nsops: {}\n`, "utf8");
    await writeFile(path.join(secretsDir, "z_ai_api_key.yaml"), `z_ai_api_key: ${enc}\nsops: {}\n`, "utf8");

    await writeFile(
      path.join(repoRoot, ".clawlets", "extra-files", "openclaw-fleet-host", "var", "lib", "sops-nix", "key.txt"),
      "AGE-SECRET-KEY-TEST\n",
      "utf8",
    );
  });

  afterAll(async () => {
    try {
      await rm(repoRoot, { recursive: true, force: true });
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv, CLAWLETS_TEMPLATE_DIR: templateRoot };
    mockFleetMain = {
      gateways: ["alpha", "beta"],
      gatewayProfiles: {
        alpha: { skills: { allowBundled: [], entries: {} }, github: {} },
        beta: { skills: { allowBundled: [], entries: {} }, github: {} },
      },
    };
    mockFleetTemplate = structuredClone(mockFleetMain);
    mockWheelMain = { adminHasWheel: false, breakglassHasWheel: true };
    mockWheelTemplate = structuredClone(mockWheelMain);
    vi.clearAllMocks();
  });

  it("passes with a fully seeded repo", async () => {
    process.env.HCLOUD_TOKEN = "abc";
    delete process.env.SOPS_AGE_KEY_FILE;
    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const assetsCheck = checks.find((c) => c.label === "opentofu assets (hetzner)");
    expect(assetsCheck?.status).toBe("ok");
    expect(checks.filter((c) => c.status === "missing")).toEqual([]);
  }, 15_000);

  it("flags missing bundled OpenTofu assets for bootstrap provider", async () => {
    process.env.HCLOUD_TOKEN = "abc";
    const existsSync = fs.existsSync;
    const spy = vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const candidate = String(p);
      if (candidate.includes(`${path.sep}assets${path.sep}opentofu${path.sep}providers${path.sep}hetzner`)) return false;
      return existsSync(p);
    });
    try {
      const { collectDoctorChecks } = await import("../src/doctor.js");
      const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "bootstrap" });
      const assetsCheck = checks.find((c) => c.label === "opentofu assets (hetzner)");
      expect(assetsCheck?.status).toBe("missing");
      expect(String(assetsCheck?.detail || "")).toContain("missing bundled hetzner OpenTofu assets");
    } finally {
      spy.mockRestore();
    }
  });

  it("uses openclaw config for services.openclawFleet.enable (not infra host.enable)", async () => {
    const openclawPath = path.join(repoRoot, "fleet", "openclaw.json");
    await writeFile(
      openclawPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          hosts: {
            "openclaw-fleet-host": {
              enable: true,
              agentModelPrimary: "zai/glm-4.7",
              gatewaysOrder: ["alpha"],
              gateways: { alpha: {} },
            },
          },
          fleet: {
            secretEnv: {},
            secretFiles: {},
            gatewayArchitecture: "multi",
            codex: { enable: false, gateways: [] },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    try {
      const { collectDoctorChecks } = await import("../src/doctor.js");
      const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "updates" });

      const openclawEnable = checks.find((c) => c.label === "services.openclawFleet.enable");
      expect(openclawEnable?.status).toBe("ok");

      const infraEnable = checks.find((c) => c.label === "host.enable");
      expect(infraEnable?.status).toBe("warn");
    } finally {
      await rm(openclawPath, { force: true });
    }
  });

  it("does not fail repo checks when gateways are empty and openclaw is disabled", async () => {
    process.env.HCLOUD_TOKEN = "abc";
    mockFleetMain = { gateways: [], gatewayProfiles: {} };
    mockFleetTemplate = structuredClone(mockFleetMain);
    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    expect(checks.filter((c) => c.status === "missing")).toEqual([]);
  });

  it("warns when clawlets config fails to load", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawlets.json");
    const original = await readFile(configPath, "utf8");
    await writeFile(configPath, "{", "utf8");

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "updates" });
    const check = checks.find((c) => c.label === "clawlets config");
    expect(check?.status).toBe("warn");

    await writeFile(configPath, original, "utf8");
  });

  it("attributes openclaw.json parse failures to openclaw config (not clawlets config)", async () => {
    const openclawPath = path.join(repoRoot, "fleet", "openclaw.json");
    await writeFile(openclawPath, "{", "utf8");
    try {
      const { collectDoctorChecks } = await import("../src/doctor.js");
      const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
      const infraCheck = checks.find((c) => c.label === "clawlets config");
      expect(infraCheck?.status).toBe("ok");
      const openclawCheck = checks.find((c) => c.label === "openclaw config");
      expect(openclawCheck?.status).toBe("warn");
    } finally {
      await rm(openclawPath, { force: true });
    }
  });

  it("reports schema vs nix/upstream matches", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/openclaw/schema/artifact.js", () => ({
      getPinnedOpenclawSchemaArtifact: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        openclawRev: "rev1234567890abcd",
      }),
    }));
    vi.doMock("../src/lib/nix/nix-openclaw-source.js", () => ({
      getNixOpenclawRevFromFlakeLock: () => "pinrev",
      fetchNixOpenclawSourceInfo: async () => ({
        ok: true as const,
        info: { rev: "rev1234567890abcd" },
        sourceUrl: "https://example.com",
      }),
    }));

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    const pinned = checks.find((c) => c.label === "openclaw schema vs nix-openclaw");
    const upstream = checks.find((c) => c.label === "openclaw schema vs upstream");
    expect(pinned?.status).toBe("ok");
    expect(upstream?.status).toBe("ok");
  });

  it("warns on schema mismatch and upstream fetch failure", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/openclaw/schema/artifact.js", () => ({
      getPinnedOpenclawSchemaArtifact: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        openclawRev: "rev1234567890abcd",
      }),
    }));
    vi.doMock("../src/lib/nix/nix-openclaw-source.js", () => ({
      getNixOpenclawRevFromFlakeLock: () => "pinrev",
      fetchNixOpenclawSourceInfo: async ({ ref }: { ref: string }) => {
        if (ref === "pinrev") {
          return { ok: true as const, info: { rev: "rev9999999999" }, sourceUrl: "https://example.com" };
        }
        return { ok: false as const, error: "rate limited", sourceUrl: "https://example.com" };
      },
    }));

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    const pinned = checks.find((c) => c.label === "openclaw schema vs nix-openclaw");
    const upstream = checks.find((c) => c.label === "openclaw schema vs upstream");
    expect(pinned?.status).toBe("warn");
    expect(upstream?.status).toBe("warn");
    expect(upstream?.detail || "").toContain("unable to fetch");
  });

  it("warns when pinned nix-openclaw fetch fails", async () => {
    vi.resetModules();
    vi.doMock("../src/lib/openclaw/schema/artifact.js", () => ({
      getPinnedOpenclawSchemaArtifact: () => ({
        schema: {},
        uiHints: {},
        version: "1.0.0",
        generatedAt: "now",
        openclawRev: "rev1234567890abcd",
      }),
    }));
    vi.doMock("../src/lib/nix/nix-openclaw-source.js", () => ({
      getNixOpenclawRevFromFlakeLock: () => "pinrev",
      fetchNixOpenclawSourceInfo: async ({ ref }: { ref: string }) => {
        if (ref === "pinrev") {
          return { ok: false as const, error: "nope", sourceUrl: "https://example.com" };
        }
        return { ok: true as const, info: { rev: "rev1234567890abcd" }, sourceUrl: "https://example.com" };
      },
    }));

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    const pinned = checks.find((c) => c.label === "openclaw schema vs nix-openclaw");
    const upstream = checks.find((c) => c.label === "openclaw schema vs upstream");
    expect(pinned?.status).toBe("warn");
    expect(pinned?.detail || "").toContain("nope");
    expect(upstream?.status).toBe("ok");
  });

  it("rejects skills.allowBundled = null in fleet configs", async () => {
    mockFleetMain.gatewayProfiles.alpha.skills.allowBundled = null;
    mockFleetTemplate.gatewayProfiles.alpha.skills.allowBundled = null;

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    expect(checks.some((c) => c.label === "fleet policy (openclaw-fleet-host)" && c.status === "missing")).toBe(true);
    expect(checks.some((c) => c.label === "template fleet policy (openclaw-fleet-host)" && c.status === "missing")).toBe(true);
  });

  it("rejects unknown bundled skills", async () => {
    mockFleetMain.gatewayProfiles.alpha.skills.allowBundled = ["unknown-skill"];

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    expect(checks.some((c) => c.label === "fleet policy (openclaw-fleet-host)" && c.status === "missing")).toBe(true);
  });

  it("requires GitHub app auth config when bundled github enabled", async () => {
    mockFleetMain.gatewayProfiles.alpha.skills.allowBundled = ["github"];
    mockFleetMain.gatewayProfiles.alpha.github = {};

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    expect(checks.some((c) => c.label === "fleet policy (openclaw-fleet-host)" && c.status === "missing")).toBe(true);
  });

  it("requires breakglass in wheel and forbids admin in wheel", async () => {
    mockWheelMain = { adminHasWheel: true, breakglassHasWheel: false };

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    expect(checks.some((c) => c.label === "admin wheel access" && c.status === "missing")).toBe(true);
    expect(checks.some((c) => c.label === "breakglass wheel access" && c.status === "missing")).toBe(true);
  });

  it("flags provisioning ssh pubkey file contents as invalid", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["openclaw-fleet-host"].provisioning.sshPubkeyFile = makeEd25519PublicKey({ seedByte: 1, comment: "test" });
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    expect(
      checks.some(
        (c) =>
          c.label === "provisioning ssh pubkey file" &&
          c.status === "missing" &&
          String(c.detail || "").includes("must be a path"),
      ),
    ).toBe(true);

    await writeFile(configPath, original, "utf8");
  });

  it("flags secrets in openclaw.json5 and includes", async () => {
    const botDir = path.join(repoRoot, "fleet", "workspaces", "gateways", "maren");
    const includeDir = path.join(botDir, "includes");
    await mkdir(includeDir, { recursive: true });
    await writeFile(path.join(includeDir, "extra.json5"), '{ "token": "SUPER_SECRET_1234567890" }\n', "utf8");
    await writeFile(path.join(botDir, "openclaw.json5"), '{ "$include": "./includes/extra.json5" }\n', "utf8");

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    const check = checks.find((c) => c.label === "openclaw config secrets");
    expect(check?.status).toBe("missing");

    await rm(botDir, { recursive: true, force: true });
  });

  it("flags secrets in fleet/clawlets.json", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["openclaw-fleet-host"].gateways.alpha = raw.hosts["openclaw-fleet-host"].gateways.alpha || {};
    raw.hosts["openclaw-fleet-host"].gateways.alpha.openclaw = {
      channels: { discord: { enabled: true, token: "SUPER_SECRET_1234567890" } },
    };
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", scope: "repo" });
    const check = checks.find((c) => c.label === "fleet config secrets");
    expect(check?.status).toBe("missing");

    await writeFile(configPath, original, "utf8");
  });

  it("fails when diskDevice is left as CHANGE_ME placeholder", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["openclaw-fleet-host"].diskDevice = "/dev/sda-CHANGE_ME";
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    process.env.HCLOUD_TOKEN = "abc";
    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    expect(checks.some((c) => c.label === "diskDevice" && c.status === "missing")).toBe(true);

    await writeFile(configPath, original, "utf8");
  });

  it("requires garnix_netrc when private Garnix cache enabled", async () => {
    const configPath = path.join(repoRoot, "fleet", "clawlets.json");
    const original = await readFile(configPath, "utf8");

    const raw = JSON.parse(original) as any;
    raw.hosts["openclaw-fleet-host"].cache = {
      netrc: { enable: true, secretName: "garnix_netrc" },
    };
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    process.env.HCLOUD_TOKEN = "abc";
    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    expect(checks.some((c) => c.label === "secret: garnix_netrc" && c.status === "missing")).toBe(true);

    await writeFile(configPath, original, "utf8");
  });

  it("requires GITHUB_TOKEN when repo is private", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/private-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "private-or-missing" });

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("missing");
  });

  it("accepts GITHUB_TOKEN when repo is public", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/public-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "public" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("ok");
  });

  it("warns when GitHub API is rate-limited", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "rate-limited" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when token set but GitHub check fails", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: false, status: "network", detail: "boom" });
    process.env.GITHUB_TOKEN = "token";

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when API is rate-limited without token", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "rate-limited" });

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("warns when API check fails without token", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/any-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: false, status: "network", detail: "boom" });

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host" });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("warn");
  });

  it("skips GitHub token checks when requested", async () => {
    const git = await import("../src/lib/vcs/git");
    const github = await import("../src/lib/vcs/github");
    vi.mocked(git.tryGetOriginFlake).mockResolvedValue("github:acme/private-repo");
    vi.mocked(github.checkGithubRepoVisibility).mockResolvedValue({ ok: true, status: "private-or-missing" });

    const { collectDoctorChecks } = await import("../src/doctor.js");
    const checks = await collectDoctorChecks({ cwd: repoRoot, host: "openclaw-fleet-host", skipGithubTokenCheck: true });
    const check = checks.find((c) => c.label === "GITHUB_TOKEN");
    expect(check?.status).toBe("ok");
    expect(String(check?.detail || "")).toContain("skipped");
    expect(vi.mocked(github.checkGithubRepoVisibility)).not.toHaveBeenCalled();
  });
});
