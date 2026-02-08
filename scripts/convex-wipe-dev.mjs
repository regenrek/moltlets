import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

function usage(code = 2) {
  console.error(
    [
      "Usage:",
      "  node scripts/convex-wipe-dev.mjs --print-deployment --env-file <path>",
      "  node scripts/convex-wipe-dev.mjs --print-access-token",
      "  node scripts/convex-wipe-dev.mjs --print-tables --schema <apps/web/convex/schema.ts>",
      "  node scripts/convex-wipe-dev.mjs --make-empty-snapshot-zip <zipPath> --schema <apps/web/convex/schema.ts>",
    ].join("\n"),
  );
  process.exit(code);
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--print-deployment") out.printDeployment = true;
    else if (a === "--print-access-token") out.printAccessToken = true;
    else if (a === "--print-tables") out.printTables = true;
    else if (a === "--env-file") out.envFile = argv[++i];
    else if (a === "--make-empty-snapshot-zip") out.zipPath = argv[++i];
    else if (a === "--schema") out.schemaPath = argv[++i];
    else if (a === "-h" || a === "--help") usage(0);
    else usage();
  }
  return out;
}

function readEnvVarFromFile(envFile, key) {
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith(`${key}=`)) continue;
    // Take value up to first whitespace (to tolerate inline comments)
    return trimmed.slice(key.length + 1).split(/\s+/)[0] ?? "";
  }
  return "";
}

function extractSchemaTableNames(schemaPath) {
  const text = fs.readFileSync(schemaPath, "utf8");
  const names = [];
  const seen = new Set();
  // Match lines like: "  users: defineTable({"
  const re = /^\s*([A-Za-z0-9_]+)\s*:\s*defineTable\s*\(/gm;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function convexNameFromEnv() {
  const host = process.env.CONVEX_PROVISION_HOST;
  if (host) {
    const port = host.split(":")[2];
    if (!port || port === "8050") return "convex-test";
    return `convex-test-${port}`;
  }
  return "convex";
}

function readAccessToken() {
  const dir = path.join(os.homedir(), `.${convexNameFromEnv()}`);
  const configPath = path.join(dir, "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const json = JSON.parse(raw);
    const token = typeof json?.accessToken === "string" ? json.accessToken : "";
    return token.trim();
  } catch {
    return "";
  }
}

function writeEmptySnapshotZip(zipPath, tableNames) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clawlets-convex-empty-snapshot-"));
  try {
    for (const t of tableNames) {
      const dir = path.join(tmpRoot, t);
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "documents.jsonl"), "", "utf8");
    }
    // zip expects to run in the directory to get correct structure.
    execFileSync("zip", ["-rq", zipPath, "."], { cwd: tmpRoot, stdio: "inherit" });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.printDeployment) {
  if (typeof args.envFile !== "string") usage();
  const dep = readEnvVarFromFile(args.envFile, "CONVEX_DEPLOYMENT");
  process.stdout.write(dep);
  process.exit(0);
}

if (args.printAccessToken) {
  process.stdout.write(readAccessToken());
  process.exit(0);
}

if (args.printTables) {
  if (typeof args.schemaPath !== "string") usage();
  const tables = extractSchemaTableNames(args.schemaPath);
  process.stdout.write(JSON.stringify(tables, null, 2));
  process.exit(0);
}

if (typeof args.zipPath === "string") {
  if (typeof args.schemaPath !== "string") usage();
  const tables = extractSchemaTableNames(args.schemaPath);
  if (tables.length === 0) {
    throw new Error(`No tables found in schema: ${args.schemaPath}`);
  }
  writeEmptySnapshotZip(args.zipPath, tables);
  process.exit(0);
}

usage();

