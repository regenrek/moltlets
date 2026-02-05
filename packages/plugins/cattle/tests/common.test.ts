import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { captureMock } = vi.hoisted(() => ({ captureMock: vi.fn() }));
vi.mock("@clawlets/core/lib/runtime/run", () => ({
  capture: captureMock,
}));

import {
  formatAgeSeconds,
  formatTable,
  loadTaskFromFile,
  readJsonFile,
  requireEnabled,
  requireFile,
  requireTtlSeconds,
  resolveOne,
  resolveTailscaleIpv4,
  unixSecondsNow,
  waitForClfJobTerminal,
} from "../src/commands/cattle/common.js";

describe("cattle common helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requireEnabled throws with hint", () => {
    expect(() => requireEnabled({ enabled: false, hint: "nope" })).toThrow(/nope/);
  });

  it("requireFile throws when missing", () => {
    const missing = path.join(os.tmpdir(), "clawlets-missing.json");
    expect(() => requireFile(missing, "file")).toThrow(/file missing/);
  });

  it("readJsonFile reports invalid json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-json-"));
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{bad", "utf8");
    expect(() => readJsonFile(bad)).toThrow(/invalid JSON:/);
  });

  it("requireTtlSeconds validates input", () => {
    expect(() => requireTtlSeconds("nope")).toThrow(/invalid --ttl/);
    const ok = requireTtlSeconds("2h");
    expect(ok.seconds).toBe(7200);
    expect(ok.normalized).toBe("2h");
  });

  it("unixSecondsNow uses Date.now", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12_345_000);
    expect(unixSecondsNow()).toBe(12345);
    nowSpy.mockRestore();
  });

  it("formatAgeSeconds chooses correct units", () => {
    expect(formatAgeSeconds(12)).toBe("12s");
    expect(formatAgeSeconds(90)).toBe("1m30s");
    expect(formatAgeSeconds(3 * 3600 + 5)).toBe("3h0m");
    expect(formatAgeSeconds(2 * 86400 + 3600)).toBe("2d1h");
  });

  it("formatTable pads columns", () => {
    const table = formatTable([
      ["id", "name"],
      ["1", "cattle-rex"],
    ]);
    expect(table.split("\n")[0]).toMatch(/id\s+name/);
    expect(table.split("\n")[1]).toMatch(/1\s+cattle-rex/);
    expect(formatTable([])).toBe("");
  });

  it("resolveTailscaleIpv4 trims output", async () => {
    captureMock.mockResolvedValueOnce("100.64.0.1\n");
    await expect(resolveTailscaleIpv4("host")).resolves.toBe("100.64.0.1");
  });

  it("resolveTailscaleIpv4 rejects empty output", async () => {
    captureMock.mockResolvedValueOnce("");
    await expect(resolveTailscaleIpv4("host")).rejects.toThrow(/returned empty output/);
  });

  it("resolveTailscaleIpv4 rejects empty hostname", async () => {
    await expect(resolveTailscaleIpv4("")).rejects.toThrow(/hostname missing/);
  });

  it("loadTaskFromFile validates schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-task-"));
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ schemaVersion: 2, taskId: "t", type: "openclaw.gateway.agent", message: "hi" }));
    expect(() => loadTaskFromFile(bad)).toThrow(/invalid task file/);
  });

  it("waitForClfJobTerminal returns terminal job", async () => {
    vi.useFakeTimers();
    const show = vi
      .fn()
      .mockResolvedValueOnce({ job: { status: "running" } })
      .mockResolvedValueOnce({ job: { status: "done" } });
    const promise = waitForClfJobTerminal({ client: { show }, jobId: "job-1", timeoutMs: 5_000, pollMs: 1_000 });
    const expectation = expect(promise).resolves.toMatchObject({ status: "done" });
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });

  it("waitForClfJobTerminal times out", async () => {
    vi.useFakeTimers();
    const show = vi.fn().mockResolvedValue({ job: { status: "running" } });
    const promise = waitForClfJobTerminal({ client: { show }, jobId: "job-2", timeoutMs: 500, pollMs: 1_000 });
    const expectation = expect(promise).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });

  it("resolveOne finds by id or name", () => {
    const servers = [
      { id: "1", name: "alpha" } as any,
      { id: "2", name: "beta" } as any,
    ];
    expect(resolveOne(servers, "2").name).toBe("beta");
    expect(resolveOne(servers, "alpha").id).toBe("1");
    expect(() => resolveOne(servers, "")).toThrow(/missing id\/name/);
  });
});
