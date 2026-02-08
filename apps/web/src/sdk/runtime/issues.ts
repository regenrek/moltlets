import { coerceString } from "./strings"

export type ValidationIssue = { code: string; path: Array<string | number>; message: string }

export function mapValidationIssues(issues: unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    const i = issue as { code?: unknown; path?: unknown; message?: unknown }
    return {
      code: coerceString(i.code) || "invalid",
      path: Array.isArray(i.path) ? (i.path as Array<string | number>) : [],
      message: coerceString(i.message) || "Invalid",
    }
  })
}
