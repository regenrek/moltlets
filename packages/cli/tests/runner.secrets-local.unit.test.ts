import { afterEach, describe, expect, it } from "vitest";
import { LocalSecretsBuffer } from "../src/commands/runner/secrets-local.js";

function nextPort(): number {
  return 44000 + Math.floor(Math.random() * 1000);
}

describe("runner local secrets transport", () => {
  let buffer: LocalSecretsBuffer | null = null;

  afterEach(async () => {
    if (buffer) {
      await buffer.stop();
      buffer = null;
    }
  });

  it("accepts nonce+origin validated secret submit and returns one-time payload", async () => {
    const port = nextPort();
    buffer = new LocalSecretsBuffer(30_000);
    await buffer.start({
      port,
      nonce: "nonce-123",
      allowedOrigin: "http://localhost:3000",
    });

    const response = await fetch(`http://127.0.0.1:${port}/secrets/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clawlets-nonce": "nonce-123",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        jobId: "job-1",
        secrets: {
          ADMIN_PASSWORD_HASH: "hash-value",
          OPENAI_API_KEY: "sk-test",
        },
      }),
    });
    expect(response.status).toBe(200);

    const consumed = await buffer.waitOrPrompt({
      jobId: "job-1",
      timeoutMs: 100,
      allowPrompt: false,
    });
    expect(consumed).toEqual({
      ADMIN_PASSWORD_HASH: "hash-value",
      OPENAI_API_KEY: "sk-test",
    });

    await expect(
      buffer.waitOrPrompt({
        jobId: "job-1",
        timeoutMs: 10,
        allowPrompt: false,
      }),
    ).rejects.toThrow(/secrets input missing/i);
  });

  it("rejects wrong nonce", async () => {
    const port = nextPort();
    buffer = new LocalSecretsBuffer(30_000);
    await buffer.start({
      port,
      nonce: "nonce-123",
      allowedOrigin: "http://localhost:3000",
    });

    const response = await fetch(`http://127.0.0.1:${port}/secrets/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clawlets-nonce": "wrong",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ jobId: "job-x", secrets: { X: "1" } }),
    });
    expect(response.status).toBe(403);
  });

  it("requires explicit allowed origin", async () => {
    const port = nextPort();
    buffer = new LocalSecretsBuffer(30_000);
    expect(() =>
      buffer.start({
        port,
        nonce: "nonce-123",
      }),
    ).toThrow(/allowedOrigin required/i);
  });
});
