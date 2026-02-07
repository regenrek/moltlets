import { beforeEach, describe, expect, it, vi } from "vitest";

const addRepoChecksMock = vi.fn(async () => ({
  bundledSkills: [],
  fleet: null,
  fleetGateways: null,
}));

const addDeployChecksMock = vi.fn(async () => {});
const addCattleChecksMock = vi.fn(async () => {});

const findRepoRootMock = vi.fn((cwd: string) => cwd);
const loadDeployCredsMock = vi.fn(() => ({ envFile: undefined, values: {} }));

vi.mock("../src/doctor/repo-checks.js", () => ({
  addRepoChecks: addRepoChecksMock,
}));

vi.mock("../src/doctor/deploy-checks.js", () => ({
  addDeployChecks: addDeployChecksMock,
}));

vi.mock("../src/doctor/cattle-checks.js", () => ({
  addCattleChecks: addCattleChecksMock,
}));

vi.mock("../src/lib/project/repo.js", () => ({
  findRepoRoot: findRepoRootMock,
}));

vi.mock("../src/lib/infra/deploy-creds.js", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

describe("doctor scope gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not run repo checks for bootstrap scope", async () => {
    const { collectDoctorChecks } = await import("../src/doctor.js");
    await collectDoctorChecks({ cwd: "/repo", host: "host", scope: "bootstrap" });
    expect(addRepoChecksMock).not.toHaveBeenCalled();
    expect(addDeployChecksMock).toHaveBeenCalledTimes(1);
  });

  it("does not run repo checks for updates scope", async () => {
    const { collectDoctorChecks } = await import("../src/doctor.js");
    await collectDoctorChecks({ cwd: "/repo", host: "host", scope: "updates" });
    expect(addRepoChecksMock).not.toHaveBeenCalled();
    expect(addDeployChecksMock).toHaveBeenCalledTimes(1);
  });

  it("does not run repo checks for cattle scope", async () => {
    const { collectDoctorChecks } = await import("../src/doctor.js");
    await collectDoctorChecks({ cwd: "/repo", host: "host", scope: "cattle" });
    expect(addRepoChecksMock).not.toHaveBeenCalled();
    expect(addCattleChecksMock).toHaveBeenCalledTimes(1);
  });

  it("runs repo checks for repo scope", async () => {
    const { collectDoctorChecks } = await import("../src/doctor.js");
    await collectDoctorChecks({ cwd: "/repo", host: "host", scope: "repo" });
    expect(addRepoChecksMock).toHaveBeenCalledTimes(1);
  });
});

