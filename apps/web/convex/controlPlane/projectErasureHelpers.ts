import { Base64 } from "convex/values";
import { PROJECT_DELETION_STAGES } from "../shared/projectErasureStages";

export type DeleteStage = (typeof PROJECT_DELETION_STAGES)[number];

export function nextStage(stage: DeleteStage): DeleteStage {
  const idx = PROJECT_DELETION_STAGES.indexOf(stage);
  if (idx < 0) return "done";
  return PROJECT_DELETION_STAGES[Math.min(idx + 1, PROJECT_DELETION_STAGES.length - 1)] as DeleteStage;
}

export function canReadDeleteStatusAfterProjectRemoval(params: {
  authedUserId: string;
  authedRole: "admin" | "viewer";
  requestedByUserId: string;
}): boolean {
  return params.authedRole === "admin" || params.authedUserId === params.requestedByUserId;
}

export function randomToken(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("crypto.getRandomValues unavailable");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Base64.fromByteArray(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("crypto.subtle.digest unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hasActiveLease(
  jobOrLeaseExpiresAt: { leaseExpiresAt?: number | undefined } | number | undefined,
  now: number,
): boolean {
  const exp =
    typeof jobOrLeaseExpiresAt === "object" && jobOrLeaseExpiresAt !== null
      ? jobOrLeaseExpiresAt.leaseExpiresAt
      : jobOrLeaseExpiresAt;
  return typeof exp === "number" && exp > now;
}

export function isDeleteTokenValid(params: {
  tokens: Array<{ tokenHash: string; expiresAt: number }>;
  now: number;
  tokenHash: string;
}): boolean {
  return params.tokens.some((row) => row.expiresAt >= params.now && constantTimeEqual(row.tokenHash, params.tokenHash));
}
