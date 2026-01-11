import { describe, it, expect } from "vitest";
import { setBootstrapSsh, upsertAdminAuthorizedKey } from "../src/lib/nix-host";

describe("nix-host", () => {
  it("upserts admin authorized key", () => {
    const hostNix = `
users.users.admin = {
  openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAOTHER other"
  ];
};
`;
    const key = "ssh-ed25519 AAAATEST test";
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).not.toBeNull();
    expect(out).toContain('"ssh-ed25519 AAAATEST test"');
  });

  it("inserts into an empty key list", () => {
    const hostNix = `
users.users.admin = {
  openssh.authorizedKeys.keys = [
  ];
};
`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: "ssh-ed25519 AAAATEST test" });
    expect(out).not.toBeNull();
    expect(out).toContain('"ssh-ed25519 AAAATEST test"');
  });

  it("returns null when no key list found", () => {
    const out = upsertAdminAuthorizedKey({
      hostNix: "users.users.admin = {};",
      sshPubkey: "ssh-ed25519 AAAATEST test",
    });
    expect(out).toBeNull();
  });

  it("returns null for invalid ssh pubkey", () => {
    const out = upsertAdminAuthorizedKey({
      hostNix: 'openssh.authorizedKeys.keys = [ "ssh-ed25519 AAAA test" ];',
      sshPubkey: "nope",
    });
    expect(out).toBeNull();
  });

  it("does not change when key already present (normalized match)", () => {
    const hostNix = `
users.users.admin = {
  openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAATEST old-comment"
  ];
};
`;
    const key = "ssh-ed25519 AAAATEST new-comment";
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).toBe(hostNix);
  });

  it("sets bootstrapSsh", () => {
    const hostNix = "bootstrapSsh = false;";
    expect(setBootstrapSsh({ hostNix, enabled: true })).toBe("bootstrapSsh = true;");
  });

  it("sets bootstrapSsh to false", () => {
    const hostNix = "bootstrapSsh = true;";
    expect(setBootstrapSsh({ hostNix, enabled: false })).toBe("bootstrapSsh = false;");
  });
});
