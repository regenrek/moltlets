import fs from "node:fs";
import path from "node:path";

export type InlineScriptViolation = {
  filePath: string;
  line: number;
  rule: string;
  text: string;
};

type Rule = { name: string; rx: RegExp };

const RULES: Rule[] = [
  { name: "python -c", rx: /\bpython3?\s+-c\b/ },
  { name: "python heredoc", rx: /\bpython3?\s+.*<<\s*'?PY'?/ },
  { name: "node -e", rx: /\bnode\s+-e\b/ },
  { name: "node heredoc", rx: /\bnode\s+.*<<\s*'?NODE'?/ },
  { name: "PY heredoc label", rx: /<<\s*'?PY'?/ },
  { name: "NODE heredoc label", rx: /<<\s*'?NODE'?/ },
];

function shouldScanFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base.startsWith(".")) return false;
  if (base === "node_modules") return false;
  if (filePath.includes(`${path.sep}node_modules${path.sep}`)) return false;
  if (filePath.includes(`${path.sep}.git${path.sep}`)) return false;
  if (filePath.includes(`${path.sep}.clawlets${path.sep}`)) return false;
  return filePath.endsWith(".nix") || filePath.endsWith(".sh") || filePath.endsWith(".bash");
}

function walk(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".clawlets") continue;
        stack.push(p);
        continue;
      }
      if (ent.isFile() && shouldScanFile(p)) out.push(p);
    }
  }
  return out.toSorted();
}

export function findInlineScriptingViolations(params: { repoRoot: string }): InlineScriptViolation[] {
  const roots = [path.join(params.repoRoot, "infra"), path.join(params.repoRoot, "scripts")];
  const files = roots.flatMap((r) => walk(r));
  const violations: InlineScriptViolation[] = [];

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]!;
      for (const rule of RULES) {
        if (rule.rx.test(lineText)) {
          violations.push({
            filePath,
            line: i + 1,
            rule: rule.name,
            text: lineText.trim(),
          });
        }
      }
    }
  }

  return violations;
}

