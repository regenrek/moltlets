import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"

import { readClawletsEnvTokens, redactLine } from "../src/server/redaction"

describe("readClawletsEnvTokens", () => {
  it("extracts unique values from .clawlets/env", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clawlets-web-redaction-"))
    await mkdir(path.join(root, ".clawlets"), { recursive: true })
    await writeFile(
      path.join(root, ".clawlets", "env"),
      [
        "# comment",
        "",
        "HCLOUD_TOKEN=abc12345",
        "EMPTY=",
        "SPACED =  abc12345  ",
        "SHORT=abc",
      ].join("\n"),
      "utf8",
    )

    const tokens = await readClawletsEnvTokens(root)
    expect(tokens).toEqual(["abc12345", "abc"])
  })
})

describe("redactLine", () => {
  it("redacts tokens >= 4 chars", () => {
    expect(redactLine("token abc12345 here", ["abc12345"])).toBe("token <redacted> here")
    expect(redactLine("abc", ["abc"])).toBe("abc")
    expect(redactLine("abc12345 abc12345", ["abc12345"])).toBe("<redacted> <redacted>")
  })

  it("scrubs url credentials", () => {
    const input = "fetch https://user:pass123@github.com/org/repo.git"
    expect(redactLine(input, [])).toBe("fetch https://<redacted>@github.com/org/repo.git")
  })
})
