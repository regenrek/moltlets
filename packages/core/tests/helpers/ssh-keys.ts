function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

export function makeEd25519PublicKey(opts?: { comment?: string; seedByte?: number }): string {
  const type = "ssh-ed25519";
  const typeBuf = Buffer.from(type, "utf8");
  const seedByte = typeof opts?.seedByte === "number" ? opts.seedByte : 1;
  const pub = Buffer.alloc(32, seedByte);
  const blob = Buffer.concat([u32be(typeBuf.length), typeBuf, u32be(pub.length), pub]);
  const base64 = blob.toString("base64");
  const comment = opts?.comment ? ` ${opts.comment}` : "";
  return `${type} ${base64}${comment}`;
}

