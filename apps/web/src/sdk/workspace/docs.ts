import { createServerFn } from "@tanstack/react-start"
import type {
  WorkspaceDocReadResult,
  WorkspaceDocScope,
  WorkspaceDocWriteResult,
  WorkspaceDocWriteScope,
} from "./model"
import { coerceString, parseProjectIdInput } from "~/sdk/runtime"
import {
  listWorkspaceDocsServer,
  readWorkspaceDocServer,
  resetWorkspaceDocOverrideServer,
  writeWorkspaceDocServer,
} from "~/server/workspace-docs.server"

export const listWorkspaceDocs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      gatewayId: coerceString(d["gatewayId"]),
    }
  })
  .handler(async ({ data }) => {
    return await listWorkspaceDocsServer(data)
  })

export const readWorkspaceDoc = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const scope = coerceString(d["scope"])
    if (scope !== "common" && scope !== "gateway" && scope !== "effective") throw new Error("invalid scope")
    return {
      ...base,
      gatewayId: typeof d["gatewayId"] === "string" ? d["gatewayId"] : "",
      scope: scope as WorkspaceDocScope,
      name: coerceString(d["name"]),
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocReadResult> => {
    return await readWorkspaceDocServer(data)
  })

export const writeWorkspaceDoc = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    const scope = coerceString(d["scope"])
    if (scope !== "common" && scope !== "gateway") throw new Error("invalid scope")
    return {
      ...base,
      gatewayId: typeof d["gatewayId"] === "string" ? d["gatewayId"] : "",
      scope: scope as WorkspaceDocWriteScope,
      name: coerceString(d["name"]),
      content: typeof d["content"] === "string" ? d["content"] : "",
      expectedSha256: typeof d["expectedSha256"] === "string" ? d["expectedSha256"] : "",
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocWriteResult> => {
    return await writeWorkspaceDocServer(data)
  })

export const resetWorkspaceDocOverride = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const base = parseProjectIdInput(data)
    const d = data as Record<string, unknown>
    return {
      ...base,
      gatewayId: coerceString(d["gatewayId"]),
      name: coerceString(d["name"]),
      expectedSha256: typeof d["expectedSha256"] === "string" ? d["expectedSha256"] : "",
    }
  })
  .handler(async ({ data }): Promise<WorkspaceDocWriteResult> => {
    return await resetWorkspaceDocOverrideServer(data)
  })
