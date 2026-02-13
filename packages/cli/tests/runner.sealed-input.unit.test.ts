import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  constants,
  createCipheriv,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  loadOrCreateRunnerSealedInputKeypair,
  RUNNER_SEALED_INPUT_ALG,
  resolveRunnerSealedInputKeyPath,
  unsealRunnerInput,
} from "../src/commands/runner/sealed-input.js";

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function flipB64UrlChar(value: string): string {
  if (!value) return value;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = value[value.length - 1] || "A";
  const idx = alphabet.indexOf(last);
  const next = alphabet[(idx >= 0 ? idx + 1 : 0) % alphabet.length] || "A";
  return value.slice(0, -1) + next;
}

function tamperB64UrlBytes(value: string): string {
  const bytes = fromBase64Url(value);
  if (bytes.length === 0) return flipB64UrlChar(value);
  bytes[0] = bytes[0] ^ 0x01;
  return toBase64Url(bytes);
}

function buildEnvelope(params: {
  publicKeySpkiB64: string;
  keyId: string;
  aad: string;
  plaintext: string;
}): string {
  const pub = createPublicKey({
    key: fromBase64Url(params.publicKeySpkiB64),
    format: "der",
    type: "spki",
  });
  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  cipher.setAAD(Buffer.from(params.aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(params.plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapped = publicEncrypt(
    {
      key: pub,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    aesKey,
  );

  const envelope = {
    v: 1,
    alg: RUNNER_SEALED_INPUT_ALG,
    kid: params.keyId,
    iv: toBase64Url(iv),
    w: toBase64Url(wrapped),
    ct: toBase64Url(Buffer.concat([ciphertext, tag])),
  };
  return toBase64Url(Buffer.from(JSON.stringify(envelope), "utf8"));
}

describe("runner sealed input", () => {
  it("creates and reuses persisted keypair", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const privateKeyPath = path.join(tempDir, "runner.pem");
      const first = await loadOrCreateRunnerSealedInputKeypair({ privateKeyPath });
      const second = await loadOrCreateRunnerSealedInputKeypair({ privateKeyPath });
      expect(first.alg).toBe(RUNNER_SEALED_INPUT_ALG);
      expect(first.publicKeySpkiB64).toBe(second.publicKeySpkiB64);
      expect(first.keyId).toBe(second.keyId);
      expect(first.privateKeyPem.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("unseals envelope with matching aad", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const aad = "p1:j1:custom:r1";
      const plaintext = JSON.stringify({ token: "abc", region: "us-east-1" });
      const envelopeB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad,
        plaintext,
      });

      const out = unsealRunnerInput({
        runnerPrivateKeyPem: keypair.privateKeyPem,
        aad,
        envelopeB64,
        expectedAlg: RUNNER_SEALED_INPUT_ALG,
        expectedKeyId: keypair.keyId,
      });
      expect(out).toBe(plaintext);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects aad mismatch and key-id mismatch", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const envelopeB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad: "p1:j1:custom:r1",
        plaintext: "{\"k\":\"v\"}",
      });

      expect(() =>
        unsealRunnerInput({
          runnerPrivateKeyPem: keypair.privateKeyPem,
          aad: "p1:j1:custom:r2",
          envelopeB64,
          expectedAlg: RUNNER_SEALED_INPUT_ALG,
          expectedKeyId: keypair.keyId,
        }),
      ).toThrow();

      expect(() =>
        unsealRunnerInput({
          runnerPrivateKeyPem: keypair.privateKeyPem,
          aad: "p1:j1:custom:r1",
          envelopeB64,
          expectedAlg: RUNNER_SEALED_INPUT_ALG,
          expectedKeyId: "different-key-id",
        }),
      ).toThrow(/key changed|key id mismatch/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects tampered envelope fields", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const aad = "p1:j1:custom:r1";
      const plaintext = JSON.stringify({ token: "abc" });
      const envelopeB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad,
        plaintext,
      });

      const cases: Array<{ name: string; mutate: (env: any) => any; expectMessage?: RegExp }> = [
        { name: "ct", mutate: (env) => ({ ...env, ct: tamperB64UrlBytes(String(env.ct || "")) }) },
        { name: "iv", mutate: (env) => ({ ...env, iv: tamperB64UrlBytes(String(env.iv || "")) }) },
        { name: "w", mutate: (env) => ({ ...env, w: tamperB64UrlBytes(String(env.w || "")) }) },
        {
          name: "alg",
          mutate: (env) => ({ ...env, alg: "rsa-oaep-2048/aes-256-gcm" }),
          expectMessage: /algorithm mismatch/i,
        },
      ];

      for (const c of cases) {
        const env = JSON.parse(fromBase64Url(envelopeB64).toString("utf8"));
        const tamperedB64 = toBase64Url(Buffer.from(JSON.stringify(c.mutate(env)), "utf8"));
        const fn = () =>
          unsealRunnerInput({
            runnerPrivateKeyPem: keypair.privateKeyPem,
            aad,
            envelopeB64: tamperedB64,
            expectedAlg: RUNNER_SEALED_INPUT_ALG,
            expectedKeyId: keypair.keyId,
          });
        if (c.expectMessage) {
          expect(fn).toThrow(c.expectMessage);
        } else {
          expect(fn).toThrow();
        }
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses global key path when runtimeDir is unset", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-home-"));
    const prevHome = process.env["HOME"];
    process.env["HOME"] = tempHome;
    try {
      const resolved = await resolveRunnerSealedInputKeyPath({
        projectId: "p1",
        runnerName: "runner-a",
      });
      expect(resolved).toBe(path.join(tempHome, ".clawlets", "keys", "runner-input", "p1", "runner-a.pem"));
    } finally {
      process.env["HOME"] = prevHome;
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });

  it("includes project segment when runtimeDir is set", async () => {
    const resolved = await resolveRunnerSealedInputKeyPath({
      runtimeDir: "/tmp/runtime",
      projectId: "p1",
      runnerName: "runner-a",
    });
    expect(resolved).toBe(path.join("/tmp/runtime", "keys", "runner-input", "p1", "runner-a.pem"));
  });

  it("rejects oversized envelope before decoding", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      expect(() =>
        unsealRunnerInput({
          runnerPrivateKeyPem: keypair.privateKeyPem,
          aad: "p1:j1:custom:r1",
          envelopeB64: "a".repeat(2 * 1024 * 1024 + 1),
          expectedAlg: RUNNER_SEALED_INPUT_ALG,
          expectedKeyId: keypair.keyId,
        }),
      ).toThrow(/too large/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid envelope json variants", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const badEnvelopes = [
        toBase64Url(Buffer.from("not-json", "utf8")),
        toBase64Url(Buffer.from(JSON.stringify({ v: 1, alg: RUNNER_SEALED_INPUT_ALG }), "utf8")),
        toBase64Url(
          Buffer.from(
            JSON.stringify({ v: 2, alg: RUNNER_SEALED_INPUT_ALG, kid: "k", iv: "a", w: "b", ct: "c" }),
            "utf8",
          ),
        ),
      ];
      for (const envelopeB64 of badEnvelopes) {
        expect(() =>
          unsealRunnerInput({
            runnerPrivateKeyPem: keypair.privateKeyPem,
            aad: "p1:j1:custom:r1",
            envelopeB64,
            expectedAlg: RUNNER_SEALED_INPUT_ALG,
            expectedKeyId: keypair.keyId,
          }),
        ).toThrow();
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed envelope fields after decode", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    try {
      const keypair = await loadOrCreateRunnerSealedInputKeypair({
        privateKeyPath: path.join(tempDir, "runner.pem"),
      });
      const aad = "p1:j1:custom:r1";
      const envelopeB64 = buildEnvelope({
        publicKeySpkiB64: keypair.publicKeySpkiB64,
        keyId: keypair.keyId,
        aad,
        plaintext: "{\"k\":\"v\"}",
      });
      const decoded = JSON.parse(fromBase64Url(envelopeB64).toString("utf8")) as Record<string, unknown>;

      const missingCt = toBase64Url(Buffer.from(JSON.stringify({ ...decoded, ct: "" }), "utf8"));
      expect(() =>
        unsealRunnerInput({
          runnerPrivateKeyPem: keypair.privateKeyPem,
          aad,
          envelopeB64: missingCt,
          expectedAlg: RUNNER_SEALED_INPUT_ALG,
          expectedKeyId: keypair.keyId,
        }),
      ).toThrow(/missing fields/i);

      const shortIv = toBase64Url(Buffer.from(JSON.stringify({ ...decoded, iv: toBase64Url(Buffer.alloc(8)) }), "utf8"));
      expect(() =>
        unsealRunnerInput({
          runnerPrivateKeyPem: keypair.privateKeyPem,
          aad,
          envelopeB64: shortIv,
          expectedAlg: RUNNER_SEALED_INPUT_ALG,
          expectedKeyId: keypair.keyId,
        }),
      ).toThrow(/iv invalid/i);

      const shortCt = toBase64Url(Buffer.from(JSON.stringify({ ...decoded, ct: toBase64Url(Buffer.alloc(16)) }), "utf8"));
      expect(() =>
        unsealRunnerInput({
          runnerPrivateKeyPem: keypair.privateKeyPem,
          aad,
          envelopeB64: shortCt,
          expectedAlg: RUNNER_SEALED_INPUT_ALG,
          expectedKeyId: keypair.keyId,
        }),
      ).toThrow(/ciphertext invalid/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rethrows non-ENOENT read errors when loading keypair", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    const privateKeyPath = path.join(tempDir, "runner.pem");
    const spy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(
      Object.assign(new Error("permission denied"), { code: "EACCES" }) as NodeJS.ErrnoException,
    );
    try {
      await expect(loadOrCreateRunnerSealedInputKeypair({ privateKeyPath })).rejects.toThrow(/permission denied/i);
    } finally {
      spy.mockRestore();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rethrows non-EEXIST write errors while creating keypair", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlets-runner-sealed-"));
    const privateKeyPath = path.join(tempDir, "runner.pem");
    const readSpy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }) as NodeJS.ErrnoException,
    );
    const writeSpy = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(
      Object.assign(new Error("io error"), { code: "EIO" }) as NodeJS.ErrnoException,
    );
    try {
      await expect(loadOrCreateRunnerSealedInputKeypair({ privateKeyPath })).rejects.toThrow(/io error/i);
    } finally {
      readSpy.mockRestore();
      writeSpy.mockRestore();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
