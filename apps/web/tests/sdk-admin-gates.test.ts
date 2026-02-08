import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";

const GLOBAL_STORAGE_KEY = Symbol.for("tanstack-start:start-storage-context");
const globalObj = globalThis as { [GLOBAL_STORAGE_KEY]?: AsyncLocalStorage<unknown> };
if (!globalObj[GLOBAL_STORAGE_KEY]) globalObj[GLOBAL_STORAGE_KEY] = new AsyncLocalStorage();
const startStorage = globalObj[GLOBAL_STORAGE_KEY];
const runWithStartContext = <T>(context: unknown, fn: () => Promise<T>) => startStorage?.run(context, fn) as Promise<T>;

function startContext() {
  return {
    request: new Request("http://localhost"),
    contextAfterGlobalMiddlewares: {},
    executedRequestMiddlewares: new Set(),
  };
}

async function loadGitModuleWithDeniedAdmin() {
  vi.resetModules();
  const mutation = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }));
  const query = vi.fn(async () => ({ role: "viewer" }));
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }));
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => {
      throw new Error("admin required");
    },
  }));
  const mod = await import("~/sdk/vcs/git");
  return { mod, mutation };
}

async function loadLockdownModuleWithDeniedAdmin() {
  vi.resetModules();
  const mutation = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }));
  const query = vi.fn(async () => ({ role: "viewer" }));
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }));
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => {
      throw new Error("admin required");
    },
  }));
  const mod = await import("~/sdk/infra/lockdown");
  return { mod, mutation };
}

async function loadSecretsVerifyModuleWithDeniedAdmin() {
  vi.resetModules();
  const mutation = vi.fn(async () => ({ runId: "run_1", jobId: "job_1" }));
  const query = vi.fn(async () => ({ role: "viewer" }));
  vi.doMock("~/server/convex", () => ({
    createConvexClient: () => ({ mutation, query }) as any,
  }));
  vi.doMock("~/sdk/project", () => ({
    requireAdminProjectAccess: async () => {
      throw new Error("admin required");
    },
  }));
  const mod = await import("~/sdk/secrets/verify");
  return { mod, mutation };
}

describe("sdk admin gates", () => {
  it("blocks git push start without admin access", async () => {
    const { mod, mutation } = await loadGitModuleWithDeniedAdmin();
    await expect(
      runWithStartContext(startContext(), async () =>
        mod.gitPushExecute({ data: { projectId: "p1" as any } }),
      ),
    ).rejects.toThrow(/admin required/i);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("blocks lockdown start without admin access", async () => {
    const { mod, mutation } = await loadLockdownModuleWithDeniedAdmin();
    await expect(
      runWithStartContext(startContext(), async () =>
        mod.lockdownStart({ data: { projectId: "p1" as any, host: "alpha" } }),
      ),
    ).rejects.toThrow(/admin required/i);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("blocks secrets verify start without admin access", async () => {
    const { mod, mutation } = await loadSecretsVerifyModuleWithDeniedAdmin();
    await expect(
      runWithStartContext(startContext(), async () =>
        mod.secretsVerifyStart({ data: { projectId: "p1" as any, host: "alpha", scope: "bootstrap" } }),
      ),
    ).rejects.toThrow(/admin required/i);
    expect(mutation).not.toHaveBeenCalled();
  });
});
