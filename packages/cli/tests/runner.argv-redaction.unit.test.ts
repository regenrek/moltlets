import { describe, expect, it } from "vitest";

describe("runner argv redaction", () => {
  it("redacts inline secrets, sensitive flags, and temp secret paths", async () => {
    const { __test_sanitizeArgvForLogs } = await import("../src/commands/runner/start.js");
    const tempSecretsPath = "/tmp/clawlets-runner-input.job1.123.json";

    const argv = __test_sanitizeArgvForLogs({
      exec: "clawlets",
      args: [
        `--from-json=${tempSecretsPath}`,
        tempSecretsPath,
        "https://user:pass@example.com/repo.git",
        "https://example.com?a=1&access_token=abc&x=1",
        "-H",
        "Authorization: Bearer abc",
        "--token",
        "abc",
        "--other",
        "x",
      ],
      tempSecretsPath,
    });

    const joined = argv.join(" ");
    expect(joined).toContain("--from-json=<runner_temp_secret_file>");
    expect(joined).not.toContain(tempSecretsPath);
    expect(joined).not.toContain("user:pass");
    expect(joined).not.toContain("access_token=abc");
    expect(joined).not.toContain("Bearer abc");
    expect(joined).toContain("--token");
    expect(argv).toContain("<redacted>");
  });
});

