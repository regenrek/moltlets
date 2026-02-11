import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEALED_INPUT_ALGORITHM } from "~/lib/security/sealed-input";
import { METADATA_SYNC_LIMITS } from "../convex/controlPlane/httpParsers";

const DOCS_ROOT = path.resolve(process.cwd(), "../docs/content/docs");

function readDoc(relPath: string): string {
  return fs.readFileSync(path.join(DOCS_ROOT, relPath), "utf8");
}

describe("security docs parity", () => {
  it("keeps sealed-input transport invariants aligned", () => {
    const runnerDoc = readDoc("operations/runner-agent.mdx");
    const deployDoc = readDoc("dashboard/deploy-credentials.mdx");

    expect(`${runnerDoc}\n${deployDoc}`).toContain(SEALED_INPUT_ALGORITHM);
    expect(deployDoc).toContain("projectId:jobId:kind:targetRunnerId");
    expect(deployDoc).toContain("Control plane stores ciphertext only (`sealedInputB64`).");
  });

  it("keeps metadata sync limits aligned", () => {
    const runnerDoc = readDoc("operations/runner-agent.mdx");
    expect(runnerDoc).toContain(`projectConfigs <= ${METADATA_SYNC_LIMITS.projectConfigs}`);
    expect(runnerDoc).toContain(`hosts <= ${METADATA_SYNC_LIMITS.hosts}`);
    expect(runnerDoc).toContain(`gateways <= ${METADATA_SYNC_LIMITS.gateways}`);
    expect(runnerDoc).toContain(`secretWiring <= ${METADATA_SYNC_LIMITS.secretWiring}`);
    expect(runnerDoc).toContain(`secretWiring <= ${METADATA_SYNC_LIMITS.secretWiringPerHost}`);
  });

  it("documents metadata-only boundary with explicit plaintext bans", () => {
    const doc = readDoc("security/control-plane-metadata.mdx");
    expect(doc).toContain("plaintext secret values");
    expect(doc).toContain("deploy credentials from `.clawlets/env`");
    expect(doc).toContain("operator private keys");
  });
});
