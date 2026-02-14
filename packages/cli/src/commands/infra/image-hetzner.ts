import process from "node:process";
import { defineCommand } from "citty";
import { run } from "@clawlets/core/lib/runtime/run";
import { loadDeployCreds } from "@clawlets/core/lib/infra/deploy-creds";
import { loadHostContextOrExit } from "@clawlets/core/lib/runtime/context";

export const imageHetznerUpload = defineCommand({
  meta: {
    name: "upload",
    description: "Upload a raw image to Hetzner using hcloud-upload-image.",
  },
  args: {
    runtimeDir: { type: "string", description: "Runtime directory (default: .clawlets)." },
    envFile: { type: "string", description: "Env file for deploy creds (default: <runtimeDir>/env)." },
    host: { type: "string", description: "Host name (defaults to clawlets.json defaultHost / sole host)." },
    "image-url": { type: "string", description: "Public URL for the raw image (Hetzner must reach it)." },
    compression: { type: "string", description: "Compression type (none|gz|bz2|xz).", default: "none" },
    architecture: { type: "string", description: "Architecture (x86 or arm).", default: "x86" },
    location: { type: "string", description: "Hetzner location (default: host hetzner.location or fsn1)." },
    name: { type: "string", description: "Image name override (optional)." },
    dryRun: { type: "boolean", description: "Print commands without executing.", default: false },
    bin: { type: "string", description: "Override hcloud-upload-image binary (default: hcloud-upload-image)." },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const ctx = loadHostContextOrExit({ cwd, runtimeDir: (args as any).runtimeDir, hostArg: args.host });
    if (!ctx) return;
    const { hostName, hostCfg } = ctx;

    const deployCreds = loadDeployCreds({ cwd, runtimeDir: (args as any).runtimeDir, envFile: (args as any).envFile });
    const hcloudToken = String(deployCreds.values.HCLOUD_TOKEN || "").trim();
    if (!hcloudToken) throw new Error("missing active Hetzner API key (set HCLOUD_TOKEN_KEYRING + HCLOUD_TOKEN_KEYRING_ACTIVE; use Setup -> Hetzner API keys)");

    const imageUrl = String((args as any)["image-url"] || "").trim();
    if (!imageUrl) throw new Error("missing --image-url");

    const compression = String(args.compression || "").trim();
    const compressionArg = compression === "none" ? "" : compression;
    if (compressionArg && !["gz", "bz2", "xz"].includes(compressionArg)) {
      throw new Error("invalid --compression (expected none|gz|bz2|xz)");
    }

    const architecture = String(args.architecture || "").trim() || "x86";
    if (!["x86", "arm"].includes(architecture)) {
      throw new Error("invalid --architecture (expected x86|arm)");
    }

    const location = String(args.location || hostCfg.hetzner.location || "fsn1").trim() || "fsn1";
    const name = String(args.name || "").trim();
    const bin = String(args.bin || "hcloud-upload-image").trim() || "hcloud-upload-image";

    const cmd = ["upload", "--image-url", imageUrl, "--architecture", architecture, "--location", location];
    if (compressionArg) cmd.push("--compression", compressionArg);
    if (name) cmd.push("--name", name);

    await run(bin, cmd, {
      env: { ...process.env, HCLOUD_TOKEN: hcloudToken },
      dryRun: args.dryRun,
      redact: [hcloudToken],
    });

    console.log(`ok: upload complete for ${hostName}`);
    console.log("hint: set hetzner.image in fleet/clawlets.json to the new image ID/name");
  },
});
