import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type SecretsPolicyViolation = {
  filePath: string;
  message: string;
  line?: number;
};

function isYamlFile(name: string): boolean {
  return /\.ya?ml$/i.test(name);
}

export function validateHostSecretsYamlFiles(params: { secretsDir: string }): { ok: boolean; violations: SecretsPolicyViolation[] } {
  const dir = params.secretsDir;
  const violations: SecretsPolicyViolation[] = [];

  if (!fs.existsSync(dir)) {
    violations.push({ filePath: dir, message: "missing secrets dir" });
    return { ok: false, violations };
  }
  const st = fs.statSync(dir);
  if (!st.isDirectory()) {
    violations.push({ filePath: dir, message: "secrets path is not a directory" });
    return { ok: false, violations };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!isYamlFile(e.name)) continue;
    const filePath = path.join(dir, e.name);
    const expectedKey = e.name.replace(/\.ya?ml$/i, "");
    let parsed: unknown;
    try {
      parsed = YAML.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      violations.push({ filePath, message: `invalid YAML: ${String((err as Error)?.message || err)}` });
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      violations.push({ filePath, message: "expected YAML mapping/object at top-level" });
      continue;
    }
    const keys = Object.keys(parsed as Record<string, unknown>).filter((k) => k !== "sops");
    if (keys.length !== 1) {
      violations.push({ filePath, message: `expected exactly 1 secret key (found ${keys.length})` });
      continue;
    }
    const actualKey = keys[0]!;
    if (actualKey !== expectedKey) {
      violations.push({ filePath, message: `secret key must match filename (expected ${expectedKey}, got ${actualKey})` });
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, "sops")) {
      violations.push({ filePath, message: "missing sops metadata (file looks unencrypted)" });
    }
  }

  return { ok: violations.length === 0, violations };
}
