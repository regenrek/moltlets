import { describe, it, expect } from "vitest";
import os from "node:os";
import { expandPath } from "../src/lib/path-expand";

describe("path-expand", () => {
  it("expands ~/", () => {
    expect(expandPath("~/x")).toBe(`${os.homedir()}/x`);
  });

  it("expands $HOME/", () => {
    const prev = process.env.HOME;
    process.env.HOME = "/tmp/home";
    try {
      expect(expandPath("$HOME/x")).toBe("/tmp/home/x");
      expect(expandPath("${HOME}/x")).toBe("/tmp/home/x");
    } finally {
      process.env.HOME = prev;
    }
  });
});

