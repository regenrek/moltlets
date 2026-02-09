import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateRunnerJobPayload } from "../src/lib/runtime/runner-command-policy";
import { resolveRunnerJobCommand } from "../src/lib/runtime/runner-command-policy-resolve";

describe("runner command policy", () => {
  it("rejects non-allowlisted custom commands", () => {
    const result = validateRunnerJobPayload({
      kind: "custom",
      payloadMeta: {
        args: ["echo", "ok"],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/allowlisted/i);
  });

  it("rejects plugin custom commands", () => {
    const result = validateRunnerJobPayload({
      kind: "custom",
      payloadMeta: {
        args: ["plugin", "list"],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/forbidden/i);
  });

  it("enforces empty repoRoot for project_init", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-init-"));
    try {
      await fs.writeFile(path.join(dir, "already-there.txt"), "x", "utf8");
      const result = await resolveRunnerJobCommand({
        kind: "project_init",
        payloadMeta: { hostName: "alpha" },
        repoRoot: dir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be empty/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("builds canonical project_init command", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-init-ok-"));
    try {
      const result = await resolveRunnerJobCommand({
        kind: "project_init",
        payloadMeta: {
          hostName: "alpha",
          templateRepo: "owner/repo",
          templatePath: "templates/default",
          templateRef: "main",
        },
        repoRoot: dir,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exec).toBe("clawlets");
      expect(result.args).toEqual([
        "project",
        "init",
        "--dir",
        ".",
        "--host",
        "alpha",
        "--template",
        "owner/repo",
        "--templatePath",
        "templates/default",
        "--templateRef",
        "main",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces empty repoRoot for project_import", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-import-root-"));
    try {
      await fs.writeFile(path.join(dir, "already-there.txt"), "x", "utf8");
      const result = await resolveRunnerJobCommand({
        kind: "project_import",
        payloadMeta: { repoUrl: "https://github.com/regenrek/clawlets.git" },
        repoRoot: dir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/must be empty/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("builds canonical project_import command", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-import-"));
    try {
      const result = await resolveRunnerJobCommand({
        kind: "project_import",
        payloadMeta: {
          repoUrl: "git@github.com:regenrek/clawlets.git",
          branch: "main",
          depth: 1,
        },
        repoRoot: dir,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exec).toBe("git");
      expect(result.args).toEqual([
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        "main",
        "git@github.com:regenrek/clawlets.git",
        ".",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults project_import depth to 1 and keeps single-branch", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-policy-import-default-depth-"));
    try {
      const result = await resolveRunnerJobCommand({
        kind: "project_import",
        payloadMeta: { repoUrl: "https://github.com/regenrek/clawlets.git" },
        repoRoot: dir,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exec).toBe("git");
      expect(result.args).toEqual([
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "https://github.com/regenrek/clawlets.git",
        ".",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects project_import insecure protocols", () => {
    for (const repoUrl of ["http://github.com/regenrek/clawlets.git", "git://github.com/regenrek/clawlets.git"]) {
      const result = validateRunnerJobPayload({
        kind: "project_import",
        payloadMeta: { repoUrl },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/invalid protocol/i);
    }
  });

  it("rejects project_import file: protocol", () => {
    const result = validateRunnerJobPayload({
      kind: "project_import",
      payloadMeta: { repoUrl: "file:///etc/passwd" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/file:/i);
  });

  it("rejects project_import loopback and link-local hosts", () => {
    for (const repoUrl of [
      "https://localhost/regenrek/clawlets.git",
      "https://0.0.0.0/regenrek/clawlets.git",
      "https://127.0.0.1/regenrek/clawlets.git",
      "https://127.0.0.2/regenrek/clawlets.git",
      "ssh://[::1]/regenrek/clawlets.git",
      "ssh://[0:0:0:0:0:0:0:1]/regenrek/clawlets.git",
      "git@[::1]:regenrek/clawlets.git",
      "https://[::ffff:127.0.0.1]/regenrek/clawlets.git",
      "https://169.254.169.254/regenrek/clawlets.git",
      "https://169.254.170.2/regenrek/clawlets.git",
      "ssh://[fe80::1]/regenrek/clawlets.git",
      "ssh://[::]/regenrek/clawlets.git",
      "git@127.0.0.1:regenrek/clawlets.git",
      "git@[fe80::1%eth0]:regenrek/clawlets.git",
    ]) {
      const result = validateRunnerJobPayload({
        kind: "project_import",
        payloadMeta: { repoUrl },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/host is not allowed/i);
    }
  });

  it("rejects local template inputs for project_init", () => {
    const result = validateRunnerJobPayload({
      kind: "project_init",
      payloadMeta: {
        hostName: "alpha",
        templateRepo: "file:/tmp/template",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must be owner\/repo/i);
  });

  it("allows non-blocked hosts (including private ranges)", () => {
    for (const repoUrl of [
      "https://github.com/owner/repo.git",
      "ssh://github.com/owner/repo.git",
      "git@github.com:owner/repo.git",
      "https://10.0.0.1/owner/repo.git",
      "https://192.168.1.1/owner/repo.git",
      "ssh://[2001:db8::1]/owner/repo.git",
    ]) {
      const result = validateRunnerJobPayload({
        kind: "project_import",
        payloadMeta: { repoUrl },
      });
      expect(result.ok).toBe(true);
    }
  });
});
