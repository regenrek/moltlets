#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { bot } from "./commands/bot.js";
import { bootstrap } from "./commands/bootstrap.js";
import { config } from "./commands/config.js";
import { cattle } from "./commands/cattle.js";
import { doctor } from "./commands/doctor.js";
import { env } from "./commands/env.js";
import { host } from "./commands/host.js";
import { fleet } from "./commands/fleet.js";
import { image } from "./commands/image.js";
import { infra } from "./commands/infra.js";
import { lockdown } from "./commands/lockdown.js";
import { project } from "./commands/project.js";
import { secrets } from "./commands/secrets.js";
import { server } from "./commands/server.js";
import { readCliVersion } from "./lib/version.js";

const main = defineCommand({
  meta: {
    name: "clawdlets",
    description: "Clawdbot fleet helper (CLI-first; runtime state in .clawdlets/; secrets in /secrets).",
  },
  subCommands: {
    bot,
    bootstrap,
    cattle,
    config,
    doctor,
    env,
    host,
    fleet,
    image,
    infra,
    lockdown,
    project,
    secrets,
    server,
  },
});

{
  const [nodeBin, script, ...rest] = process.argv;
  const normalized = rest.filter((a) => a !== "--");
  if (normalized.includes("--version") || normalized.includes("-v")) {
    console.log(readCliVersion());
    process.exit(0);
  }
  process.argv = [nodeBin!, script!, ...normalized];
}

runMain(main);
