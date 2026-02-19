import type { MaybePromise } from "./config-store.js";

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as { then?: unknown }).then === "function");
}

export function requireSyncResult<T>(
  value: MaybePromise<T>,
  field: string,
  context: string,
): T {
  if (isPromiseLike(value)) {
    throw new Error(`ConfigStore.${field} must be synchronous for ${context}`);
  }
  return value;
}
