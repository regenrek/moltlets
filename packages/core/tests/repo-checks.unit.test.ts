import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addRepoChecks } from "../src/doctor/repo-checks.js";
import { getRepoLayout } from "../src/repo-layout.js";
import type { ConfigStore } from "../src/lib/storage/config-store.js";
import type { DoctorCheck } from "../src/doctor/types.js";

const captureMock = vi.fn();
const checkSchemaVsNixOpenclawMock = vi.fn();
const findInlineScriptingViolationsMock = vi.fn();
const validateDocsIndexIntegrityMock = vi.fn();
const validateFleetPolicyMock = vi.fn();
const evalFleetConfigMock = vi.fn();
const loadInfraConfigAsyncMock = vi.fn();
const infraSchemaParseMock = vi.fn();
const openclawSchemaParseMock = vi.fn();
const mergeSplitConfigsMock = vi.fn();
const buildOpenClawGatewayConfigMock = vi.fn();
const lintOpenclawSecurityConfigMock = vi.fn();
const findOpenclawSecretViolationsMock = vi.fn();
const findFleetSecretViolationsMock = vi.fn();
const evalWheelAccessMock = vi.fn();
const getClawletsRevFromFlakeLockMock = vi.fn();
const dirHasAnyFileMock = vi.fn();
const loadKnownBundledSkillsMock = vi.fn();
const resolveTemplateRootMock = vi.fn();

vi.mock("../src/lib/runtime/run.js", () => ({
  capture: (...args: any[]) => captureMock(...args),
}));

vi.mock("../src/doctor/schema-checks.js", () => ({
  checkSchemaVsNixOpenclaw: (...args: any[]) => checkSchemaVsNixOpenclawMock(...args),
}));

vi.mock("../src/lib/security/inline-script-ban.js", () => ({
  findInlineScriptingViolations: (...args: any[]) => findInlineScriptingViolationsMock(...args),
}));

vi.mock("../src/lib/project/docs-index.js", () => ({
  validateDocsIndexIntegrity: (...args: any[]) => validateDocsIndexIntegrityMock(...args),
}));

vi.mock("../src/lib/config/fleet-policy.js", () => ({
  validateFleetPolicy: (...args: any[]) => validateFleetPolicyMock(...args),
}));

vi.mock("../src/lib/nix/fleet-nix-eval.js", () => ({
  evalFleetConfig: (...args: any[]) => evalFleetConfigMock(...args),
}));

vi.mock("../src/lib/config/clawlets-config.js", () => ({
  loadInfraConfigAsync: (...args: any[]) => loadInfraConfigAsyncMock(...args),
  InfraConfigSchema: {
    parse: (...args: any[]) => infraSchemaParseMock(...args),
  },
  OpenClawConfigSchema: {
    parse: (...args: any[]) => openclawSchemaParseMock(...args),
  },
}));

vi.mock("../src/lib/config/split.js", () => ({
  mergeSplitConfigs: (...args: any[]) => mergeSplitConfigsMock(...args),
}));

vi.mock("../src/lib/openclaw/config-invariants.js", () => ({
  buildOpenClawGatewayConfig: (...args: any[]) => buildOpenClawGatewayConfigMock(...args),
}));

vi.mock("../src/lib/openclaw/security-lint.js", () => ({
  lintOpenclawSecurityConfig: (...args: any[]) => lintOpenclawSecurityConfigMock(...args),
}));

vi.mock("../src/doctor/repo-checks-secrets.js", () => ({
  findOpenclawSecretViolations: (...args: any[]) => findOpenclawSecretViolationsMock(...args),
  findFleetSecretViolations: (...args: any[]) => findFleetSecretViolationsMock(...args),
}));

vi.mock("../src/doctor/repo-checks-nix.js", () => ({
  evalWheelAccess: (...args: any[]) => evalWheelAccessMock(...args),
  getClawletsRevFromFlakeLock: (...args: any[]) => getClawletsRevFromFlakeLockMock(...args),
}));

