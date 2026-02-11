import { describe, it, expect } from "vitest";
import { upsertAdminAuthorizedKey } from "../src/lib/nix/nix-host";
import { makeEd25519PublicKey } from "./helpers/ssh-keys";

describe("nix-host", () => {
  it("upserts admin authorized key", () => {
    const otherKey = makeEd25519PublicKey({ seedByte: 2, comment: "other" });
    const key = makeEd25519PublicKey({ seedByte: 1, comment: "test" });
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	    "${otherKey}"
  ];
};
`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).not.toBeNull();
    expect(out).toContain(`"${key}"`);
  });

  it("inserts into an empty key list", () => {
    const key = makeEd25519PublicKey({ seedByte: 1, comment: "test" });
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	  ];
};
`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).not.toBeNull();
    expect(out).toContain(`"${key}"`);
  });

  it("returns null when no key list found", () => {
    const out = upsertAdminAuthorizedKey({
      hostNix: "users.users.admin = {};",
      sshPubkey: makeEd25519PublicKey({ seedByte: 1, comment: "test" }),
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
    const base = makeEd25519PublicKey({ seedByte: 1 }).split(/\s+/)[1] ?? "";
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	    "ssh-ed25519 ${base} old-comment"
	  ];
	};
	`;
    const key = `ssh-ed25519 ${base} new-comment`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).toBe(hostNix);
  });

  it("does not change when key already present (base64 padding variants)", () => {
    const type = "ecdsa-sha2-nistp256";
    const padded = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=";
    const unpadded = padded.replace(/=+$/, "");
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	    "${type} ${unpadded} old-comment"
	  ];
	};
	`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: `${type} ${padded} new-comment` });
    expect(out).toBe(hostNix);
  });

  it("returns null when key list is not simple string literals", () => {
    const key = makeEd25519PublicKey({ seedByte: 1, comment: "test" });
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	    (builtins.readFile ./admin_key.pub)
	  ];
	};
	`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).toBeNull();
  });

  it("returns null when key list uses interpolation", () => {
    const key = makeEd25519PublicKey({ seedByte: 1, comment: "test" });
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	    "\${builtins.readFile ./admin_key.pub}"
	  ];
	};
	`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).toBeNull();
  });

  it("returns null when string literals contain unsupported escapes", () => {
    const key = makeEd25519PublicKey({ seedByte: 1, comment: "test" });
    const hostNix = `
	users.users.admin = {
	  openssh.authorizedKeys.keys = [
	    "ssh-ed25519 AAAA\\\\ncomment"
	  ];
	};
	`;
    const out = upsertAdminAuthorizedKey({ hostNix, sshPubkey: key });
    expect(out).toBeNull();
  });

});
