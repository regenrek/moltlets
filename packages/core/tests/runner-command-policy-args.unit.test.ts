import { describe, expect, it } from "vitest";
import { __test_validateArgsForKind } from "../src/lib/runtime/runner-command-policy";
import { resolveCommandSpecForKind } from "../src/lib/runtime/runner-command-policy-args";

describe("runner command policy args parser", () => {
  it("rejects unknown flags", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir", ".", "--host", "alpha", "--nope", "x"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown flag/i);
  });

  it("rejects duplicate flags", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir", ".", "--host", "alpha", "--host", "beta"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate flag/i);
  });

  it("rejects `--` token", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir", ".", "--host", "alpha", "--"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/forbidden/i);
  });

  it("accepts valid --flag=value syntax", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir=.", "--host=alpha", "--template=owner/repo"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("accepts project_init without --host", () => {
    const result = __test_validateArgsForKind({
      kind: "project_init",
      args: ["project", "init", "--dir=.", "--template=owner/repo"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects invalid boolean --flag=value syntax", () => {
    const result = __test_validateArgsForKind({
      kind: "custom",
      args: ["git", "status", "--json=true"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not take a value/i);
  });

  it("accepts git setup-save for custom jobs", () => {
    const result = __test_validateArgsForKind({
      kind: "custom",
      args: ["git", "setup-save", "--host", "openclaw-fleet-host", "--json"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("accepts secrets verify --json for secrets_verify kinds", () => {
    for (const kind of ["secrets_verify", "secrets_verify_bootstrap", "secrets_verify_openclaw"]) {
      const result = __test_validateArgsForKind({
        kind,
        args: ["secrets", "verify", "--host", "alpha", "--scope", "bootstrap", "--json"],
      });
      expect(result).toEqual({ ok: true });
    }
  });

  it("accepts setup_apply canonical args", () => {
    const result = __test_validateArgsForKind({
      kind: "setup_apply",
      args: ["setup", "apply", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("requires --json for bootstrap jobs", () => {
    const missingJson = __test_validateArgsForKind({
      kind: "bootstrap",
      args: ["bootstrap", "--host", "alpha", "--mode=nixos-anywhere"],
    });
    expect(missingJson.ok).toBe(false);
    if (!missingJson.ok) expect(missingJson.error).toMatch(/missing required --json/i);

    const missingHost = __test_validateArgsForKind({
      kind: "bootstrap",
      args: ["bootstrap", "--mode=nixos-anywhere", "--json"],
    });
    expect(missingHost.ok).toBe(false);
    if (!missingHost.ok) expect(missingHost.error).toMatch(/missing required --host/i);

    const ok = __test_validateArgsForKind({
      kind: "bootstrap",
      args: ["bootstrap", "--host", "alpha", "--mode=nixos-anywhere", "--json"],
    });
    expect(ok).toEqual({ ok: true });
  });

  it("accepts host-scoped env age-key commands", () => {
    const detect = __test_validateArgsForKind({
      kind: "custom",
      args: ["env", "detect-age-key", "--host", "openclaw-fleet-host", "--json"],
    });
    expect(detect).toEqual({ ok: true });

    const generate = __test_validateArgsForKind({
      kind: "custom",
      args: ["env", "generate-age-key", "--host", "openclaw-fleet-host", "--json"],
    });
    expect(generate).toEqual({ ok: true });
  });

  it("accepts env token-keyring-mutate args for custom jobs", () => {
    const result = __test_validateArgsForKind({
      kind: "custom",
      args: ["env", "token-keyring-mutate", "--from-json", "__RUNNER_INPUT_JSON__", "--json"],
    });
    expect(result).toEqual({ ok: true });
  });

  it("resolves json_small mode for setup_apply", () => {
    const resolved = resolveCommandSpecForKind("setup_apply", [
      "setup",
      "apply",
      "--from-json",
      "__RUNNER_INPUT_JSON__",
      "--json",
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.spec.id).toBe("setup_apply");
    expect(resolved.spec.resultMode).toBe("json_small");
    expect(resolved.spec.resultMaxBytes).toBe(512 * 1024);
  });

  it("resolves json_small mode for token keyring mutate", () => {
    const resolved = resolveCommandSpecForKind("custom", [
      "env",
      "token-keyring-mutate",
      "--from-json",
      "__RUNNER_INPUT_JSON__",
      "--json",
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.spec.id).toBe("env_token_keyring_mutate");
    expect(resolved.spec.resultMode).toBe("json_small");
    expect(resolved.spec.resultMaxBytes).toBe(512 * 1024);
  });

  it("resolves json_small mode for git setup-save", () => {
    const resolved = resolveCommandSpecForKind("custom", [
      "git",
      "setup-save",
      "--host",
      "openclaw-fleet-host",
      "--json",
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.spec.id).toBe("git_setup_save_json");
    expect(resolved.spec.resultMode).toBe("json_small");
    expect(resolved.spec.resultMaxBytes).toBe(512 * 1024);
  });

  it("resolves json_small mode for bootstrap", () => {
    const resolved = resolveCommandSpecForKind("bootstrap", ["bootstrap", "--host", "alpha", "--mode=nixos-anywhere", "--json"]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.spec.id).toBe("bootstrap");
    expect(resolved.spec.resultMode).toBe("json_small");
    expect(resolved.spec.resultMaxBytes).toBe(512 * 1024);
  });

  it("resolves json_large mode for openclaw schema fetch", () => {
    const resolved = resolveCommandSpecForKind("custom", [
      "openclaw",
      "schema",
      "fetch",
      "--host",
      "alpha",
      "--gateway",
      "gw1",
      "--ssh-tty=false",
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.spec.id).toBe("openclaw_schema_fetch");
    expect(resolved.spec.resultMode).toBe("json_large");
    expect(resolved.spec.resultMaxBytes).toBe(5 * 1024 * 1024);
  });

  it("resolves json_small mode for schema status", () => {
    const resolved = resolveCommandSpecForKind("custom", [
      "openclaw",
      "schema",
      "status",
      "--json",
    ]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.spec.resultMode).toBe("json_small");
    expect(resolved.spec.resultMaxBytes).toBe(512 * 1024);
  });
});
