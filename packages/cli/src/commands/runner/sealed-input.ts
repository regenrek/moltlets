import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";

export const RUNNER_SEALED_INPUT_ALG = "rsa-oaep-3072/aes-256-gcm";
const SEALED_INPUT_ENVELOPE_MAX_CHARS = 2 * 1024 * 1024;

// Threat model: runner-side transport must avoid sending plaintext deploy credential values
// through control-plane APIs. The CLI only receives and handles ciphertext envelopes,
// then decrypts only on the target runner execution path.

function sanitizeKeySegment(value: string, fallback: string): string {
  const trimmed = String(value || "").trim();
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe || fallback;
}

export async function resolveRunnerSealedInputKeyPath(params: {
  runtimeDir?: string;
  projectId: string;
  runnerName: string;
}): Promise<string> {
  const runtimeDir = String(params.runtimeDir || "").trim();
  const projectSegment = sanitizeKeySegment(params.projectId, "project");
  const keyFileName = `${sanitizeKeySegment(params.runnerName, "runner")}.pem`;
  if (runtimeDir) {
    return path.join(runtimeDir, "keys", "runner-input", projectSegment, keyFileName);
  }
  return path.join(os.homedir(), ".clawlets", "keys", "runner-input", projectSegment, keyFileName);
}

type SealedEnvelopeV1 = {
  v: 1;
  alg: string;
  kid: string;
  iv: string;
  w: string;
  ct: string;
};

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function decodeBase64UrlField(value: string, field: string): Buffer {
  const normalized = validateB64Url(value, field);
  const decoded = fromBase64Url(normalized);
  if (!decoded.length || toBase64Url(decoded) !== normalized) {
    throw new Error(`sealed input ${field} invalid`);
  }
  return decoded;
}

function parseEnvelope(raw: string): SealedEnvelopeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("sealed input envelope invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sealed input envelope invalid");
  }
  const row = parsed as Record<string, unknown>;
  const v = row.v;
  if (v !== 1) throw new Error("sealed input envelope version unsupported");
  const alg = String(row.alg || "").trim();
  const kid = String(row.kid || "").trim();
  const iv = String(row.iv || "").trim();
  const w = String(row.w || "").trim();
  const ct = String(row.ct || "").trim();
  if (!alg || !kid || !iv || !w || !ct) {
    throw new Error("sealed input envelope missing fields");
  }
  return { v: 1, alg, kid, iv, w, ct };
}

function validateB64Url(value: string, field: string): string {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`sealed input ${field} invalid`);
  return value;
}

export async function loadOrCreateRunnerSealedInputKeypair(params: {
  privateKeyPath: string;
}): Promise<{
  privateKeyPem: string;
  publicKeySpkiB64: string;
  keyId: string;
  alg: string;
}> {
  const privateKeyPath = path.resolve(params.privateKeyPath);
  await fs.mkdir(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });

  let privateKeyPem: string;
  try {
    privateKeyPem = await fs.readFile(privateKeyPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 });
    privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    await fs.writeFile(privateKeyPath, privateKeyPem, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(
      async (writeErr) => {
        if ((writeErr as NodeJS.ErrnoException)?.code !== "EEXIST") throw writeErr;
        privateKeyPem = await fs.readFile(privateKeyPath, "utf8");
      },
    );
  }

  const priv = createPrivateKey(privateKeyPem);
  const pub = createPublicKey(priv);
  const spki = pub.export({ format: "der", type: "spki" });
  const spkiBuf = Buffer.isBuffer(spki) ? spki : Buffer.from(spki);
  const publicKeySpkiB64 = toBase64Url(spkiBuf);
  const keyId = toBase64Url(createHash("sha256").update(spkiBuf).digest());
  return {
    privateKeyPem,
    publicKeySpkiB64,
    keyId,
    alg: RUNNER_SEALED_INPUT_ALG,
  };
}

export function unsealRunnerInput(params: {
  runnerPrivateKeyPem: string;
  aad: string;
  envelopeB64: string;
  expectedAlg?: string;
  expectedKeyId?: string;
}): string {
  const encodedEnvelope = String(params.envelopeB64 || "").trim();
  if (!encodedEnvelope) throw new Error("sealed input envelope missing");
  if (encodedEnvelope.length > SEALED_INPUT_ENVELOPE_MAX_CHARS) {
    throw new Error("sealed input envelope too large");
  }
  const envelopeJson = decodeBase64UrlField(encodedEnvelope, "envelope").toString("utf8");
  const envelope = parseEnvelope(envelopeJson);
  if (params.expectedAlg && envelope.alg !== params.expectedAlg) {
    throw new Error("sealed input algorithm mismatch");
  }
  if (params.expectedKeyId && envelope.kid !== params.expectedKeyId) {
    throw new Error("sealed input key changed, retry reserve/finalize");
  }
  if (envelope.alg !== RUNNER_SEALED_INPUT_ALG) {
    throw new Error("sealed input algorithm unsupported");
  }

  const iv = decodeBase64UrlField(envelope.iv, "iv");
  if (iv.length !== 12) throw new Error("sealed input iv invalid");
  const wrapped = decodeBase64UrlField(envelope.w, "wrapped key");
  const ctAndTag = decodeBase64UrlField(envelope.ct, "ciphertext");
  if (ctAndTag.length < 17) throw new Error("sealed input ciphertext invalid");

  const privateKey = createPrivateKey(params.runnerPrivateKeyPem);
  const rawAes = privateDecrypt(
    {
      key: privateKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    wrapped,
  );
  if (rawAes.length !== 32) throw new Error("sealed input aes key invalid");

  const tag = ctAndTag.subarray(ctAndTag.length - 16);
  const ciphertext = ctAndTag.subarray(0, ctAndTag.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", rawAes, iv);
  decipher.setAAD(Buffer.from(params.aad, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
