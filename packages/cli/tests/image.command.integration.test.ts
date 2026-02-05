import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi, beforeEach } from "vitest";

const loadHostContextMock = vi.fn();
const resolveGitRevMock = vi.fn();
const captureMock = vi.fn();
const runMock = vi.fn();
const loadDeployCredsMock = vi.fn();

vi.mock("@clawlets/core/lib/context", () => ({
  loadHostContextOrExit: loadHostContextMock,
}));

vi.mock("@clawlets/core/lib/git", () => ({
  resolveGitRev: resolveGitRevMock,
}));

vi.mock("@clawlets/core/lib/run", () => ({
  capture: captureMock,
  run: runMock,
}));

vi.mock("@clawlets/core/lib/deploy-creds", () => ({
  loadDeployCreds: loadDeployCredsMock,
}));

describe("image command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("image build errors on non-linux", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    loadHostContextMock.mockReturnValue({
      repoRoot: "/repo",
      layout: { runtimeDir: "/repo/.clawlets" },
      hostName: "alpha",
    });
    resolveGitRevMock.mockResolvedValue("deadbeef");
    const { image } = await import("../src/commands/infra/image.js");
    await expect(image.subCommands?.build?.run?.({ args: { host: "alpha", dryRun: true } } as any)).rejects.toThrow(/requires Linux/i);
    platformSpy.mockRestore();
  });

  it("image upload runs hcloud-upload-image", async () => {
    loadHostContextMock.mockReturnValue({
      hostName: "alpha",
      hostCfg: { provisioning: { provider: "hetzner" }, hetzner: { location: "nbg1" } },
    });
    loadDeployCredsMock.mockReturnValue({
      values: { HCLOUD_TOKEN: "token" },
    });
    const { image } = await import("../src/commands/infra/image.js");
    await image.subCommands?.upload?.run?.({
      args: {
        host: "alpha",
        "image-url": "https://example.com/image.raw",
        compression: "none",
        architecture: "x86",
        dryRun: true,
      },
    } as any);
    expect(runMock).toHaveBeenCalledWith(
      "hcloud-upload-image",
      expect.arrayContaining(["upload", "--image-url", "https://example.com/image.raw"]),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("image aws upload runs aws s3 cp", async () => {
    const imagePath = path.join(fs.mkdtempSync(path.join(tmpdir(), "clawlets-image-aws-")), "host.raw");
    fs.writeFileSync(imagePath, "raw", "utf8");
    loadHostContextMock.mockReturnValue({
      hostName: "alpha",
      hostCfg: {
        provisioning: { provider: "aws" },
        aws: { region: "us-east-1" },
      },
    });
    loadDeployCredsMock.mockReturnValue({
      envFromFile: {},
      values: {},
    });
    const { image } = await import("../src/commands/infra/image.js");
    await image.subCommands?.aws?.subCommands?.upload?.run?.({
      args: {
        host: "alpha",
        "image-path": imagePath,
        bucket: "clawlets-images",
        dryRun: true,
      },
    } as any);
    expect(runMock).toHaveBeenCalledWith(
      "aws",
      ["s3", "cp", imagePath, "s3://clawlets-images/images/alpha/host.raw"],
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("image aws import dry-run prints import command", async () => {
    loadHostContextMock.mockReturnValue({
      hostName: "alpha",
      hostCfg: {
        provisioning: { provider: "aws" },
        aws: { region: "us-east-1" },
      },
    });
    loadDeployCredsMock.mockReturnValue({
      envFromFile: {},
      values: {},
    });
    const { image } = await import("../src/commands/infra/image.js");
    await image.subCommands?.aws?.subCommands?.import?.run?.({
      args: {
        host: "alpha",
        bucket: "clawlets-images",
        key: "images/alpha/host.raw",
        dryRun: true,
      },
    } as any);
    expect(runMock).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining(["ec2", "import-image", "--disk-containers"]),
      expect.objectContaining({ dryRun: true }),
    );
  });
});
