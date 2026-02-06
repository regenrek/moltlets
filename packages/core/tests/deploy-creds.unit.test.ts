import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, chmod, lstat, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEPLOY_CREDS_KEYS,
  DEPLOY_CREDS_SECRET_KEYS,
  isDeployCredsSecretKey,
  loadDeployCreds,
  renderDeployCredsEnvTemplate,
  updateDeployCredsEnvFile,
  validateDeployCredsEnvFileSecurity,
} from "../src/lib/infra/deploy-creds";

const ENV_KEYS = DEPLOY_CREDS_KEYS;

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
  it("derives secret metadata from key specs", () => {
    expect(DEPLOY_CREDS_SECRET_KEYS).toEqual(
      expect.arrayContaining([
        "HCLOUD_TOKEN",
        "GITHUB_TOKEN",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
      ]),
    );
    expect(DEPLOY_CREDS_SECRET_KEYS).not.toContain("NIX_BIN");
    expect(DEPLOY_CREDS_SECRET_KEYS).not.toContain("SOPS_AGE_KEY_FILE");
    expect(isDeployCredsSecretKey("AWS_SECRET_ACCESS_KEY")).toBe(true);
    expect(isDeployCredsSecretKey("NIX_BIN")).toBe(false);
  });

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

  it("rejects symlink env file", async () => {
    const { dir } = await setupRepo();
    try {
      await mkdir(path.join(dir, ".clawlets"), { recursive: true });
      const targetPath = path.join(dir, ".clawlets", "env.real");
      await writeFile(targetPath, "HCLOUD_TOKEN=token\n", "utf8");
      await chmod(targetPath, 0o600);
      await symlink(targetPath, path.join(dir, ".clawlets", "env"));

      const loaded = loadDeployCreds({ cwd: dir });
      expect(loaded.envFile?.status).toBe("invalid");
      expect(loaded.envFile?.error).toContain("symlink");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("security validator rejects non-file env path", async () => {
    const { dir } = await setupRepo();
    try {
      const envPath = path.join(dir, ".clawlets", "env");
      await mkdir(envPath, { recursive: true });
      const check = validateDeployCredsEnvFileSecurity(envPath);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toContain("not a regular file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("security validator rejects wrong owner", async () => {
    const { dir } = await setupRepo();
    try {
      const envPath = path.join(dir, ".clawlets", "env");
      await mkdir(path.dirname(envPath), { recursive: true });
      await writeFile(envPath, "HCLOUD_TOKEN=token\n", "utf8");
      await chmod(envPath, 0o600);
      const st = await lstat(envPath);

      const check = validateDeployCredsEnvFileSecurity(envPath, { expectedUid: st.uid + 1 });
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toContain("wrong owner");
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

  it("atomic update writes secure env file and keeps canonical keys", async () => {
    const { dir } = await setupRepo();
    try {
      const updated = await updateDeployCredsEnvFile({
        repoRoot: dir,
        updates: { HCLOUD_TOKEN: " token ", NIX_BIN: "" },
      });
      expect(updated.envPath).toBe(path.join(dir, ".clawlets", "env"));
      expect(updated.updatedKeys).toEqual(["HCLOUD_TOKEN", "NIX_BIN"]);

      const st = await lstat(updated.envPath);
      expect(st.isFile()).toBe(true);
      expect(st.mode & 0o777).toBe(0o600);

      const text = await readFile(updated.envPath, "utf8");
      for (const key of ENV_KEYS) expect(text).toContain(`${key}=`);
      expect(text).toContain("HCLOUD_TOKEN=token");
      expect(text).toContain("NIX_BIN=nix");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("template includes canonical key set", async () => {
    const { dir } = await setupRepo();
    try {
      const defaultEnvPath = path.join(dir, ".clawlets", "env");
      const template = renderDeployCredsEnvTemplate({ defaultEnvPath, cwd: dir });
      const rel = path.relative(dir, defaultEnvPath) || defaultEnvPath;
      expect(template).toContain(`# Default path: ${rel}`);
      for (const key of ENV_KEYS) expect(template).toContain(`${key}=`);
      expect(template).toContain("NIX_BIN=nix");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
