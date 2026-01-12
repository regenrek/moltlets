import { describe, it, expect, beforeEach, vi } from "vitest";

const state: {
  lastCmd?: string;
  lastArgs?: string[];
  lastInput?: string;
  lastOpts?: { env?: NodeJS.ProcessEnv };
} = {};

vi.mock("../src/lib/run.js", () => ({
  capture: vi.fn(async (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    state.lastCmd = cmd;
    state.lastArgs = args;
    state.lastOpts = opts;
    return "out";
  }),
  captureWithInput: vi.fn(async (
    cmd: string,
    args: string[],
    input: string,
    opts?: { env?: NodeJS.ProcessEnv },
  ) => {
    state.lastCmd = cmd;
    state.lastArgs = args;
    state.lastInput = input;
    state.lastOpts = opts;
    return "out";
  }),
  run: vi.fn(async (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    state.lastCmd = cmd;
    state.lastArgs = args;
    state.lastOpts = opts;
  }),
}));

import { nixRunCapture, nixRun, nixShellCapture, nixShellCaptureWithInput } from "../src/lib/nix-tools";

describe("nix-tools", () => {
  beforeEach(() => {
    state.lastCmd = undefined;
    state.lastArgs = undefined;
    state.lastInput = undefined;
    state.lastOpts = undefined;
  });

  it("builds nix run args and flakes env", async () => {
    await nixRunCapture("git", ["status"], {
      nixBin: "nix",
      env: { NIX_CONFIG: "extra = 1" },
    });

    expect(state.lastCmd).toBe("nix");
    expect(state.lastArgs).toEqual(["run", "--impure", "nixpkgs#git", "--", "status"]);
    const env = state.lastOpts?.env || {};
    expect(env.NIX_CONFIG).toContain("extra = 1");
    expect(env.NIX_CONFIG).toContain("nix-command");
    expect(env.NIX_CONFIG).toContain("flakes");
  });

  it("runs nix shell capture", async () => {
    await nixShellCapture("sops", "sops", ["-v"], { nixBin: "nix" });
    expect(state.lastArgs).toEqual(["shell", "nixpkgs#sops", "-c", "sops", "-v"]);
  });

  it("passes stdin for nix shell capture with input", async () => {
    await nixShellCaptureWithInput("mkpasswd", "mkpasswd", ["--stdin"], "secret\n", { nixBin: "nix" });
    expect(state.lastArgs).toEqual(["shell", "nixpkgs#mkpasswd", "-c", "mkpasswd", "--stdin"]);
    expect(state.lastInput).toBe("secret\n");
  });

  it("runs nix run", async () => {
    await nixRun("sops", ["--version"], { nixBin: "nix" });
    expect(state.lastArgs).toEqual(["run", "--impure", "nixpkgs#sops", "--", "--version"]);
  });
});
