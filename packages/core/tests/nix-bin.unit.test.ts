import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { prependPathDirs, resolveNixBin } from "../src/lib/nix/nix-bin";

describe("nix-bin", () => {
  it("resolves nix on PATH", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-nix-bin-"));
    const nixPath = path.join(tmpDir, "nix");
    fs.writeFileSync(nixPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(resolveNixBin({ env: { PATH: tmpDir }, nixBin: "nix" })).toBe(nixPath);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for missing explicit path", () => {
    expect(resolveNixBin({ env: { PATH: "" }, nixBin: "/does/not/exist/nix" })).toBe(null);
  });

  it("prepends dirs without duplicates", () => {
    const delim = path.delimiter;
    const base = ["/a", "/b"].join(delim);
    const out = prependPathDirs(base, ["/c", "/a"]);
    const tokens = out.split(delim).filter(Boolean);
    expect(tokens[0]).toBe("/c");
    expect(tokens.filter((t) => t === "/a").length).toBe(1);
  });
});
