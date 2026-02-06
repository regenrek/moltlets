import { capture, captureWithInput, run, type RunOpts } from "../runtime/index.js";
import { withFlakesEnv } from "./nix-flakes.js";

export type NixToolOpts = {
  nixBin: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  redact?: string[];
};

export async function nixRunCapture(
  pkg: string,
  args: string[],
  opts: NixToolOpts,
): Promise<string> {
  const nixArgs = ["run", "--impure", `nixpkgs#${pkg}`, "--", ...args];
  return await capture(opts.nixBin, nixArgs, { ...opts, env: withFlakesEnv(opts.env) });
}

export async function nixRun(
  pkg: string,
  args: string[],
  opts: NixToolOpts,
): Promise<void> {
  const nixArgs = ["run", "--impure", `nixpkgs#${pkg}`, "--", ...args];
  const runOpts: RunOpts = { ...opts, env: withFlakesEnv(opts.env) };
  await run(opts.nixBin, nixArgs, runOpts);
}

export async function nixShellCapture(
  pkg: string,
  cmd: string,
  args: string[],
  opts: NixToolOpts,
): Promise<string> {
  const nixArgs = ["shell", `nixpkgs#${pkg}`, "-c", cmd, ...args];
  return await capture(opts.nixBin, nixArgs, { ...opts, env: withFlakesEnv(opts.env) });
}

export async function nixShellCaptureWithInput(
  pkg: string,
  cmd: string,
  args: string[],
  input: string,
  opts: NixToolOpts,
): Promise<string> {
  const nixArgs = ["shell", `nixpkgs#${pkg}`, "-c", cmd, ...args];
  return await captureWithInput(opts.nixBin, nixArgs, input, { ...opts, env: withFlakesEnv(opts.env) });
}
