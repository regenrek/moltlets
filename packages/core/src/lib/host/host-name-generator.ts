import { randomInt } from "node:crypto";
import { assertSafeHostName } from "@clawlets/shared/lib/identifiers";

export const HOST_NAME_ADJECTIVES = [
  "brisk",
  "calm",
  "clear",
  "eager",
  "fierce",
  "keen",
  "lucid",
  "nimble",
  "resolute",
  "steady",
  "sturdy",
  "swift",
  "vivid",
  "bold",
  "radiant",
] as const;

export const HOST_NAME_NOUNS = [
  "atlas",
  "aurora",
  "comet",
  "ember",
  "falcon",
  "fjord",
  "harbor",
  "ion",
  "lotus",
  "nova",
  "onyx",
  "orbit",
  "quartz",
  "ridge",
  "summit",
] as const;

const HOST_SUFFIX_MIN = 10;
const HOST_SUFFIX_MAX_EXCLUSIVE = 100;
const DEFAULT_MAX_ATTEMPTS = 256;

type RandomIntFn = (min: number, max: number) => number;

export type GenerateHostNameParams = {
  existingHosts: Iterable<string>;
  maxAttempts?: number;
  randomIntFn?: RandomIntFn;
};

function pickFromDictionary(words: readonly string[], randomIntFn: RandomIntFn): string {
  const idx = randomIntFn(0, words.length);
  const picked = words[idx];
  if (!picked) throw new Error("host name dictionary index out of bounds");
  return picked;
}

function resolveMaxAttempts(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(raw) || raw <= 0) throw new Error("maxAttempts must be a positive integer");
  return raw;
}

function normalizeExistingHosts(existingHosts: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const host of existingHosts) {
    const trimmed = String(host || "").trim();
    if (trimmed) set.add(trimmed);
  }
  return set;
}

export function generateHostName(params: GenerateHostNameParams): string {
  const existing = normalizeExistingHosts(params.existingHosts);
  const maxAttempts = resolveMaxAttempts(params.maxAttempts);
  const randomIntFn = params.randomIntFn ?? randomInt;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const adjective = pickFromDictionary(HOST_NAME_ADJECTIVES, randomIntFn);
    const noun = pickFromDictionary(HOST_NAME_NOUNS, randomIntFn);
    const suffix = randomIntFn(HOST_SUFFIX_MIN, HOST_SUFFIX_MAX_EXCLUSIVE);
    const candidate = `${adjective}-${noun}-${suffix}`;

    assertSafeHostName(candidate);
    if (!existing.has(candidate)) return candidate;
  }

  throw new Error(`failed to generate unique host name after ${maxAttempts} attempts; pass --host`);
}
