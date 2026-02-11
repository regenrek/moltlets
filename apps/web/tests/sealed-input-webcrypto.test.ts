import {
  constants,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto"
import { describe, expect, it } from "vitest"
import { sealForRunner, SEALED_INPUT_ALGORITHM } from "~/lib/security/sealed-input"

function toBase64Url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
  return Buffer.from(padded, "base64")
}

function flipB64UrlChar(value: string): string {
  if (!value) return value
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
  const last = value[value.length - 1] || "A"
  const idx = alphabet.indexOf(last)
  const next = alphabet[(idx >= 0 ? idx + 1 : 0) % alphabet.length] || "A"
  return value.slice(0, -1) + next
}

function tamperB64UrlBytes(value: string): string {
  const bytes = fromBase64Url(value)
  if (bytes.length === 0) return flipB64UrlChar(value)
  bytes[0] = bytes[0] ^ 0x01
  return toBase64Url(bytes)
}

function decodeEnvelope(envelopeB64: string): any {
  return JSON.parse(fromBase64Url(envelopeB64).toString("utf8"))
}

function encodeEnvelope(envelope: unknown): string {
  return toBase64Url(Buffer.from(JSON.stringify(envelope), "utf8"))
}

function unsealFromEnvelope(params: {
  privateKeyPem: string
  aad: string
  envelopeB64: string
}): string {
  const env = JSON.parse(fromBase64Url(params.envelopeB64).toString("utf8")) as {
    v: number
    alg: string
    iv: string
    w: string
    ct: string
  }
  if (env.v !== 1) throw new Error("bad version")
  if (env.alg !== SEALED_INPUT_ALGORITHM) throw new Error("bad alg")
  const wrapped = fromBase64Url(env.w)
  const iv = fromBase64Url(env.iv)
  const ctAndTag = fromBase64Url(env.ct)
  const key = createPrivateKey(params.privateKeyPem)
  const rawAes = privateDecrypt(
    {
      key,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    wrapped,
  )
  const tag = ctAndTag.subarray(ctAndTag.length - 16)
  const ciphertext = ctAndTag.subarray(0, ctAndTag.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", rawAes, iv)
  decipher.setAAD(Buffer.from(params.aad, "utf8"))
  decipher.setAuthTag(tag)
  const out = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return out.toString("utf8")
}

describe("web sealed input helper", () => {
  it("seals with webcrypto and unseals in node crypto", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
    const spki = pair.publicKey.export({ format: "der", type: "spki" })
    const spkiB64 = toBase64Url(spki)
    const aad = "project-a:job-b:custom:runner-c"
    const plaintext = JSON.stringify({ HCLOUD_TOKEN: "token-123" })

    const sealed = await sealForRunner({
      runnerPubSpkiB64: spkiB64,
      keyId: "kid-1",
      alg: SEALED_INPUT_ALGORITHM,
      aad,
      plaintextJson: plaintext,
    })

    const out = unsealFromEnvelope({
      privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      aad,
      envelopeB64: sealed,
    })
    expect(out).toBe(plaintext)
  })

  it("seals and unseals large payloads", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
    const spki = pair.publicKey.export({ format: "der", type: "spki" })
    const spkiB64 = toBase64Url(spki)
    const aad = "project-a:job-b:custom:runner-c"
    const plaintext = JSON.stringify({ HCLOUD_TOKEN: "x".repeat(512 * 1024) })

    const sealed = await sealForRunner({
      runnerPubSpkiB64: spkiB64,
      keyId: "kid-1",
      alg: SEALED_INPUT_ALGORITHM,
      aad,
      plaintextJson: plaintext,
    })

    const out = unsealFromEnvelope({
      privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      aad,
      envelopeB64: sealed,
    })
    expect(out).toBe(plaintext)
  })

  it("rejects aad mismatch", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
    const spki = pair.publicKey.export({ format: "der", type: "spki" })
    const spkiB64 = toBase64Url(spki)
    const aad = "a:b:c:d"
    const plaintext = JSON.stringify({ HCLOUD_TOKEN: "token-123" })

    const sealed = await sealForRunner({
      runnerPubSpkiB64: spkiB64,
      keyId: "kid-1",
      alg: SEALED_INPUT_ALGORITHM,
      aad,
      plaintextJson: plaintext,
    })

    expect(() =>
      unsealFromEnvelope({
        privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        aad: "x:y:z:w",
        envelopeB64: sealed,
      }),
    ).toThrow()
  })

  it("binds ciphertext to reserved job id in aad", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
    const spki = pair.publicKey.export({ format: "der", type: "spki" })
    const spkiB64 = toBase64Url(spki)
    const aadJobA = "project-a:job-a:secrets_write:runner-c"
    const aadJobB = "project-a:job-b:secrets_write:runner-c"
    const plaintext = JSON.stringify({ DISCORD_TOKEN: "token-123" })

    const sealed = await sealForRunner({
      runnerPubSpkiB64: spkiB64,
      keyId: "kid-1",
      alg: SEALED_INPUT_ALGORITHM,
      aad: aadJobA,
      plaintextJson: plaintext,
    })

    expect(
      unsealFromEnvelope({
        privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        aad: aadJobA,
        envelopeB64: sealed,
      }),
    ).toBe(plaintext)
    expect(() =>
      unsealFromEnvelope({
        privateKeyPem: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        aad: aadJobB,
        envelopeB64: sealed,
      }),
    ).toThrow()
  })

  it("rejects tampered envelope fields", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
    const spki = pair.publicKey.export({ format: "der", type: "spki" })
    const spkiB64 = toBase64Url(spki)
    const aad = "project-a:job-b:custom:runner-c"
    const plaintext = JSON.stringify({ HCLOUD_TOKEN: "token-123" })

    const sealed = await sealForRunner({
      runnerPubSpkiB64: spkiB64,
      keyId: "kid-1",
      alg: SEALED_INPUT_ALGORITHM,
      aad,
      plaintextJson: plaintext,
    })

    const privateKeyPem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
    const cases: Array<{ name: string; mutate: (env: any) => any }> = [
      { name: "ct", mutate: (env) => ({ ...env, ct: tamperB64UrlBytes(String(env.ct || "")) }) },
      { name: "iv", mutate: (env) => ({ ...env, iv: tamperB64UrlBytes(String(env.iv || "")) }) },
      { name: "w", mutate: (env) => ({ ...env, w: tamperB64UrlBytes(String(env.w || "")) }) },
      { name: "alg", mutate: (env) => ({ ...env, alg: "rsa-oaep-2048/aes-256-gcm" }) },
    ]

    for (const c of cases) {
      const env = decodeEnvelope(sealed)
      const tampered = encodeEnvelope(c.mutate(env))
      expect(() =>
        unsealFromEnvelope({
          privateKeyPem,
          aad,
          envelopeB64: tampered,
        }),
      ).toThrow()
    }
  })

  it("rejects unsupported algorithms", async () => {
    const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicExponent: 0x10001 })
    const spki = pair.publicKey.export({ format: "der", type: "spki" })
    const spkiB64 = toBase64Url(spki)
    await expect(
      sealForRunner({
        runnerPubSpkiB64: spkiB64,
        keyId: "kid-1",
        alg: "rsa-oaep-2048/aes-256-gcm",
        aad: "a:b:c:d",
        plaintextJson: "{\"k\":\"v\"}",
      }),
    ).rejects.toThrow(/unsupported sealed-input alg/i)
  })
})
