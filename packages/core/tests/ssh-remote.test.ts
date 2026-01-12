import { describe, it, expect, vi, beforeEach } from "vitest";

const runState: { cmd: string | null; args: string[] | null } = { cmd: null, args: null };
const captureState: { cmd: string | null; args: string[] | null } = { cmd: null, args: null };

vi.mock("../src/lib/run", () => ({
  run: vi.fn(async (cmd: string, args: string[]) => {
    runState.cmd = cmd;
    runState.args = args;
  }),
  capture: vi.fn(async (cmd: string, args: string[]) => {
    captureState.cmd = cmd;
    captureState.args = args;
    return "out";
  }),
}));

async function loadSshRemote() {
  return await import("../src/lib/ssh-remote");
}

beforeEach(() => {
  runState.cmd = null;
  runState.args = null;
  captureState.cmd = null;
  captureState.args = null;
});

describe("ssh target host validation", () => {
  it("accepts ssh aliases and user@host", async () => {
    const { validateTargetHost } = await loadSshRemote();
    expect(validateTargetHost("botsmj")).toBe("botsmj");
    expect(validateTargetHost("root@botsmj")).toBe("root@botsmj");
  });

  it("rejects leading dash and whitespace/control chars", async () => {
    const { isValidTargetHost, validateTargetHost } = await loadSshRemote();
    expect(isValidTargetHost("-oProxyCommand=bad")).toBe(false);
    expect(isValidTargetHost("bad host")).toBe(false);
    expect(isValidTargetHost("bad\nname")).toBe(false);
    expect(() => validateTargetHost("-oProxyCommand=bad")).toThrow(/invalid target host/i);
  });
});

describe("ssh argv construction", () => {
  it("includes -- before destination", async () => {
    const { buildSshArgs } = await loadSshRemote();
    expect(buildSshArgs("root@botsmj")).toEqual(["--", "root@botsmj"]);
  });

  it("keeps tty flag before --", async () => {
    const { buildSshArgs } = await loadSshRemote();
    expect(buildSshArgs("botsmj", { tty: true })).toEqual(["-t", "--", "botsmj"]);
  });
});

describe("ssh helpers", () => {
  it("shellQuote wraps and escapes", async () => {
    const { shellQuote } = await loadSshRemote();
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });

  it("sshRun uses ssh argv construction", async () => {
    const { sshRun } = await loadSshRemote();
    await sshRun("root@botsmj", "ls -la");
    expect(runState.cmd).toBe("ssh");
    expect(runState.args).toEqual(["--", "root@botsmj", "ls -la"]);
  });

  it("sshCapture uses ssh argv construction", async () => {
    const { sshCapture } = await loadSshRemote();
    const out = await sshCapture("botsmj", "whoami");
    expect(out).toBe("out");
    expect(captureState.cmd).toBe("ssh");
    expect(captureState.args).toEqual(["--", "botsmj", "whoami"]);
  });
});
