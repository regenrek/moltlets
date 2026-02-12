import { createServerFn } from "@tanstack/react-start";
import { getToken } from "~/server/better-auth";
import { assertAuthEnv } from "~/server/env";
import { isAuthDisabled } from "~/lib/auth-mode";

export const getAuthBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  if (isAuthDisabled()) return { token: null };
  assertAuthEnv();
  const token = await getToken();
  return { token: token ?? null };
});
