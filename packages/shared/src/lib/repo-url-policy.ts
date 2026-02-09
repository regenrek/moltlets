export type GitRepoUrlPolicyError =
  | { code: "required"; message: string }
  | { code: "forbidden_chars"; message: string }
  | { code: "invalid"; message: string }
  | { code: "invalid_host"; message: string }
  | { code: "file_forbidden"; message: string }
  | { code: "invalid_protocol"; message: string }
  | { code: "host_not_allowed"; message: string };

const SCP_REPO_RE = /^[^@\s]+@(\[[^\]\s]+\]|[^:\s]+):[^\s]+$/;
const ALLOWED_REPO_PROTOCOLS = new Set(["https:", "ssh:"]);
const BLOCKED_REPO_HOSTS = new Set(["localhost"]);

// Reject non-canonical numeric host forms that some resolvers accept (e.g. inet_aton).
// Matches decimal (2130706433), hex (0x7f000001), octal (0177.0.0.1), or short forms (127.1).
const NON_CANONICAL_NUMERIC_HOST_RE = /^(0x[0-9a-f]+|0[0-7]+(\.[0-9]+)*|[0-9]+(\.[0-9]+){0,2})$/i;

function hasForbiddenText(value: string): boolean {
  return value.includes("\0") || value.includes("\n") || value.includes("\r");
}

function normalizeRepoHost(host: string): string {
  return host.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "").toLowerCase();
}

function parseIpv4Bytes(host: string): [number, number, number, number] | null {
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const n = Number.parseInt(part, 10);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function isBlockedIpv4(bytes: readonly [number, number, number, number]): boolean {
  const [a, b, c, d] = bytes;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true; // 0.0.0.0
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  return false;
}

function parseIpv6Groups(host: string): number[] | null {
  const zoneStripped = host.split("%", 2)[0]?.toLowerCase() ?? "";
  if (!zoneStripped) return null;
  const input = zoneStripped;
  if (input === "::") return Array(8).fill(0);
  if (input.includes("::") && input.indexOf("::") !== input.lastIndexOf("::")) return null;

  const parseParts = (parts: string[]): number[] | null => {
    const groups: number[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      if (!part) return null;
      if (part.includes(".")) {
        if (i !== parts.length - 1) return null;
        const ipv4 = parseIpv4Bytes(part);
        if (!ipv4) return null;
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  if (input.includes("::")) {
    const [leftRaw, rightRaw] = input.split("::", 2);
    const left = leftRaw ? parseParts(leftRaw.split(":")) : [];
    const right = rightRaw ? parseParts(rightRaw.split(":")) : [];
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    const out = [...left, ...Array(missing).fill(0), ...right];
    return out.length === 8 ? out : null;
  }

  const full = parseParts(input.split(":"));
  if (!full || full.length !== 8) return null;
  return full;
}

function isBlockedIpv6(groups: readonly number[]): boolean {
  if (groups.length !== 8) return false;
  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const isV4Compat = groups.slice(0, 6).every((g) => g === 0);
  if (isV4Mapped || isV4Compat) {
    const ipv4: [number, number, number, number] = [
      (groups[6]! >> 8) & 0xff,
      groups[6]! & 0xff,
      (groups[7]! >> 8) & 0xff,
      groups[7]! & 0xff,
    ];
    if (isBlockedIpv4(ipv4)) return true;
  }
  return false;
}

function isExplicitlyBlockedRepoHost(normalizedHost: string): boolean {
  if (BLOCKED_REPO_HOSTS.has(normalizedHost)) return true;
  // Reject non-canonical numeric forms that could bypass dotted-decimal checks
  // (e.g. 2130706433, 0x7f000001, 0177.0.0.1, 127.1).
  if (NON_CANONICAL_NUMERIC_HOST_RE.test(normalizedHost)) return true;
  const ipv4 = parseIpv4Bytes(normalizedHost);
  if (ipv4 && isBlockedIpv4(ipv4)) return true;
  const ipv6 = parseIpv6Groups(normalizedHost);
  if (ipv6 && isBlockedIpv6(ipv6)) return true;
  return false;
}

type ParsedGitRemote = { kind: "scp" | "url"; protocol?: string; host: string };

/** Parse a repo URL into SCP or URL form, extracting the host. */
export function parseGitRemote(repoUrl: string): ParsedGitRemote | null {
  const scpHost = repoUrl.match(SCP_REPO_RE)?.[1];
  if (scpHost) return { kind: "scp", host: scpHost };
  try {
    const u = new URL(repoUrl);
    return { kind: "url", protocol: u.protocol, host: u.hostname };
  } catch {
    return null;
  }
}

export function validateGitRepoUrlPolicy(value: unknown): { ok: true; repoUrl: string } | { ok: false; error: GitRepoUrlPolicyError } {
  const repoUrl = String(value ?? "").trim();
  if (!repoUrl) return { ok: false, error: { code: "required", message: "repoUrl required" } };
  if (hasForbiddenText(repoUrl)) return { ok: false, error: { code: "forbidden_chars", message: "repoUrl contains forbidden characters" } };
  if (/^file:/i.test(repoUrl)) return { ok: false, error: { code: "file_forbidden", message: "repoUrl file: urls are not allowed" } };

  const parsed = parseGitRemote(repoUrl);
  if (!parsed) return { ok: false, error: { code: "invalid", message: "repoUrl invalid" } };

  const host = normalizeRepoHost(parsed.host);
  if (!host) return { ok: false, error: { code: "invalid_host", message: "repoUrl invalid host" } };
  if (isExplicitlyBlockedRepoHost(host)) return { ok: false, error: { code: "host_not_allowed", message: "repoUrl host is not allowed" } };

  if (parsed.kind === "url") {
    if (!parsed.protocol || !ALLOWED_REPO_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, error: { code: "invalid_protocol", message: "repoUrl invalid protocol" } };
    }
  }

  return { ok: true, repoUrl };
}
