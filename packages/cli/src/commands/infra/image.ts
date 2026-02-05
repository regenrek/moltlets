import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineCommand } from "citty";
import { resolveGitRev } from "@clawlets/core/lib/git";
import { capture } from "@clawlets/core/lib/run";
import { withFlakesEnv } from "@clawlets/core/lib/nix-flakes";
import { loadHostContextOrExit } from "@clawlets/core/lib/context";
import { imageHetznerUpload } from "./image-hetzner.js";
import { imageAws } from "./image-aws.js";

async function buildRawImage(params: { repoRoot: string; nixBin: string; host: string }): Promise<string> {
  if (process.platform !== "linux") {
    throw new Error("image build requires Linux; run in CI or a Linux builder");
  }
  const attr = `.#packages.x86_64-linux.${params.host}-image`;
  const out = await capture(params.nixBin, ["build", "--json", "--no-link", attr], {
    cwd: params.repoRoot,
    env: withFlakesEnv(process.env),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new Error(`nix build --json returned invalid JSON (${String((e as Error)?.message || e)})`);
  }
  const imagePath = (parsed as any)?.[0]?.outputs?.out;
  if (!imagePath || typeof imagePath !== "string") {
    throw new Error("nix build did not return an image store path");
  }
  if (!fs.existsSync(imagePath)) throw new Error(`image path missing: ${imagePath}`);
  return imagePath;
}

const imageBuild = defineCommand({
  meta: {
    name: "build",
    description: "Build a raw NixOS image for a host (nixos-generators).",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    rev: { type: "string", description: "Git rev to name the image (HEAD/sha/tag).", default: "HEAD" },
    out: { type: "string", description: "Output path (default: .clawlets/images/<host>/clawlets-<host>-<rev>.raw)." },
    nixBin: { type: "string", description: "Override nix binary (default: nix)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { repoRoot, layout, hostName } = ctx;

    const revRaw = String(args.rev || "").trim() || "HEAD";
    const resolved = await resolveGitRev(repoRoot, revRaw);
    if (!resolved) throw new Error(`unable to resolve git rev: ${revRaw}`);

    const nixBin = String(args.nixBin || process.env.NIX_BIN || "nix").trim() || "nix";
    const imagePath = await buildRawImage({ repoRoot, nixBin, host: hostName });

    const outRaw = String(args.out || "").trim();
    const outPath = outRaw
      ? (path.isAbsolute(outRaw) ? outRaw : path.resolve(cwd, outRaw))
      : path.join(layout.runtimeDir, "images", hostName, `clawlets-${hostName}-${resolved}.raw`);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(imagePath, outPath);

    console.log(`ok: built raw image ${outPath}`);
  },
});

const imageHetzner = defineCommand({
  meta: {
    name: "hetzner",
    description: "Hetzner image helpers.",
  },
  subCommands: {
    upload: imageHetznerUpload,
  },
});

export const image = defineCommand({
  meta: {
    name: "image",
    description: "Image build/upload helpers (provider-specific).",
  },
  subCommands: {
    build: imageBuild,
    upload: imageHetznerUpload,
    hetzner: imageHetzner,
    aws: imageAws,
  },
});
