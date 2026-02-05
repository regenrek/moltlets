import { defineCommand } from "citty";
import { secretsInit } from "./init.js";
import { secretsPath } from "./path.js";
import { secretsSync } from "./sync.js";
import { secretsVerify } from "./verify.js";

export const secrets = defineCommand({
  meta: {
    name: "secrets",
    description: "Secrets workflow (/secrets + extra-files + sync).",
  },
  subCommands: {
    init: secretsInit,
    verify: secretsVerify,
    sync: secretsSync,
    path: secretsPath,
  },
});
