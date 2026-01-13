import { describe, it, expect, vi, afterEach } from "vitest";
import { run, capture, captureWithInput } from "../src/lib/run";

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

  it("returns empty string on dry-run captureWithInput", async () => {
    const out = await captureWithInput("echo", ["hi"], "input\n", { dryRun: true });
    expect(out).toBe("");
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
