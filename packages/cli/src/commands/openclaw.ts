import { defineCommand } from "citty";
import { openclawSchema } from "./openclaw/schema.js";
import { openclawHarden } from "./openclaw/harden.js";

export const openclaw = defineCommand({
  meta: { name: "openclaw", description: "OpenClaw gateway helpers." },
  subCommands: {
    harden: openclawHarden,
    schema: openclawSchema,
  },
});
