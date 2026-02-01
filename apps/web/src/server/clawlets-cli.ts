import fs from "node:fs";
import path from "node:path";

export function resolveClawletsCliEntry(): string {
  const candidates = [
    path.resolve(process.cwd(), "packages/cli/dist/main.mjs"),
    path.resolve(process.cwd(), "../packages/cli/dist/main.mjs"),
    path.resolve(process.cwd(), "../../packages/cli/dist/main.mjs"),
    path.resolve(process.cwd(), "../../../packages/cli/dist/main.mjs"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error("unable to find clawlets CLI entry (packages/cli/dist/main.mjs). Run `pnpm -C packages/cli build`.");
}

