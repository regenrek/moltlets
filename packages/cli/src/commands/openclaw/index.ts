import { defineCommand } from "citty";
import { openclawSchema } from "./schema.js";
import { openclawHarden } from "./harden.js";

export const openclaw = defineCommand({
  meta: { name: "openclaw", description: "OpenClaw gateway helpers." },
  subCommands: {
    harden: openclawHarden,
    schema: openclawSchema,
  },
});
