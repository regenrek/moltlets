import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("ensure-gateway-token script", () => {
  it("writes token file atomically in destination dir", () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const scriptPath = path.join(repoRoot, "nix", "scripts", "ensure-gateway-token.sh");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-gateway-token-"));
    const outEnvFile = path.join(outDir, "gateway.env");
    const user = os.userInfo().username;
    const group = String(execFileSync("id", ["-gn"], { encoding: "utf8" })).trim();

    execFileSync("bash", [scriptPath], {
      env: {
        ...process.env,
        CLAWLETS_GATEWAY_ENV_FILE: outEnvFile,
        CLAWLETS_BOT_USER: user,
        CLAWLETS_BOT_GROUP: group,
      },
      stdio: "pipe",
    });

    expect(fs.existsSync(outEnvFile)).toBe(true);
    const contents = fs.readFileSync(outEnvFile, "utf8");
    expect(contents).toMatch(/^OPENCLAW_GATEWAY_TOKEN=/);

    const mode = fs.statSync(outEnvFile).mode & 0o777;
    expect(mode).toBe(0o400);

    const leftover = fs.readdirSync(outDir).filter((name) => name.startsWith(".clawlets-gateway-token."));
    expect(leftover).toEqual([]);
  });
});