vi.mock("../src/doctor/util.js", () => ({
  dirHasAnyFile: (...args: any[]) => dirHasAnyFileMock(...args),
  loadKnownBundledSkills: (...args: any[]) => loadKnownBundledSkillsMock(...args),
  resolveTemplateRoot: (...args: any[]) => resolveTemplateRootMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  captureMock.mockResolvedValue("");
  checkSchemaVsNixOpenclawMock.mockResolvedValue([]);
  findInlineScriptingViolationsMock.mockReturnValue([]);
  validateDocsIndexIntegrityMock.mockReturnValue({ ok: true, errors: [] });
  validateFleetPolicyMock.mockReturnValue({ ok: true, violations: [] });
  evalFleetConfigMock.mockResolvedValue({
    gateways: ["gw1"],
    gatewayProfiles: {},
  });
  loadInfraConfigAsyncMock.mockResolvedValue({
    config: {
      defaultHost: "alpha",
      fleet: { secretEnv: {} },
      hosts: {
        alpha: {
          openclaw: { enable: true },
          gatewaysOrder: ["gw1"],
          gateways: { gw1: {} },
        },
      },
    },
  });
  infraSchemaParseMock.mockImplementation((value: unknown) => value);
  openclawSchemaParseMock.mockImplementation((value: unknown) => value);
  mergeSplitConfigsMock.mockImplementation(({ infra, openclaw }: { infra: any; openclaw: any }) => ({
    ...infra,
    hosts: infra.hosts,
    openclaw,
  }));
  buildOpenClawGatewayConfigMock.mockReturnValue({ merged: {} });
  lintOpenclawSecurityConfigMock.mockReturnValue({
    summary: { critical: 0, warn: 0, info: 0 },
    findings: [],
  });
  findOpenclawSecretViolationsMock.mockReturnValue({ files: [], violations: [] });
  findFleetSecretViolationsMock.mockReturnValue({ files: [], violations: [] });
  evalWheelAccessMock.mockResolvedValue({ adminHasWheel: false, breakglassHasWheel: true });
  getClawletsRevFromFlakeLockMock.mockReturnValue(null);
  dirHasAnyFileMock.mockResolvedValue(false);
  loadKnownBundledSkillsMock.mockResolvedValue({ ok: true, skills: ["github"], errors: [] });
  resolveTemplateRootMock.mockResolvedValue(null);
});

function makeStore(params: {
  existing: Set<string>;
  files?: Record<string, string>;
}): ConfigStore {
  const files = params.files || {};
  return {
    exists: async (p) => params.existing.has(p),
    readText: async (p) => {
      if (Object.prototype.hasOwnProperty.call(files, p)) return files[p] || "";
      throw new Error(`missing: ${p}`);
    },
    writeTextAtomic: async () => {},
    stat: async () => null,
    readDir: async () => [],
  };
}

function byLabel(checks: DoctorCheck[], label: string): DoctorCheck | undefined {
  return checks.find((row) => row.label === label);
}

describe("repo checks", () => {
  it("covers failure branches for bundled skills, docs, git hygiene, and missing config", async () => {
    const repoRoot = "/repo";
    const layout = getRepoLayout(repoRoot);
    const store = makeStore({
      existing: new Set<string>([
        path.join(repoRoot, "flake.nix"),
        path.join(repoRoot, "flake.lock"),
      ]),
    });

    captureMock.mockRejectedValueOnce(new Error("git unavailable"));
    checkSchemaVsNixOpenclawMock.mockResolvedValueOnce([
      {
        scope: "repo",
        status: "warn",
        label: "schema drift",
        detail: "mock",
      },
    ]);
    findInlineScriptingViolationsMock.mockReturnValueOnce([
      {
        filePath: path.join(repoRoot, "scripts", "postinstall.sh"),
        line: 3,
        rule: "inline-shell",
      },
    ]);
    validateDocsIndexIntegrityMock.mockReturnValueOnce({
      ok: false,
      errors: ["missing docs index"],
    });
    loadKnownBundledSkillsMock.mockResolvedValueOnce({
      ok: false,
      skills: [],
      errors: ["bundled-skills invalid json"],
    });
    evalWheelAccessMock.mockResolvedValueOnce(null);

    const checks: DoctorCheck[] = [];
    const result = await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "clawlets flake input")?.status).toBe("warn");
    expect(byLabel(checks, "bundled skills index")?.status).toBe("missing");
    expect(byLabel(checks, "public repo hygiene")?.status).toBe("warn");
    expect(byLabel(checks, "inline scripting ban")?.status).toBe("missing");
    expect(byLabel(checks, "docs index integrity")?.status).toBe("missing");
    expect(byLabel(checks, "fleet workspaces")?.status).toBe("missing");
    expect(byLabel(checks, "clawlets config")?.status).toBe("missing");
    expect(byLabel(checks, "wheel access")?.status).toBe("warn");
    expect(result.fleet).toBeNull();
    expect(result.fleetGateways).toBeNull();
  });

  it("covers positive config load with tracked-path hygiene failures and wheel policy violations", async () => {
    const repoRoot = "/repo2";
    const templateRoot = "/template2";
    const layout = getRepoLayout(repoRoot);

    const infraConfig = {
      schemaVersion: 2,
      defaultHost: "alpha",
      fleet: { secretEnv: {} },
      hosts: {
        alpha: {
          openclaw: { enable: true },
          gatewaysOrder: ["gw1"],
          gateways: {
            gw1: {},
          },
        },
      },
    };

    const openclawConfig = {
      schemaVersion: 1,
      fleet: { secretEnv: {} },
      hosts: {
        alpha: {
          enable: true,
          gatewaysOrder: ["gw1"],
          gateways: { gw1: {} },
        },
      },
    };

    const templateInfraPath = path.join(templateRoot, "fleet", "clawlets.json");
    const templateOpenclawPath = path.join(templateRoot, "fleet", "openclaw.json");
    const existing = new Set<string>([
      path.join(repoRoot, "flake.nix"),
      path.join(repoRoot, "flake.lock"),
      layout.opentofuDir,
      layout.clawletsConfigPath,
      layout.openclawConfigPath,
      path.join(repoRoot, "fleet", "workspaces", "common", "AGENTS.md"),
      path.join(repoRoot, "fleet", "workspaces", "common", "SOUL.md"),
      path.join(repoRoot, "fleet", "workspaces", "common", "IDENTITY.md"),
      path.join(repoRoot, "fleet", "workspaces", "common", "TOOLS.md"),
      path.join(repoRoot, "fleet", "workspaces", "common", "USER.md"),
      path.join(repoRoot, "fleet", "workspaces", "common", "HEARTBEAT.md"),
      templateInfraPath,
      templateOpenclawPath,
      path.join(templateRoot, "fleet", "workspaces", "common", "AGENTS.md"),
      path.join(templateRoot, "fleet", "workspaces", "common", "SOUL.md"),
      path.join(templateRoot, "fleet", "workspaces", "common", "IDENTITY.md"),
      path.join(templateRoot, "fleet", "workspaces", "common", "TOOLS.md"),
      path.join(templateRoot, "fleet", "workspaces", "common", "USER.md"),
      path.join(templateRoot, "fleet", "workspaces", "common", "HEARTBEAT.md"),
    ]);

    const store = makeStore({
      existing,
      files: {
        [layout.clawletsConfigPath]: JSON.stringify(infraConfig),
        [layout.openclawConfigPath]: JSON.stringify(openclawConfig),
        [templateInfraPath]: JSON.stringify(infraConfig),
        [templateOpenclawPath]: JSON.stringify(openclawConfig),
      },
    });

    getClawletsRevFromFlakeLockMock.mockReturnValue("abcdef1234567890");
    captureMock.mockResolvedValue(".clawlets/token\n");
    resolveTemplateRootMock.mockResolvedValue(templateRoot);
    loadKnownBundledSkillsMock.mockResolvedValue({
      ok: true,
      skills: ["github"],
      errors: [],
    });
    findOpenclawSecretViolationsMock.mockImplementation((root: string) => {
      if (root === repoRoot) {
        return {
          files: [path.join(root, "fleet", "workspaces", "gateways", "gw1", "openclaw.json5")],
          violations: [{ file: path.join(root, "fleet", "workspaces", "gateways", "gw1", "openclaw.json5"), label: "token" }],
        };
      }
      return { files: [], violations: [] };
    });
    lintOpenclawSecurityConfigMock.mockReturnValue({
      summary: { critical: 0, warn: 1, info: 0 },
      findings: [{ severity: "warn", id: "weak-default" }],
    });
    evalWheelAccessMock.mockResolvedValue({
      adminHasWheel: true,
      breakglassHasWheel: false,
    });

    const checks: DoctorCheck[] = [];
    const result = await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "clawlets flake input")?.status).toBe("ok");
    expect(byLabel(checks, "public repo hygiene")?.status).toBe("missing");
    expect(byLabel(checks, "openclaw config secrets")?.status).toBe("missing");
    expect(byLabel(checks, "template openclaw config secrets")?.status).toBe("ok");
    expect(byLabel(checks, "openclaw security (alpha/gw1)")?.status).toBe("warn");
    expect(byLabel(checks, "admin wheel access")?.status).toBe("missing");
    expect(byLabel(checks, "breakglass wheel access")?.status).toBe("missing");
    expect(byLabel(checks, "fleet policy (alpha)")?.status).toBe("ok");
    expect(byLabel(checks, "template fleet policy (alpha)")?.status).toBe("ok");
    expect(result.fleetGateways).toEqual(["gw1"]);
  });

  it("covers openclaw-config parse warnings and fleet-eval failure path", async () => {
    const repoRoot = "/repo3";
    const layout = getRepoLayout(repoRoot);

    const infraConfig = {
      schemaVersion: 2,
      defaultHost: "alpha",
      fleet: { secretEnv: {} },
      hosts: {
        alpha: {
          openclaw: { enable: true },
          gatewaysOrder: ["gw1"],
          gateways: {
            gw1: {},
          },
        },
      },
    };

    const store = makeStore({
      existing: new Set<string>([
        path.join(repoRoot, "flake.nix"),
        path.join(repoRoot, "flake.lock"),
        layout.opentofuDir,
        layout.clawletsConfigPath,
        layout.openclawConfigPath,
      ]),
      files: {
        [layout.clawletsConfigPath]: JSON.stringify(infraConfig),
        [layout.openclawConfigPath]: JSON.stringify({ hosts: {} }),
      },
    });

    loadInfraConfigAsyncMock.mockResolvedValueOnce({ config: infraConfig });
    openclawSchemaParseMock.mockImplementationOnce(() => {
      throw new Error("invalid openclaw schema");
    });
    evalFleetConfigMock.mockRejectedValueOnce(new Error("nix eval failed"));

    const checks: DoctorCheck[] = [];
    const result = await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "openclaw config")?.status).toBe("warn");
    expect(String(byLabel(checks, "openclaw config")?.detail || "")).toContain("invalid openclaw schema");
    expect(byLabel(checks, "fleet config eval")?.status).toBe("missing");
    expect(result.fleet).toBeNull();
    expect(result.fleetGateways).toEqual(["gw1"]);
  });

  it("covers legacy template-monolith handling and openclaw-disabled policy branches", async () => {
    const repoRoot = "/repo4";
    const templateRoot = "/template4";
    const layout = getRepoLayout(repoRoot);

    const infraConfig = {
      schemaVersion: 2,
      defaultHost: "alpha",
      fleet: { secretEnv: {} },
      hosts: {
        alpha: {
          openclaw: { enable: false },
          gatewaysOrder: [],
          gateways: {},
        },
      },
    };

    const templateInfraPath = path.join(templateRoot, "fleet", "clawlets.json");
    const existing = new Set<string>([
      path.join(repoRoot, "flake.nix"),
      path.join(repoRoot, "flake.lock"),
      layout.opentofuDir,
      layout.clawletsConfigPath,
      templateInfraPath,
    ]);
    const store = makeStore({
      existing,
      files: {
        [layout.clawletsConfigPath]: JSON.stringify(infraConfig),
        [templateInfraPath]: JSON.stringify({
          hosts: {
            beta: {},
          },
        }),
      },
    });

    loadInfraConfigAsyncMock.mockResolvedValueOnce({ config: infraConfig });
    resolveTemplateRootMock.mockResolvedValueOnce(templateRoot);
    infraSchemaParseMock.mockImplementationOnce(() => {
      throw new Error("legacy shape");
    });
    evalFleetConfigMock.mockImplementation(async () => ({
      gateways: [],
      gatewayProfiles: {},
    }));
    evalWheelAccessMock.mockResolvedValueOnce({
      adminHasWheel: false,
      breakglassHasWheel: true,
    });

    const checks: DoctorCheck[] = [];
    await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "template clawlets config")?.status).toBe("warn");
    expect(String(byLabel(checks, "template clawlets config")?.detail || "")).toContain("legacy monolith shape");
    expect(byLabel(checks, "fleet config eval (alpha)")?.status).toBe("ok");
    expect(String(byLabel(checks, "host gateways list (alpha)")?.detail || "")).toContain("openclaw disabled");
    expect(byLabel(checks, "fleet policy (alpha)")?.status).toBe("ok");
    expect(byLabel(checks, "template fleet config eval (beta)")?.status).toBe("ok");
    expect(byLabel(checks, "template fleet policy (beta)")?.status).toBe("ok");
    expect(byLabel(checks, "admin wheel access")?.status).toBe("ok");
    expect(byLabel(checks, "breakglass wheel access")?.status).toBe("ok");
  });

  it("flags legacy infra/secrets directory before git tracked-path scan", async () => {
    const repoRoot = "/repo5";
    const layout = getRepoLayout(repoRoot);
    const store = makeStore({
      existing: new Set<string>([
        path.join(repoRoot, "flake.nix"),
        layout.clawletsConfigPath,
      ]),
      files: {
        [layout.clawletsConfigPath]: JSON.stringify({
          schemaVersion: 2,
          defaultHost: "alpha",
          fleet: { secretEnv: {} },
          hosts: {
            alpha: {
              openclaw: { enable: false },
              gatewaysOrder: [],
              gateways: {},
            },
          },
        }),
      },
    });
    dirHasAnyFileMock.mockResolvedValueOnce(true);

    const checks: DoctorCheck[] = [];
    await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "public repo hygiene")?.status).toBe("missing");
    expect(String(byLabel(checks, "public repo hygiene")?.detail || "")).toContain("infra/secrets must not exist");
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("covers config-collision, merge-failure, and openclaw-security warning branches", async () => {
    const repoRoot = "/repo6";
    const layout = getRepoLayout(repoRoot);

    const infraConfig = {
      schemaVersion: 2,
      defaultHost: "alpha",
      fleet: { secretEnv: { DISCORD_TOKEN: "shared.discord_token" } },
      hosts: {
        alpha: {
          openclaw: { enable: true },
          gatewaysOrder: ["gw1"],
          gateways: {
            gw1: {},
          },
        },
      },
    };
    const openclawConfig = {
      schemaVersion: 1,
      fleet: { secretEnv: { DISCORD_TOKEN: "gateway.discord_token" } },
      hosts: {
        alpha: {
          enable: true,
          gatewaysOrder: ["gw1"],
          gateways: {
            gw1: {},
          },
        },
        beta: {
          enable: true,
          gatewaysOrder: [],
          gateways: {},
        },
      },
    };

    const store = makeStore({
      existing: new Set<string>([
        path.join(repoRoot, "flake.nix"),
        path.join(repoRoot, "flake.lock"),
        layout.opentofuDir,
        layout.clawletsConfigPath,
        layout.openclawConfigPath,
      ]),
      files: {
        [layout.clawletsConfigPath]: JSON.stringify(infraConfig),
        [layout.openclawConfigPath]: JSON.stringify(openclawConfig),
      },
    });

    loadInfraConfigAsyncMock.mockResolvedValueOnce({ config: infraConfig });
    let mergeCalls = 0;
    mergeSplitConfigsMock.mockImplementation(({ infra, openclaw }: { infra: any; openclaw: any }) => {
      mergeCalls += 1;
      if (mergeCalls === 2) throw new Error("merge failed");
      return { ...infra, hosts: infra.hosts, openclaw };
    });
    buildOpenClawGatewayConfigMock.mockImplementationOnce(() => {
      throw new Error("gateway build failed");
    });
    evalFleetConfigMock.mockResolvedValueOnce({ gateways: ["gw1"], gatewayProfiles: {} });
    validateFleetPolicyMock.mockReturnValueOnce({
      ok: false,
      violations: [
        {
          filePath: layout.clawletsConfigPath,
          message: "missing policy mapping",
          detail: "DISCORD_TOKEN",
        },
      ],
    });

    const checks: DoctorCheck[] = [];
    await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "config host consistency")?.status).toBe("missing");
    expect(byLabel(checks, "config secretEnv collisions")?.status).toBe("missing");
    expect(byLabel(checks, "config merge")?.status).toBe("missing");
    expect(byLabel(checks, "openclaw security (alpha/gw1)")?.status).toBe("warn");
    expect(byLabel(checks, "fleet policy (alpha)")?.status).toBe("missing");
  });

  it("covers template-host consistency and template policy violation branches", async () => {
    const repoRoot = "/repo7";
    const templateRoot = "/template7";
    const layout = getRepoLayout(repoRoot);
    const templateInfraPath = path.join(templateRoot, "fleet", "clawlets.json");
    const templateOpenclawPath = path.join(templateRoot, "fleet", "openclaw.json");

    const infraConfig = {
      schemaVersion: 2,
      defaultHost: "alpha",
      fleet: { secretEnv: {} },
      hosts: {
        alpha: {
          openclaw: { enable: true },
          gatewaysOrder: ["gw1"],
          gateways: {
            gw1: {},
          },
        },
      },
    };

    const store = makeStore({
      existing: new Set<string>([
        path.join(repoRoot, "flake.nix"),
        path.join(repoRoot, "flake.lock"),
        layout.opentofuDir,
        layout.clawletsConfigPath,
        layout.openclawConfigPath,
        templateInfraPath,
        templateOpenclawPath,
      ]),
      files: {
        [layout.clawletsConfigPath]: JSON.stringify(infraConfig),
        [layout.openclawConfigPath]: JSON.stringify({
          schemaVersion: 1,
          fleet: { secretEnv: {} },
          hosts: {
            alpha: {
              enable: true,
              gatewaysOrder: ["gw1"],
              gateways: { gw1: {} },
            },
          },
        }),
        [templateInfraPath]: JSON.stringify({
          schemaVersion: 2,
          defaultHost: "beta",
          fleet: { secretEnv: {} },
          hosts: {
            beta: {
              openclaw: { enable: true },
              gatewaysOrder: ["gw2"],
              gateways: { gw2: {} },
            },
          },
        }),
        [templateOpenclawPath]: JSON.stringify({
          schemaVersion: 1,
          fleet: { secretEnv: {} },
          hosts: {
            gamma: {
              enable: true,
              gatewaysOrder: ["gw2"],
              gateways: { gw2: {} },
            },
          },
        }),
      },
    });

    loadInfraConfigAsyncMock.mockResolvedValueOnce({ config: infraConfig });
    resolveTemplateRootMock.mockResolvedValueOnce(templateRoot);
    evalFleetConfigMock.mockImplementation(async ({ repoRoot: root, hostName }: { repoRoot: string; hostName: string }) => {
      if (root === repoRoot && hostName === "alpha") return { gateways: ["gw1"], gatewayProfiles: {} };
      if (root === templateRoot && hostName === "beta") return { gateways: ["gw2"], gatewayProfiles: {} };
      return { gateways: [], gatewayProfiles: {} };
    });
    validateFleetPolicyMock.mockReturnValueOnce({ ok: true, violations: [] });
    validateFleetPolicyMock.mockReturnValueOnce({
      ok: false,
      violations: [
        {
          filePath: path.join(templateRoot, "fleet", "clawlets.json"),
          message: "template policy violation",
          detail: "gw2 profile mismatch",
        },
      ],
    });

    const checks: DoctorCheck[] = [];
    await addRepoChecks({
      repoRoot,
      layout,
      host: "alpha",
      nixBin: "nix",
      push: (row) => checks.push(row),
      store,
    });

    expect(byLabel(checks, "template config host consistency")?.status).toBe("missing");
    expect(byLabel(checks, "template fleet policy (beta)")?.status).toBe("missing");
  });
});
