import { defineCommand } from "citty";
import { runnerStart } from "./start.js";

export const runner = defineCommand({
  meta: {
    name: "runner",
    description: "Control-plane runner agent operations.",
  },
  subCommands: {
    start: runnerStart,
  },
});
