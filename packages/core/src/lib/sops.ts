import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nixShellCapture, type NixToolOpts } from "./nix-tools.js";
import { run } from "./run.js";
import { ensureDir, writeFileAtomic } from "./fs-safe.js";
import { withFlakesEnv } from "./nix-flakes.js";

export async function sopsDecryptYamlFile(params: {
  filePath: string;
  filenameOverride?: string;
  ageKeyFile?: string;
  nix: NixToolOpts;
}): Promise<string> {
  const env = {
    ...withFlakesEnv(params.nix.env),
    ...(params.ageKeyFile ? { SOPS_AGE_KEY_FILE: params.ageKeyFile } : {}),
  };
  const args = [
    "decrypt",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
  ];
  if (params.filenameOverride) args.push("--filename-override", params.filenameOverride);
  args.push(params.filePath);
  return await nixShellCapture(
    "sops",
    "sops",
    args,
    { ...params.nix, env },
  );
}

export async function sopsEncryptYamlToFile(params: {
  plaintextYaml: string;
  outPath: string;
  filenameOverride?: string;
  nix: NixToolOpts;
}): Promise<void> {
  const outDir = path.dirname(params.outPath);
  await ensureDir(outDir);
  const filenameOverride = params.filenameOverride || params.outPath;

  const nixArgs = [
    "shell",
    "nixpkgs#sops",
    "-c",
    "sops",
    "encrypt",
    "--input-type",
    "yaml",
    "--output-type",
    "yaml",
    "--filename-override",
    filenameOverride,
  ];
  if (params.nix.dryRun) {
    await run(params.nix.nixBin, [...nixArgs, "--output", params.outPath, "<plaintext>"], { ...params.nix, env: withFlakesEnv(params.nix.env) });
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdlets-sops-"));
  try {
    const tmpPlain = path.join(tmpDir, "secrets.yaml");
    const tmpEnc = path.join(tmpDir, "secrets.enc.yaml");
    await writeFileAtomic(
      tmpPlain,
      params.plaintextYaml.endsWith("\n")
        ? params.plaintextYaml
        : `${params.plaintextYaml}\n`,
    );

    await run(params.nix.nixBin, [...nixArgs, "--output", tmpEnc, tmpPlain], { ...params.nix, env: withFlakesEnv(params.nix.env) });

    const encrypted = await fs.readFile(tmpEnc, "utf8");
    await writeFileAtomic(params.outPath, encrypted);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
