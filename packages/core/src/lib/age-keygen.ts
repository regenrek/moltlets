import { parseAgeKeygenOutput, type AgeKeypair } from "./age.js";
import { nixShellCapture, type NixToolOpts } from "./nix-tools.js";

export async function ageKeygen(opts: NixToolOpts): Promise<AgeKeypair> {
  if (opts.dryRun) {
    const publicKey =
      "age1dryrundryrundryrundryrundryrundryrundryrundryrundryrun0l9p4";
    const secretKey =
      "AGE-SECRET-KEY-DRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUN";
    const fileText = `# created: dry-run\n# public key: ${publicKey}\n${secretKey}\n`;
    return { publicKey, secretKey, fileText };
  }
  const out = await nixShellCapture("age", "age-keygen", [], opts);
  return parseAgeKeygenOutput(out);
}

export async function agePublicKeyFromIdentityFile(identityFilePath: string, opts: NixToolOpts): Promise<string> {
  if (opts.dryRun) {
    return "age1dryrundryrundryrundryrundryrundryrundryrundryrundryrun0l9p4";
  }
  const out = await nixShellCapture("age", "age-keygen", ["-y", identityFilePath], opts);
  const publicKey = String(out || "").trim();
  if (!publicKey.startsWith("age1")) throw new Error(`failed to derive age public key from identity file: ${identityFilePath}`);
  return publicKey;
}
