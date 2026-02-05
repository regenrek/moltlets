import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDeployCreds } from "../src/lib/deploy-creds";

const ENV_KEYS = [
  "HCLOUD_TOKEN",
  "GITHUB_TOKEN",
  "NIX_BIN",
  "SOPS_AGE_KEY_FILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
] as const;

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
  const dir = await mkdtemp(path.join(tmpdir(), "clawlets-deploy-creds-"));
  await writeFile(path.join(dir, "flake.nix"), "{}\n", "utf8");
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  return { dir };
}

describe("deploy-creds", () => {
  it("loads default <runtimeDir>/env file", async () => {
    const { dir } = await setupRepo();
    try {
      await mkdir(path.join(dir, ".clawlets"), { recursive: true });
      await writeFile(path.join(dir, ".clawlets", "env"), "HCLOUD_TOKEN=token\n", "utf8");
      await chmod(path.join(dir, ".clawlets", "env"), 0o600);

      const loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.envFile?.status).toBe("ok");
      expect(loaded.envFile?.origin).toBe("default");
      expect(loaded.values.HCLOUD_TOKEN).toBe("token");
      expect(loaded.sources.HCLOUD_TOKEN).toBe("file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("process.env wins over env file", async () => {
    const { dir } = await setupRepo();
    try {
      await mkdir(path.join(dir, ".clawlets"), { recursive: true });
      await writeFile(path.join(dir, ".clawlets", "env"), "HCLOUD_TOKEN=filetoken\n", "utf8");
      await chmod(path.join(dir, ".clawlets", "env"), 0o600);

      process.env.HCLOUD_TOKEN = "envtoken";

      const loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.values.HCLOUD_TOKEN).toBe("envtoken");
      expect(loaded.sources.HCLOUD_TOKEN).toBe("env");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects insecure env file permissions", async () => {
    const { dir } = await setupRepo();
    try {
      await mkdir(path.join(dir, ".clawlets"), { recursive: true });
      await writeFile(path.join(dir, ".clawlets", "env"), "HCLOUD_TOKEN=token\n", "utf8");
      await chmod(path.join(dir, ".clawlets", "env"), 0o644);

      const loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.envFile?.status).toBe("invalid");
      expect(loaded.values.HCLOUD_TOKEN).toBeUndefined();
      expect(loaded.sources.HCLOUD_TOKEN).toBe("unset");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tracks explicit missing env file", async () => {
    const { dir } = await setupRepo();
    try {
      const loaded = loadDeployCreds({ cwd: dir, envFile: "./missing.env" });
      expect(loaded.envFile?.origin).toBe("explicit");
      expect(loaded.envFile?.status).toBe("missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves SOPS_AGE_KEY_FILE relative to repo root", async () => {
    const { dir } = await setupRepo();
    try {
      await mkdir(path.join(dir, ".clawlets"), { recursive: true });
      await writeFile(path.join(dir, ".clawlets", "env"), "SOPS_AGE_KEY_FILE=.clawlets/keys/operators/me.agekey\n", "utf8");
      await chmod(path.join(dir, ".clawlets", "env"), 0o600);

      const loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.values.SOPS_AGE_KEY_FILE).toBe(path.join(dir, ".clawlets", "keys", "operators", "me.agekey"));
      expect(loaded.sources.SOPS_AGE_KEY_FILE).toBe("file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads AWS credentials from env file and lets process.env override", async () => {
    const { dir } = await setupRepo();
    try {
      await mkdir(path.join(dir, ".clawlets"), { recursive: true });
      await writeFile(
        path.join(dir, ".clawlets", "env"),
        ["AWS_ACCESS_KEY_ID=file-key", "AWS_SECRET_ACCESS_KEY=file-secret", ""].join("\n"),
        "utf8",
      );
      await chmod(path.join(dir, ".clawlets", "env"), 0o600);

      let loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.values.AWS_ACCESS_KEY_ID).toBe("file-key");
      expect(loaded.values.AWS_SECRET_ACCESS_KEY).toBe("file-secret");
      expect(loaded.sources.AWS_ACCESS_KEY_ID).toBe("file");
      expect(loaded.sources.AWS_SECRET_ACCESS_KEY).toBe("file");

      process.env.AWS_ACCESS_KEY_ID = "env-key";
      process.env.AWS_SECRET_ACCESS_KEY = "env-secret";
      loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.values.AWS_ACCESS_KEY_ID).toBe("env-key");
      expect(loaded.values.AWS_SECRET_ACCESS_KEY).toBe("env-secret");
      expect(loaded.sources.AWS_ACCESS_KEY_ID).toBe("env");
      expect(loaded.sources.AWS_SECRET_ACCESS_KEY).toBe("env");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
