#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function rmForce(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const assetsSrcDir = path.join(repoRoot, "packages", "core", "src", "assets");
  const assetsDistDir = path.join(repoRoot, "packages", "core", "dist", "assets");
  const generatedSrcDir = path.join(repoRoot, "packages", "core", "src", "generated");
  const generatedDistDir = path.join(repoRoot, "packages", "core", "dist", "generated");

  if (!fs.existsSync(assetsSrcDir)) {
    console.error(`copy-core-assets: missing ${assetsSrcDir}`);
    process.exit(1);
  }

  rmForce(assetsDistDir);
  ensureDir(path.dirname(assetsDistDir));
  fs.cpSync(assetsSrcDir, assetsDistDir, { recursive: true });

  if (fs.existsSync(generatedSrcDir)) {
    rmForce(generatedDistDir);
    ensureDir(path.dirname(generatedDistDir));
    ensureDir(generatedDistDir);

    const entries = fs.readdirSync(generatedSrcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".json")) continue;
      fs.copyFileSync(path.join(generatedSrcDir, entry.name), path.join(generatedDistDir, entry.name));
    }
  }
}

main();
