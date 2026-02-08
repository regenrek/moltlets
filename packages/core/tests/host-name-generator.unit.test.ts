import { describe, expect, it } from "vitest";
import { HostNameSchema } from "@clawlets/shared/lib/identifiers";
import { generateHostName, HOST_NAME_ADJECTIVES, HOST_NAME_NOUNS } from "../src/lib/host/host-name-generator";

function sequenceRandom(sequence: number[]): (min: number, max: number) => number {
  let idx = 0;
  return (min: number, max: number): number => {
    const value = sequence[idx];
    idx += 1;
    if (value === undefined) return min;
    if (value < min || value >= max) throw new Error(`test random value out of bounds: ${value} not in [${min}, ${max})`);
    return value;
  };
}

describe("host-name-generator", () => {
  it("generates schema-valid word-word-num names", () => {
    const name = generateHostName({
      existingHosts: [],
      randomIntFn: sequenceRandom([0, 1, 42]),
    });

    expect(name).toBe(`${HOST_NAME_ADJECTIVES[0]}-${HOST_NAME_NOUNS[1]}-42`);
    expect(() => HostNameSchema.parse(name)).not.toThrow();
  });

  it("retries on collision and returns a unique name", () => {
    const colliding = `${HOST_NAME_ADJECTIVES[0]}-${HOST_NAME_NOUNS[0]}-42`;
    const name = generateHostName({
      existingHosts: [colliding],
      maxAttempts: 2,
      randomIntFn: sequenceRandom([0, 0, 42, 1, 1, 43]),
    });

    expect(name).toBe(`${HOST_NAME_ADJECTIVES[1]}-${HOST_NAME_NOUNS[1]}-43`);
  });

  it("fails fast when max attempts are exhausted", () => {
    const colliding = `${HOST_NAME_ADJECTIVES[0]}-${HOST_NAME_NOUNS[0]}-42`;
    expect(() =>
      generateHostName({
        existingHosts: [colliding],
        maxAttempts: 1,
        randomIntFn: sequenceRandom([0, 0, 42]),
      }),
    ).toThrow(/failed to generate unique host name/i);
  });
});
