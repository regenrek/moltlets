import { describe, expect, it } from "vitest";
import { validateGitRepoUrlPolicy, parseGitRemote } from "@clawlets/shared/lib/repo-url-policy";

describe("shared repo-url-policy", () => {
  describe("validateGitRepoUrlPolicy", () => {
    it("returns required error for empty/null/undefined input", () => {
      for (const input of [undefined, null, "", "   "]) {
        const r = validateGitRepoUrlPolicy(input);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("required");
      }
    });

    it("returns forbidden_chars for NUL/newlines", () => {
      // Characters must be mid-string; trailing \n/\r get stripped by .trim().
      for (const input of ["https://github.com/\0o/r", "https://github.com/\no/r", "https://github.com/\ro/r"]) {
        const r = validateGitRepoUrlPolicy(input);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("forbidden_chars");
      }
    });

    it("returns file_forbidden for file: URLs", () => {
      for (const input of ["file:///etc/passwd", "FILE:///tmp/repo", "File:///home/user/repo"]) {
        const r = validateGitRepoUrlPolicy(input);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("file_forbidden");
      }
    });

    it("returns invalid for unparseable URLs", () => {
      const r = validateGitRepoUrlPolicy("not-a-url-at-all");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid");
    });

    it("returns invalid_protocol for http/git protocols", () => {
      for (const input of ["http://github.com/o/r.git", "git://github.com/o/r.git"]) {
        const r = validateGitRepoUrlPolicy(input);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_protocol");
      }
    });

    it("accepts https URLs", () => {
      const r = validateGitRepoUrlPolicy("https://github.com/owner/repo.git");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.repoUrl).toBe("https://github.com/owner/repo.git");
    });

    it("accepts ssh URLs", () => {
      const r = validateGitRepoUrlPolicy("ssh://github.com/owner/repo.git");
      expect(r.ok).toBe(true);
    });

    it("accepts SCP-style URLs", () => {
      const r = validateGitRepoUrlPolicy("git@github.com:owner/repo.git");
      expect(r.ok).toBe(true);
    });

    it("blocks localhost", () => {
      const r = validateGitRepoUrlPolicy("https://localhost/o/r.git");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
    });

    it("blocks IPv4 loopback range (127.0.0.0/8)", () => {
      for (const host of ["127.0.0.1", "127.0.0.2", "127.255.255.255"]) {
        const r = validateGitRepoUrlPolicy(`https://${host}/o/r.git`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
      }
    });

    it("blocks 0.0.0.0 (unspecified)", () => {
      const r = validateGitRepoUrlPolicy("https://0.0.0.0/o/r.git");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
    });

    it("blocks IPv4 link-local (169.254.0.0/16)", () => {
      for (const host of ["169.254.169.254", "169.254.0.1", "169.254.170.2"]) {
        const r = validateGitRepoUrlPolicy(`https://${host}/o/r.git`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
      }
    });

    it("blocks IPv6 loopback (::1) and unspecified (::)", () => {
      for (const host of ["[::1]", "[0:0:0:0:0:0:0:1]", "[::]"]) {
        const r = validateGitRepoUrlPolicy(`ssh://${host}/o/r.git`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
      }
    });

    it("blocks IPv6 link-local (fe80::/10)", () => {
      const r = validateGitRepoUrlPolicy("ssh://[fe80::1]/o/r.git");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
    });

    it("blocks IPv6 link-local with zone ID via SCP", () => {
      // URL-form zone IDs (%25lo0) are rejected by new URL(); test via SCP instead.
      const r = validateGitRepoUrlPolicy("git@[fe80::1%lo0]:o/r.git");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
    });

    it("blocks IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)", () => {
      const r = validateGitRepoUrlPolicy("https://[::ffff:127.0.0.1]/o/r.git");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
    });

    it("blocks SCP-style loopback hosts", () => {
      for (const url of ["git@127.0.0.1:o/r.git", "git@[::1]:o/r.git", "git@[fe80::1%eth0]:o/r.git"]) {
        const r = validateGitRepoUrlPolicy(url);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
      }
    });

    it("blocks non-canonical numeric IPv4 forms (decimal, hex, octal, short)", () => {
      for (const host of [
        "2130706433",        // decimal 127.0.0.1
        "0x7f000001",        // hex 127.0.0.1
        "0177.0.0.1",        // octal 127.0.0.1
        "127.1",             // short-form
        "0",                 // 0.0.0.0 decimal
        "017700000001",      // octal long
      ]) {
        const r = validateGitRepoUrlPolicy(`https://${host}/o/r.git`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
      }
    });

    it("blocks non-canonical numeric hosts in SCP-style URLs", () => {
      for (const host of ["2130706433", "0x7f000001", "127.1"]) {
        const r = validateGitRepoUrlPolicy(`git@${host}:o/r.git`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("host_not_allowed");
      }
    });

    it("allows non-blocked hosts", () => {
      for (const url of [
        "https://github.com/o/r.git",
        "ssh://github.com/o/r.git",
        "git@github.com:o/r.git",
        "https://10.0.0.1/o/r.git",
        "https://192.168.1.1/o/r.git",
        "ssh://[2001:db8::1]/o/r.git",
      ]) {
        const r = validateGitRepoUrlPolicy(url);
        expect(r.ok).toBe(true);
      }
    });

    it("trims whitespace from input", () => {
      const r = validateGitRepoUrlPolicy("  https://github.com/o/r.git  ");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.repoUrl).toBe("https://github.com/o/r.git");
    });
  });

  describe("parseGitRemote", () => {
    it("parses SCP-style URLs", () => {
      const r = parseGitRemote("git@github.com:owner/repo.git");
      expect(r).toEqual({ kind: "scp", host: "github.com" });
    });

    it("parses HTTPS URLs", () => {
      const r = parseGitRemote("https://github.com/owner/repo.git");
      expect(r).toEqual({ kind: "url", protocol: "https:", host: "github.com" });
    });

    it("parses SSH URLs", () => {
      const r = parseGitRemote("ssh://github.com/owner/repo.git");
      expect(r).toEqual({ kind: "url", protocol: "ssh:", host: "github.com" });
    });

    it("returns null for garbage input", () => {
      expect(parseGitRemote("not-a-url")).toBeNull();
    });

    it("parses bracketed IPv6 SCP hosts", () => {
      const r = parseGitRemote("git@[::1]:owner/repo.git");
      expect(r).toEqual({ kind: "scp", host: "[::1]" });
    });
  });
});
