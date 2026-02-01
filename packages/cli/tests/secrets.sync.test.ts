import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getRepoLayout } from "@clawlets/core/repo-layout";
import { makeConfig } from "./fixtures.js";

const loadHostContextMock = vi.fn();
const resolveGitRevMock = vi.fn();
const createSecretsTarMock = vi.fn();
const runMock = vi.fn();
const sshRunMock = vi.fn();

vi.mock("@clawlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawlets/core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawlets/core/lib/secrets-tar", () => ({
  createSecretsTar: createSecretsTarMock,
}));

vi.mock("@clawlets/core/lib/run", () => ({
  run: runMock,
}));

vi.mock("@clawlets/core/lib/ssh-remote", () => ({
  sshRun: sshRunMock,
  shellQuote: (s: string) => s,
}));

vi.mock("../src/commands/ssh-target.js", () => ({
  needsSudo: () => false,
  requireTargetHost: (v: string) => v,
}));

describe("secrets sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads tar and runs install-secrets", async () => {
    const layout = getRepoLayout("/repo");
    const config = makeConfig({ hostName: "alpha", fleetOverrides: { botOrder: [] } });
    const hostCfg = config.hosts.alpha;
    loadHostContextMock.mockReturnValue({ layout, config, hostName: "alpha", hostCfg });
    resolveGitRevMock.mockResolvedValue("deadbeef");
    const tarPath = path.join(tmpdir(), "secrets.tgz");
    fs.writeFileSync(tarPath, "data");
    createSecretsTarMock.mockResolvedValue({ tarPath, digest: "digest" });
    const { secretsSync } = await import("../src/commands/secrets/sync.js");
    await secretsSync.run({ args: { host: "alpha", targetHost: "admin@host" } } as any);
    expect(runMock).toHaveBeenCalledWith("scp", [tarPath, "admin@host:/tmp/clawlets-secrets.alpha." + process.pid + ".tgz"], { redact: [] });
    expect(sshRunMock).toHaveBeenCalled();
  });
});
