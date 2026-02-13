import { gateway } from "./openclaw/gateway.js";
import { bootstrap } from "./infra/bootstrap.js";
import { openclaw } from "./openclaw/index.js";
import { config } from "./config/index.js";
import { doctor } from "./doctor/index.js";
import { env } from "./infra/env.js";
import { host } from "./config/host.js";
import { fleet } from "./config/fleet.js";
import { image } from "./infra/image.js";
import { infra } from "./infra/index.js";
import { lockdown } from "./infra/lockdown.js";
import { git } from "./git/index.js";
import { plugin } from "./platform/plugin.js";
import { project } from "./platform/project.js";
import { release } from "./release/index.js";
import { secrets } from "./secrets/index.js";
import { server } from "./openclaw/server/index.js";
import { runner } from "./runner/index.js";
import { setup } from "./setup/index.js";
import { quickstart } from "./quickstart/index.js";

export const baseCommands = {
  gateway,
  bootstrap,
  openclaw,
  config,
  doctor,
  env,
  host,
  fleet,
  image,
  infra,
  lockdown,
  git,
  plugin,
  project,
  release,
  secrets,
  server,
  runner,
  setup,
  quickstart,
};

export const baseCommandNames = Object.freeze(Object.keys(baseCommands));
