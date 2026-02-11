import { describe, expect, it } from "vitest";
import { redactKnownSecrets, redactKnownSecretsText } from "../src/lib/runtime/redaction";

describe("runtime redaction", () => {
  it("preserves key separators while redacting known secret keys", () => {
    const input = "token: tok123 apiKey = abc123 password=supersecret";
    expect(redactKnownSecretsText(input)).toBe("token: <redacted> apiKey = <redacted> password=<redacted>");
  });

  it("redacts auth headers, query tokens, and URL credentials", () => {
    const input =
      "Authorization: Bearer secret-token https://user:pass@github.com/org/repo.git ?token=abc123&x=1";
    expect(redactKnownSecretsText(input)).toBe(
      "Authorization: Bearer <redacted> https://<redacted>@github.com/org/repo.git ?token=<redacted>&x=1",
    );
  });

  it("redacts custom secret-like key names", () => {
    const input = "DISCORD_TOKEN=abc12345 HCLOUD_TOKEN: tok123 client_secret = shh";
    const out = redactKnownSecretsText(input);
    expect(out).toBe("DISCORD_TOKEN=<redacted> HCLOUD_TOKEN: <redacted> client_secret = <redacted>");
  });

  it("redacts token-like blobs (jwt, hex, base64-ish)", () => {
    const input = [
      "jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhIjoxLCJiIjoyfQ.hVQ7jM9x2Pm4FQ1cCVY3j3uG9v4A1rK8",
      "hex=0123456789abcdef0123456789abcdef",
      "blob=AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789",
    ].join(" ");
    const out = redactKnownSecretsText(input);
    expect(out).toContain("jwt=<redacted>");
    expect(out).toContain("hex=<redacted>");
    expect(out).toContain("blob=<redacted>");
  });

  it("marks redacted=false when unchanged", () => {
    const result = redactKnownSecrets("normal log line");
    expect(result).toEqual({ text: "normal log line", redacted: false });
  });
});
