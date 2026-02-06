import { z } from "zod";
import { getPinnedOpenclawSchemaArtifact } from "../openclaw/schema/artifact.js";
import { OPENCLAW_DEFAULT_COMMANDS } from "../openclaw/openclaw-defaults.js";
import { validateOpenclawConfig } from "../openclaw/schema/validate.js";
import { formatPathLabel, isPlainObject, stripPathPrefix } from "./helpers.js";

type ConfigLike = {
  hosts?: Record<string, unknown>;
};

export function addOpenclawSchemaIssues(params: { config: ConfigLike; ctx: z.RefinementCtx }): void {
  const schema = getPinnedOpenclawSchemaArtifact().schema as Record<string, unknown>;
  for (const [hostName, hostCfg] of Object.entries(params.config.hosts || {})) {
    const gateways = (hostCfg as any)?.gateways;
    const gatewaysOrder = Array.isArray((hostCfg as any)?.gatewaysOrder)
      ? ((hostCfg as any).gatewaysOrder as string[])
      : [];
    const ids = gatewaysOrder.length > 0 ? gatewaysOrder : Object.keys(gateways || {});
    for (const gatewayId of ids) {
      const gatewayCfg = (gateways as any)?.[gatewayId];
      const openclaw = (gatewayCfg as any)?.openclaw;
      if (!isPlainObject(openclaw)) continue;

      // Legacy typed surfaces are rejected earlier; avoid spamming schema errors.
      const legacyKeys = ["channels", "agents", "hooks", "skills", "plugins"] as const;
      if (legacyKeys.some((key) => (openclaw as any)?.[key] !== undefined)) continue;

      const openclawForValidation = structuredClone(openclaw) as Record<string, unknown>;
      const commands = openclawForValidation["commands"];
      if (commands === undefined) {
        openclawForValidation["commands"] = OPENCLAW_DEFAULT_COMMANDS;
      } else if (isPlainObject(commands)) {
        openclawForValidation["commands"] = { ...OPENCLAW_DEFAULT_COMMANDS, ...commands };
      }

      const validation = validateOpenclawConfig(openclawForValidation, schema);
      if (validation.ok) continue;
      for (const issue of validation.issues) {
        const path = ["hosts", hostName, "gateways", gatewayId, "openclaw", ...issue.path];
        const message = `${formatPathLabel(path)}: ${stripPathPrefix(issue.message)}`;
        params.ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
      }
    }
  }
}
