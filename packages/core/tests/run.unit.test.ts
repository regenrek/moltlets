import { describe, it, expect, vi, afterEach } from "vitest";
import { run, capture, captureWithInput } from "../src/lib/runtime/run";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run helpers", () => {
  it("prints redacted dry-run command", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run("echo", ["secret"], { dryRun: true, redact: ["secret"] });
    expect(spy).toHaveBeenCalledWith("echo <redacted>");
  });

  it("captures stdout output", async () => {
    const out = await capture(process.execPath, ["-e", "process.stdout.write('ok')"]);
    expect(out).toBe("ok");
  });

  it("redacts capture output when enabled", async () => {
    const out = await capture(process.execPath, ["-e", "process.stdout.write('secret')"], {
      redact: ["secret"],
      redactOutput: true,
    });
    expect(out).toBe("<redacted>");
  });

  it("captures stdout output with inherited stdin", async () => {
    const out = await capture(process.execPath, ["-e", "process.stdout.write('ok')"], { stdin: "inherit" });
    expect(out).toBe("ok");
  });

  it("returns empty string on dry-run capture", async () => {
    const out = await capture("echo", ["hi"], { dryRun: true });
    expect(out).toBe("");
  });

  it("captures stdout with stdin input", async () => {
    const out = await captureWithInput(
      process.execPath,
      ["-e", "process.stdin.on('data', d => process.stdout.write(d))"],
      "hello\n",
    );
    expect(out).toBe("hello");
  });

  it("redacts captureWithInput output when enabled", async () => {
    const out = await captureWithInput(
      process.execPath,
      ["-e", "process.stdin.on('data', d => process.stdout.write(d))"],
      "secret",
      { redact: ["secret"], redactOutput: true },
    );
    expect(out).toBe("<redacted>");
  });

  it("returns empty string on dry-run captureWithInput", async () => {
    const out = await captureWithInput("echo", ["hi"], "input\n", { dryRun: true });
    expect(out).toBe("");
  });

  it("times out capture when command hangs", async () => {
    await expect(
      capture(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/);
  });

  it("enforces max output bytes in capture", async () => {
    await expect(
      capture(process.execPath, ["-e", "process.stdout.write('a'.repeat(2048))"], { maxOutputBytes: 512 }),
    ).rejects.toThrow(/output exceeded/);
  });

  it("enforces max output bytes in captureWithInput", async () => {
    const input = "x".repeat(2048);
    await expect(
      captureWithInput(
        process.execPath,
        ["-e", "process.stdin.on('data', d => process.stdout.write(d))"],
        input,
        { maxOutputBytes: 512 },
      ),
    ).rejects.toThrow(/output exceeded/);
  });

  it("times out captureWithInput when command hangs", async () => {
    await expect(
      captureWithInput(
        process.execPath,
        ["-e", "process.stdin.on('data', () => setTimeout(() => {}, 1000))"],
        "hello\n",
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/timed out/);
  });

  it("clears timeout handle when spawn errors before exit", async () => {
    vi.useFakeTimers();
    try {
      await expect(
        capture("__missing_command__", [], { timeoutMs: 10_000 }),
      ).rejects.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when command exits non-zero", async () => {
    await expect(run(process.execPath, ["-e", "process.exit(2)"]))
      .rejects
      .toThrow(/exited with code 2/);
  });

  it("rejects capture on non-zero exit", async () => {
    await expect(capture(process.execPath, ["-e", "process.exit(3)"]))
      .rejects
      .toThrow(/exited with code 3/);
  });

  it("rejects captureWithInput on non-zero exit", async () => {
    await expect(
      captureWithInput(process.execPath, ["-e", "process.exit(4)"], "input\n"),
    )
      .rejects
      .toThrow(/exited with code 4/);
  });
});
