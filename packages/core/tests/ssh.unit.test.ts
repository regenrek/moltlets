import { describe, it, expect } from "vitest";

import {
  looksLikeHcloudSshKeyContents,
  looksLikeSshKeyContents,
  looksLikeSshPrivateKey,
  normalizeHcloudSshPublicKey,
  normalizeSshPublicKey,
  parseSshPublicKeyLine,
  parseSshPublicKeysFromText,
} from "../src/lib/security/ssh";
import { makeEd25519PublicKey } from "./helpers/ssh-keys";

function u32be(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function makePublicKeyBlob(type: string, fields: readonly Buffer[]): Buffer {
  const chunks: Buffer[] = [u32be(Buffer.from(type).length), Buffer.from(type)];
  for (const field of fields) {
    chunks.push(u32be(field.length), field);
  }
  return Buffer.concat(chunks);
}

function makePublicKeyLine(type: string, fields: readonly Buffer[]): string {
  return `${type} ${makePublicKeyBlob(type, fields).toString("base64")}`;
}

function makeHcloudPoint(curveLength: number, prefix = 0x04): Buffer {
  const buf = Buffer.alloc(curveLength, 0);
  buf[0] = prefix;
  return buf;
}

describe("ssh public key parsing", () => {
  it("normalizes common key types", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 1 });
    expect(normalizeSshPublicKey(`${ed25519} test`)).toBe(ed25519);
    expect(
      normalizeSshPublicKey("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= comment"),
    ).toBe("ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=");
  });

  it("canonicalizes base64 variants", () => {
    const type = "ecdsa-sha2-nistp256";
    const padded = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=";
    const unpadded = padded.replace(/=+$/, "");
    expect(normalizeSshPublicKey(`${type} ${unpadded} comment`)).toBe(`${type} ${padded}`);
    expect(normalizeSshPublicKey(`${type} ${padded} comment`)).toBe(`${type} ${padded}`);
  });

  it("rejects invalid base64 padding", () => {
    expect(normalizeSshPublicKey("ssh-ed25519 AAAA=== comment")).toBeNull();
    expect(parseSshPublicKeyLine("ssh-ed25519 AAAA=== comment")).toBeNull();
  });

  it("detects key contents vs paths", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 2, comment: "test" });
    expect(looksLikeSshKeyContents(ed25519)).toBe(true);
    expect(looksLikeSshKeyContents("/tmp/id_ed25519.pub")).toBe(false);
  });

  it("parses authorized_keys style options", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 3 });
    const base64 = ed25519.split(/\s+/)[1] ?? "";
    const parsed = parseSshPublicKeyLine(`from="*.example.com",no-pty ${ed25519} user@host`);
    expect(parsed).toEqual({
      type: "ssh-ed25519",
      base64,
    });
  });

  it("extracts multiple keys from text", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 4 });
    const keys = parseSshPublicKeysFromText([
      "# comment",
      "",
      `${ed25519} one`,
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY= two",
      "",
    ].join("\n"));
    expect(keys).toEqual([
      ed25519,
      "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=",
    ]);
  });

  it("validates hcloud-compatible key material", () => {
    const ed25519 = makeEd25519PublicKey({ seedByte: 7 });
    expect(normalizeHcloudSshPublicKey(`${ed25519} comment`)).toBe(ed25519);
    expect(looksLikeHcloudSshKeyContents(ed25519)).toBe(true);
    expect(normalizeHcloudSshPublicKey("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7dummy")).toBeNull();
    expect(looksLikeHcloudSshKeyContents("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7dummy")).toBe(false);
  });

  it("validates hcloud ssh-rsa payload shape", () => {
    const valid = makePublicKeyLine("ssh-rsa", [Buffer.from([1, 0]), Buffer.from([1, 2, 3, 4])]);
    expect(normalizeHcloudSshPublicKey(valid)).toBe(valid);

    const zeroExponent = makePublicKeyLine("ssh-rsa", [Buffer.from([0]), Buffer.from([1, 2, 3])]);
    expect(normalizeHcloudSshPublicKey(zeroExponent)).toBeNull();
  });

  it("validates hcloud ssh-dss payload shape", () => {
    const valid = makePublicKeyLine("ssh-dss", [
      Buffer.from([1]),
      Buffer.from([2]),
      Buffer.from([3]),
      Buffer.from([4]),
    ]);
    expect(normalizeHcloudSshPublicKey(valid)).toBe(valid);

    const zeroY = makePublicKeyLine("ssh-dss", [
      Buffer.from([1]),
      Buffer.from([2]),
      Buffer.from([3]),
      Buffer.from([0]),
    ]);
    expect(normalizeHcloudSshPublicKey(zeroY)).toBeNull();
  });

  it("validates hcloud sk-ssh-ed25519 payload variants", () => {
    const valid = makePublicKeyLine("sk-ssh-ed25519", [Buffer.alloc(32, 1), Buffer.from("u2f")]);
    expect(normalizeHcloudSshPublicKey(valid)).toBe(valid);

    const emptyApplication = makePublicKeyLine("sk-ssh-ed25519", [Buffer.alloc(32, 1), Buffer.from("")]);
    expect(normalizeHcloudSshPublicKey(emptyApplication)).toBeNull();
  });

  it("validates hcloud sk-ecdsa payload variants", () => {
    const matchingCurve = makePublicKeyLine("sk-ecdsa-sha2-nistp256", [
      Buffer.from("nistp256"),
      makeHcloudPoint(33, 0x02),
      Buffer.from("app"),
    ]);
    expect(normalizeHcloudSshPublicKey(matchingCurve)).toBe(matchingCurve);

    const mismatchedCurve = makePublicKeyLine("sk-ecdsa-sha2-nistp256", [
      makeHcloudPoint(65),
      Buffer.from("app"),
    ]);
    expect(normalizeHcloudSshPublicKey(mismatchedCurve)).toBe(mismatchedCurve);

    const invalidPoint = makePublicKeyLine("sk-ecdsa-sha2-nistp256", [
      Buffer.alloc(0),
      Buffer.from("app"),
    ]);
    expect(normalizeHcloudSshPublicKey(invalidPoint)).toBeNull();

    const emptyApplication = makePublicKeyLine("sk-ecdsa-sha2-nistp256", [
      Buffer.from("nistp256"),
      makeHcloudPoint(65),
      Buffer.alloc(0),
    ]);
    expect(normalizeHcloudSshPublicKey(emptyApplication)).toBeNull();
  });

  it("throws when parsing private key text as public key list", () => {
    expect(() => {
      parseSshPublicKeysFromText("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
    }).toThrow("ssh private key detected (expected public key)");
  });
});

describe("ssh private key detection", () => {
  it("recognizes private key PEM headers", () => {
    expect(looksLikeSshPrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n")).toBe(true);
    expect(looksLikeSshPrivateKey("-----BEGIN PRIVATE KEY-----\nabc\n")).toBe(true);
    expect(looksLikeSshPrivateKey("ssh-ed25519 AAAA test")).toBe(false);
  });
});
