import { normalizeSshPublicKey } from "../security/ssh.js";

export function escapeNixString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeNixString(value: string): string {
  // Only unescape what we escape in escapeNixString.
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function stripNixComments(text: string): string {
  return text.replace(/#.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseNixStringLiterals(text: string): string[] | null {
  const out: string[] = [];
  const rx = /"((?:\\.|[^"\\])*)"/g;
  for (const m of text.matchAll(rx)) {
    const raw = m[1];
    if (typeof raw !== "string") continue;
    // Fail closed: don't try to interpret general Nix string escapes or interpolation.
    if (raw.includes("${")) return null;
    if (/\\(?![\\"])/.test(raw)) return null;
    out.push(unescapeNixString(raw));
  }
  return out;
}

export function upsertAdminAuthorizedKey(params: {
  hostNix: string;
  sshPubkey: string;
}): string | null {
  const normalized = normalizeSshPublicKey(params.sshPubkey);
  if (!normalized) return null;

  const rx =
    /(^\s*openssh\.authorizedKeys\.keys\s*=\s*\[\s*\n)([\s\S]*?)(^\s*\];)/m;
  const m = params.hostNix.match(rx);
  if (!m) return null;

  const body = m[2] ?? "";
  const rest = stripNixComments(body.replace(/"((?:\\.|[^"\\])*)"/g, "")).trim();
  if (rest.length > 0) return null;

  const existingKeys = parseNixStringLiterals(body);
  if (!existingKeys) return null;
  for (const existing of existingKeys) {
    if (normalizeSshPublicKey(existing) === normalized) return params.hostNix;
  }

  const candidateLine =
    params.sshPubkey
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => Boolean(line) && normalizeSshPublicKey(line) === normalized) ?? normalized;

  const indent = m[1]?.match(/^\s*/)?.[0] ?? "";
  const itemIndent = `${indent}  `;
  const keyLine = `${itemIndent}"${escapeNixString(candidateLine)}"\n`;

  const bodyTrimEnd = body.replace(/\s*$/, "");
  const bodyNext = bodyTrimEnd.length > 0 ? `${bodyTrimEnd}\n${keyLine}` : keyLine;

  return params.hostNix.replace(rx, `${m[1]}${bodyNext}${m[3]}`);
}
