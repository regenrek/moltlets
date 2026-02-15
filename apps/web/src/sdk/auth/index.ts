import { createServerFn } from "@tanstack/react-start";
import { api } from "../../../convex/_generated/api";
import { isAuthError } from "~/lib/auth-utils";
import { fetchAuthMutation, getToken } from "~/server/better-auth";
import { assertAuthEnv } from "~/server/env";

export const getAuthBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  assertAuthEnv();
  const token = await getToken();
  return { token: token ?? null };
});

const BOOTSTRAP_RETRY_DELAYS_MS = [50, 100, 200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const ensureCurrentAuthUserBootstrap = createServerFn({ method: "POST" }).handler(async () => {
  assertAuthEnv();
  const token = await getToken();
  if (!token) return { ensured: false };

  for (let attempt = 0; attempt <= BOOTSTRAP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fetchAuthMutation(api.identity.users.ensureCurrent, {});
      return { ensured: true };
    } catch (error) {
      if (!isAuthError(error) || attempt >= BOOTSTRAP_RETRY_DELAYS_MS.length) throw error;
      await sleep(BOOTSTRAP_RETRY_DELAYS_MS[attempt]!);
    }
  }

  return { ensured: false };
});
