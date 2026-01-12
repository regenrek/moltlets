import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveLegacySecretPaths } from "../src/lib/secrets-migrate";

describe("resolveLegacySecretPaths", () => {
  it("rejects traversal or unsafe secret names", () => {
    expect(() =>
      resolveLegacySecretPaths({
        localSecretsDir: "/repo/.clawdlets/secrets/hosts/host",
        extraFilesSecretsDir: "/repo/.clawdlets/extra-files/host",
        secretName: "../pwn",
      }),
    ).toThrow(/invalid secret name/i);
  });

  it("resolves paths within secrets dirs", () => {
    const localRoot = "/repo/.clawdlets/secrets/hosts/host";
    const extraRoot = "/repo/.clawdlets/extra-files/host";
    const out = resolveLegacySecretPaths({
      localSecretsDir: localRoot,
      extraFilesSecretsDir: extraRoot,
      secretName: "db_password",
    });
    expect(out.localPath).toBe(path.resolve(localRoot, "db_password.yaml"));
    expect(out.extraPath).toBe(path.resolve(extraRoot, "db_password.yaml"));
  });
});
