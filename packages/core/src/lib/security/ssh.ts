function decodeBase64(value: string): Buffer | null {
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > 16384) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;

  const buf = Buffer.from(v, "base64");
  if (buf.length < 4) return null;
  return buf;
}

function isSshKeyTypeToken(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9@._+-]*$/.test(value);
}

const HCLOUD_SSH_KEY_TYPES = new Set([
  "ssh-ed25519",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-dss",
  "sk-ssh-ed25519@openssh.com",
  "sk-ecdsa-sha2-nistp256@openssh.com",
  "sk-ssh-ed25519",
  "sk-ecdsa-sha2-nistp256",
  "sk-ecdsa-sha2-nistp384",
  "sk-ecdsa-sha2-nistp521",
]);

const ECDSA_CURVE_BY_TYPE = {
  "ecdsa-sha2-nistp256": "nistp256",
  "ecdsa-sha2-nistp384": "nistp384",
  "ecdsa-sha2-nistp521": "nistp521",
  "sk-ecdsa-sha2-nistp256@openssh.com": "nistp256",
  "sk-ecdsa-sha2-nistp256": "nistp256",
  "sk-ecdsa-sha2-nistp384": "nistp384",
  "sk-ecdsa-sha2-nistp521": "nistp521",
} as const;

type EcdsaCurve = (typeof ECDSA_CURVE_BY_TYPE)[keyof typeof ECDSA_CURVE_BY_TYPE];

const ECDSA_POINT_LENGTHS: Record<EcdsaCurve, { compressed: number; uncompressed: number }> = {
  nistp256: { compressed: 33, uncompressed: 65 },
  nistp384: { compressed: 49, uncompressed: 97 },
  nistp521: { compressed: 67, uncompressed: 133 },
};

type BlobReader = {
  buf: Buffer;
  offset: number;
};

function readBlobString(reader: BlobReader): Buffer | null {
  if (reader.offset + 4 > reader.buf.length) return null;
  const len = reader.buf.readUInt32BE(reader.offset);
  reader.offset += 4;
  if (len > reader.buf.length - reader.offset) return null;
  const out = reader.buf.subarray(reader.offset, reader.offset + len);
  reader.offset += len;
  return out;
}

function isNonZeroIntegerPayload(value: Buffer): boolean {
  for (const b of value) {
    if (b !== 0) return true;
  }
  return false;
}

function isValidEcPoint(point: Buffer, curve: EcdsaCurve): boolean {
  if (point.length === 0) return false;
  const prefix = point[0];
  const lengths = ECDSA_POINT_LENGTHS[curve];
  if (prefix === 0x04) return point.length === lengths.uncompressed;
  if (prefix === 0x02 || prefix === 0x03) return point.length === lengths.compressed;
  return false;
}

