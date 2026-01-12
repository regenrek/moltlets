import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile, loadFleetEnv } from "../src/lib/env";

const ENV_KEYS = [
  "HCLOUD_TOKEN",
  "ADMIN_CIDR",
  "SSH_PUBKEY_FILE",
  "SERVER_TYPE",
  "NIX_BIN",
  "GITHUB_TOKEN",
  "SOPS_AGE_KEY_FILE",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const v = savedEnv[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
});

async function setupRepo(): Promise<{ dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "clawdlets-env-"));
  await writeFile(path.join(dir, "flake.nix"), "{}\n", "utf8");
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  return { dir };
}

describe("env", () => {
  it("loads default .env file", async () => {
    const { dir } = await setupRepo();
    try {
      await writeFile(path.join(dir, ".env"), "HCLOUD_TOKEN=token\n", "utf8");
      const loaded = loadEnvFile({ cwd: dir });
      expect(loaded.envFile).toBe(path.join(dir, ".env"));
      expect(loaded.envFromFile.HCLOUD_TOKEN).toBe("token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads fleet env and validates pubkey path", async () => {
    const { dir } = await setupRepo();
    try {
      const pubKeyPath = path.join(dir, "id_ed25519.pub");
      await writeFile(pubKeyPath, "ssh-ed25519 AAA test@local\n", "utf8");
      const envText = [
        "HCLOUD_TOKEN=token",
        "ADMIN_CIDR=1.2.3.4/32",
        `SSH_PUBKEY_FILE=${pubKeyPath}`,
        "SERVER_TYPE=cx41",
        "NIX_BIN=/usr/bin/nix",
        "GITHUB_TOKEN=gh",
        `SOPS_AGE_KEY_FILE=${path.join(dir, "operator.agekey")}`,
        "",
      ].join("\n");
      await writeFile(path.join(dir, ".env"), envText, "utf8");

      const loaded = loadFleetEnv({ cwd: dir });
      expect(loaded.repoRoot).toBe(dir);
      expect(loaded.env.HCLOUD_TOKEN).toBe("token");
      expect(loaded.env.ADMIN_CIDR).toBe("1.2.3.4/32");
      expect(loaded.env.SSH_PUBKEY_FILE).toBe(pubKeyPath);
      expect(loaded.env.SERVER_TYPE).toBe("cx41");
      expect(loaded.env.NIX_BIN).toBe("/usr/bin/nix");
      expect(loaded.env.GITHUB_TOKEN).toBe("gh");
      expect(loaded.env.SOPS_AGE_KEY_FILE).toBe(path.join(dir, "operator.agekey"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects SSH_PUBKEY_FILE contents instead of path", async () => {
    const { dir } = await setupRepo();
    try {
      const envText = [
        "HCLOUD_TOKEN=token",
        "ADMIN_CIDR=1.2.3.4/32",
        "SSH_PUBKEY_FILE=ssh-ed25519 AAA invalid",
        "",
      ].join("\n");
      await writeFile(path.join(dir, ".env"), envText, "utf8");

      expect(() => loadFleetEnv({ cwd: dir })).toThrow(/SSH_PUBKEY_FILE must be a path/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when required env vars are missing", async () => {
    const { dir } = await setupRepo();
    try {
      await writeFile(path.join(dir, ".env"), "HCLOUD_TOKEN=token\n", "utf8");
      expect(() => loadFleetEnv({ cwd: dir })).toThrow(/missing required env vars/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
