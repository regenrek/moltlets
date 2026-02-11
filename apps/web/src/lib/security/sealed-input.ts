const SEALED_INPUT_ALG = "rsa-oaep-3072/aes-256-gcm";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function sealForRunner(params: {
  runnerPubSpkiB64: string;
  keyId: string;
  aad: string;
  plaintextJson: string;
  alg?: string;
}): Promise<string> {
  const alg = String(params.alg || SEALED_INPUT_ALG).trim();
  if (alg !== SEALED_INPUT_ALG) throw new Error(`unsupported sealed-input alg: ${alg}`);
  if (!params.runnerPubSpkiB64.trim()) throw new Error("runner public key missing");
  if (!params.keyId.trim()) throw new Error("runner key id missing");
  if (!params.aad.trim()) throw new Error("aad required");

  const spki = fromBase64Url(params.runnerPubSpkiB64.trim());
  const publicKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(spki),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(params.aad);
  const plaintext = new TextEncoder().encode(params.plaintextJson);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        aesKey,
        toArrayBuffer(plaintext),
      ),
  );
  const rawAes = new Uint8Array(await crypto.subtle.exportKey("raw", aesKey));
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, toArrayBuffer(rawAes)),
  );
  const envelope = {
    v: 1,
    alg,
    kid: params.keyId.trim(),
    iv: toBase64Url(iv),
    w: toBase64Url(wrapped),
    ct: toBase64Url(ciphertext),
  };
  const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope));
  return toBase64Url(envelopeBytes);
}

export const SEALED_INPUT_ALGORITHM = SEALED_INPUT_ALG;
