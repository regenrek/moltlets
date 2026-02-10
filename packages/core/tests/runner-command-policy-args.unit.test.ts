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

  it("rejects invalid boolean --flag=value syntax", () => {
    const result = __test_validateArgsForKind({
      kind: "custom",
      args: ["git", "status", "--json=true"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not take a value/i);
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
