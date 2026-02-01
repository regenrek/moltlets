export function linuxBuildRequiredError(params: { command: string }): Error {
  const cmd = params.command.trim() || "this command";
  return new Error(
    [
      `${cmd}: local NixOS builds require Linux.`,
      "Use one of:",
      "- CI: build systems + publish signed desired-state manifests, then let hosts pull (or trigger with: clawlets server update apply)",
      "- Linux builder: build on Linux, publish manifests + pointer, then apply updates",
    ].join("\n"),
  );
}

export function requireLinuxForLocalNixosBuild(params: { platform: string; command: string }): void {
  if (params.platform === "linux") return;
  throw linuxBuildRequiredError({ command: params.command });
}
