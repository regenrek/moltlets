import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splitFullConfig } from "@clawlets/core/lib/config/split";
import { getRepoLayout, getHostSecretsDir } from "@clawlets/core/repo-layout";
import { buildFleetSecretsPlan } from "@clawlets/core/lib/secrets/plan";
import { makeConfig } from "./fixtures.js";
import { __test_sanitizeMetadataErrorMessage, buildMetadataSnapshot } from "../src/commands/runner/metadata.js";

describe("runner metadata snapshot", () => {
  it("redacts secret-like values from metadata errors", () => {
    const message = __test_sanitizeMetadataErrorMessage(
      new Error("Authorization: Bearer secret123 https://user:pw@example.com?token=abc"),
      "fallback",
    );
    expect(message).toContain("Authorization: Bearer <redacted>");
    expect(message).toContain("https://<redacted>@example.com?token=<redacted>");
    expect(message).not.toContain("secret123");
  });

  it("falls back when metadata errors have no message", () => {
    expect(__test_sanitizeMetadataErrorMessage("   ", "metadata parse failed")).toBe("metadata parse failed");
  });

  it("derives hashes, host/gateway summary, and secret wiring names only", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-meta-"));
    const layout = getRepoLayout(repoRoot);
    await fs.mkdir(path.dirname(layout.clawletsConfigPath), { recursive: true });

    const config = makeConfig({
      hostName: "alpha",
      hostOverrides: {
        enable: true,
        gatewaysOrder: ["gw1"],
        gateways: {
          gw1: {},
        },
      } as any,
    });
    const split = splitFullConfig({ config });
    await fs.writeFile(layout.clawletsConfigPath, `${JSON.stringify(split.infra, null, 2)}\n`, "utf8");
    await fs.writeFile(layout.openclawConfigPath, `${JSON.stringify(split.openclaw, null, 2)}\n`, "utf8");

    const plan = buildFleetSecretsPlan({ config, hostName: "alpha", scope: "all" });
    const configuredSecret = plan.required[0]?.name ?? plan.optional[0]?.name;
    expect(configuredSecret).toBeTruthy();
    if (!configuredSecret) return;

    const hostSecretsDir = getHostSecretsDir(layout, "alpha");
    await fs.mkdir(hostSecretsDir, { recursive: true });
    const plaintextProbe = "plaintext-test-secret-value";
    await fs.writeFile(path.join(hostSecretsDir, `${configuredSecret}.yaml`), plaintextProbe, "utf8");

    const payload = await buildMetadataSnapshot({
      repoRoot,
      lastRunId: "run_123",
      lastRunStatus: "succeeded",
    });

    const fleetConfig = payload.projectConfigs.find((row) => row.path === "fleet/clawlets.json");
    const openclawConfig = payload.projectConfigs.find((row) => row.path === "fleet/openclaw.json");
    expect(fleetConfig?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(openclawConfig?.sha256).toMatch(/^[a-f0-9]{64}$/);

    const host = payload.hosts.find((row) => row.hostName === "alpha");
    expect(host?.patch.lastRunId).toBe("run_123");
    expect(host?.patch.lastRunStatus).toBe("succeeded");
    expect(host?.patch.desired?.gatewayCount).toBe(1);

    const gateway = payload.gateways.find((row) => row.hostName === "alpha" && row.gatewayId === "gw1");
    expect(gateway).toBeTruthy();

    const wiring = payload.secretWiring.find((row) => row.hostName === "alpha" && row.secretName === configuredSecret);
    expect(wiring?.status).toBe("configured");

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(plaintextProbe);
  });
});
