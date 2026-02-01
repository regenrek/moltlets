import * as p from "@clack/prompts";

export const NAV_BACK = Symbol("clawlets.nav.back");
export const NAV_EXIT = Symbol("clawlets.nav.exit");
export type Nav = typeof NAV_BACK | typeof NAV_EXIT;

export function isNav(v: unknown): v is Nav {
  return v === NAV_BACK || v === NAV_EXIT;
}

export async function navOnCancel(params: { flow: string; canBack: boolean }): Promise<Nav> {
  const flow = params.flow.trim() || "setup";
  const options: Array<{ value: "back" | "exit"; label: string }> = [];
  if (params.canBack) options.push({ value: "back", label: "Back" });
  options.push({ value: "exit", label: `Exit ${flow}` });

  const choice = await p.select({
    message: "Canceled. Next?",
    initialValue: params.canBack ? "back" : "exit",
    options,
  });

  if (p.isCancel(choice) || choice === "exit") return NAV_EXIT;
  return NAV_BACK;
}

export function cancelFlow(): void {
  p.cancel("canceled");
}

