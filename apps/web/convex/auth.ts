import { betterAuth } from "better-auth/minimal";
import { convex } from "@convex-dev/better-auth/plugins";
import { createClient } from "@convex-dev/better-auth";

import type { DataModel } from "./_generated/dataModel";
import { components } from "./_generated/api";
import authConfig from "./auth.config";
import { hasAuthEnv, isAuthDisabled } from "./shared/env";

function requireAuthConfig(): { siteUrl: string; secret: string } {
  if (isAuthDisabled()) {
    return {
      siteUrl: String(process.env.SITE_URL || "http://localhost:3000").trim(),
      secret: String(process.env.BETTER_AUTH_SECRET || "clawlets-auth-disabled-dev-secret").trim(),
    };
  }
  if (!hasAuthEnv()) {
    throw new Error("missing SITE_URL / BETTER_AUTH_SECRET for Better Auth");
  }
  return {
    siteUrl: String(process.env.SITE_URL || "").trim(),
    secret: String(process.env.BETTER_AUTH_SECRET || "").trim(),
  };
}

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: Parameters<typeof authComponent.adapter>[0]) => {
  const { siteUrl, secret } = requireAuthConfig();
  return betterAuth({
    database: authComponent.adapter(ctx),
    baseURL: siteUrl,
    secret,
    emailAndPassword: { enabled: true },
    plugins: [convex({ authConfig, jwksRotateOnTokenGenerationError: true })],
  });
};
