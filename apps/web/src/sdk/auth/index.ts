import { createServerFn } from "@tanstack/react-start";
import { getToken } from "~/server/better-auth";
import { assertAuthEnv } from "~/server/env";

export const getAuthBootstrap = createServerFn({ method: "GET" }).handler(async () => {
  assertAuthEnv();
  const token = await getToken();
  return { token: token ?? null };
});