function validateHcloudSshBlob(type: string, blob: Buffer): boolean {
  const reader: BlobReader = { buf: blob, offset: 0 };
  const typeField = readBlobString(reader);
  if (!typeField) return false;
  if (typeField.toString("utf8") !== type) return false;

  if (type === "ssh-ed25519") {
    const pub = readBlobString(reader);
    if (!pub) return false;
    return pub.length === 32 && reader.offset === reader.buf.length;
  }

  if (type === "ssh-rsa") {
    const exponent = readBlobString(reader);
    const modulus = readBlobString(reader);
    if (!exponent || !modulus) return false;
    if (!isNonZeroIntegerPayload(exponent) || !isNonZeroIntegerPayload(modulus)) return false;
    return reader.offset === reader.buf.length;
  }

  if (type === "ssh-dss") {
    const p = readBlobString(reader);
    const q = readBlobString(reader);
    const g = readBlobString(reader);
    const y = readBlobString(reader);
    if (!p || !q || !g || !y) return false;
    if (!isNonZeroIntegerPayload(p) || !isNonZeroIntegerPayload(q) || !isNonZeroIntegerPayload(g) || !isNonZeroIntegerPayload(y)) return false;
    return reader.offset === reader.buf.length;
  }

  if (type === "sk-ssh-ed25519@openssh.com" || type === "sk-ssh-ed25519") {
    const pub = readBlobString(reader);
    const application = readBlobString(reader);
    if (!pub || !application) return false;
    if (pub.length !== 32) return false;
    if (application.length === 0) return false;
    return reader.offset === reader.buf.length;
  }

  const expectedCurve = ECDSA_CURVE_BY_TYPE[type as keyof typeof ECDSA_CURVE_BY_TYPE];
  if (expectedCurve) {
    const first = readBlobString(reader);
    const second = readBlobString(reader);
    if (!first || !second) return false;

    let curveName = first.toString("utf8");
    let point = second;
    let application: Buffer | null = null;

    if (curveName !== expectedCurve) {
      // Some SK variants encode point first, then application.
      curveName = expectedCurve;
      point = first;
      application = second;
    } else {
      application = readBlobString(reader);
    }

    if (curveName !== expectedCurve) return false;
    if (!isValidEcPoint(point, expectedCurve)) return false;
    if (application && application.length === 0) return false;
    return reader.offset === reader.buf.length;
  }

  return false;
}

export function looksLikeSshPrivateKey(text: string): boolean {
  const s = text.trimStart();
  if (!s.startsWith("-----BEGIN ")) return false;
  return (
    s.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----") ||
    s.startsWith("-----BEGIN RSA PRIVATE KEY-----") ||
    s.startsWith("-----BEGIN PRIVATE KEY-----")
  );
}

export function parseSshPublicKeyLine(line: string): { type: string; base64: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  if (looksLikeSshPrivateKey(trimmed)) return null;

  const tokens = trimmed.split(/\s+/);
  for (let i = 0; i < tokens.length - 1; i++) {
    const type = tokens[i] ?? "";
    const base64 = tokens[i + 1] ?? "";
    if (!isSshKeyTypeToken(type)) continue;

    const buf = decodeBase64(base64);
    if (!buf) continue;

    const typeLen = buf.readUInt32BE(0);
    if (typeLen === 0 || typeLen > 1024) continue;
    if (4 + typeLen > buf.length) continue;
    const blobType = buf.subarray(4, 4 + typeLen).toString("utf8");
    if (blobType !== type) continue;

    // Canonicalize base64 so equivalent encodings normalize identically.
    return { type, base64: buf.toString("base64") };
  }

  return null;
}

export function normalizeSshPublicKey(text: string): string | null {
  if (looksLikeSshPrivateKey(text)) return null;
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseSshPublicKeyLine(line);
    if (parsed) return `${parsed.type} ${parsed.base64}`;
  }
  return null;
}

export function normalizeHcloudSshPublicKey(text: string): string | null {
  const normalized = normalizeSshPublicKey(text);
  if (!normalized) return null;
  const splitAt = normalized.indexOf(" ");
  if (splitAt <= 0) return null;
  const type = normalized.slice(0, splitAt);
  const base64 = normalized.slice(splitAt + 1).trim();
  if (!HCLOUD_SSH_KEY_TYPES.has(type)) return null;
  const blob = decodeBase64(base64);
  if (!blob) return null;
  if (!validateHcloudSshBlob(type, blob)) return null;
  return `${type} ${blob.toString("base64")}`;
}

export function looksLikeHcloudSshKeyContents(value: string): boolean {
  return normalizeHcloudSshPublicKey(value) !== null;
}

export function looksLikeSshKeyContents(value: string): boolean {
  return normalizeSshPublicKey(value) !== null;
}

export function parseSshPublicKeysFromText(text: string): string[] {
  if (looksLikeSshPrivateKey(text)) {
    throw new Error("ssh private key detected (expected public key)");
  }
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseSshPublicKeyLine(line);
    if (parsed) keys.push(`${parsed.type} ${parsed.base64}`);
  }
  return keys;
}
