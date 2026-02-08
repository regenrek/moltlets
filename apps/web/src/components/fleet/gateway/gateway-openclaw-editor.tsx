import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { Id } from "../../../../convex/_generated/dataModel"
import type { OpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import { getPinnedOpenclawSchemaArtifact } from "@clawlets/core/lib/openclaw/schema/artifact"
import type { lintOpenclawSecurityConfig } from "@clawlets/core/lib/openclaw/security-lint"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { MonacoJsonEditor, type JsonEditorDiagnostic } from "~/components/editor/monaco-json-editor"
import { hardenGatewayOpenclawConfig, setGatewayOpenclawConfig, verifyGatewayOpenclawSchema } from "~/sdk/openclaw"
import { getOpenclawSchemaLive, getOpenclawSchemaStatus, type OpenclawSchemaLiveResult } from "~/sdk/openclaw"
import { createOpenclawParseScheduler, parseOpenclawConfigText } from "~/lib/openclaw-parse"
import { GatewayOpenclawDiagnostics, InlineSecretWarnings } from "~/components/fleet/gateway/gateway-openclaw-editor-panels"

export function shouldDisableSave(params: {
  canEdit: boolean
  saving: boolean
  parsedOk: boolean
  hasSchemaErrors: boolean
}): boolean {
  return !params.canEdit || params.saving || !params.parsedOk || params.hasSchemaErrors
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toPathIssues(issues: unknown): Array<{ path: string; message: string }> {
  if (!Array.isArray(issues)) return []
  return issues
    .map((issue) => {
      const record = asRecord(issue)
      const pathValue = Array.isArray(record?.path) ? record.path.map(String).join(".") : ""
      const message = typeof record?.message === "string" ? record.message : "Validation failed"
      return { path: pathValue || "(root)", message }
    })
}

export function relaxOpenclawSchemaForPassthrough(schema: Record<string, unknown>): Record<string, unknown> {
  const required = schema.required
  if (!Array.isArray(required)) return schema
  const next = required.filter((entry) => entry !== "commands")
  if (next.length === required.length) return schema
  return { ...schema, required: next }
}

export function GatewayOpenclawEditor(props: {
  projectId: string
  gatewayId: string
  host: string
  initial: unknown
  canEdit: boolean
  configQueryKey?: readonly unknown[]
  metadataQueryKey?: readonly unknown[]
}) {
  const queryClient = useQueryClient()

  const refreshQueries = () => {
    if (props.configQueryKey) {
      void queryClient.invalidateQueries({ queryKey: props.configQueryKey })
    }
    if (props.metadataQueryKey) {
      void queryClient.invalidateQueries({ queryKey: props.metadataQueryKey })
    }
  }

  const initialText = useMemo(() => JSON.stringify(props.initial ?? {}, null, 2), [props.initial])
  const [text, setText] = useState(initialText)
  const [parsed, setParsed] = useState(() => parseOpenclawConfigText(initialText))
  const [serverIssues, setServerIssues] = useState<null | Array<{ path: string; message: string }>>(null)
  const [schemaIssues, setSchemaIssues] = useState<JsonEditorDiagnostic[]>([])
  const [securityReport, setSecurityReport] = useState<ReturnType<typeof lintOpenclawSecurityConfig> | null>(null)
  const pinnedSchema = useMemo(() => getPinnedOpenclawSchemaArtifact(), [])
  const [schemaMode, setSchemaMode] = useState<"pinned" | "live">("pinned")
  const [liveSchema, setLiveSchema] = useState<OpenclawSchemaArtifact | null>(null)
  const [schemaError, setSchemaError] = useState("")
  const [liveIssues, setLiveIssues] = useState<Array<{ path: string; message: string }> | null>(null)
  const [schemaDiff, setSchemaDiff] = useState<null | { added: string[]; removed: string[]; changed: Array<{ path: string; oldType: string; newType: string }> }>(null)
  const [liveVerifyError, setLiveVerifyError] = useState("")
  const parseRunnerRef = useRef<ReturnType<typeof createOpenclawParseScheduler> | null>(null)
  const textRef = useRef(text)
  const gatewayIdRef = useRef(props.gatewayId)

  const schemaStatus = useQuery({
    queryKey: ["openclawSchemaStatus", props.projectId],
    queryFn: async () =>
      await getOpenclawSchemaStatus({
        data: { projectId: props.projectId as Id<"projects"> },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    setText(initialText)
    setParsed(parseOpenclawConfigText(initialText))
    setServerIssues(null)
    setSchemaIssues([])
    setSecurityReport(null)
    setSchemaMode("pinned")
    setLiveSchema(null)
    setSchemaError("")
    setLiveIssues(null)
    setSchemaDiff(null)
    setLiveVerifyError("")
  }, [initialText, props.gatewayId])

  useEffect(() => {
    textRef.current = text
    gatewayIdRef.current = props.gatewayId
  }, [text, props.gatewayId])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!parseRunnerRef.current) {
      parseRunnerRef.current = createOpenclawParseScheduler({
        getText: () => textRef.current,
        getGatewayId: () => gatewayIdRef.current,
        onParsed: setParsed,
        onSecurity: setSecurityReport,
        delayMs: 400,
        timeoutMs: 1500,
      })
    }
    parseRunnerRef.current.schedule()
    return () => parseRunnerRef.current?.cancel()
  }, [text, props.gatewayId])

  const save = useMutation({
    mutationFn: async () => {
      setServerIssues(null)
      const parsedNow = parseOpenclawConfigText(text)
      if (!parsedNow.ok) throw new Error(parsedNow.message)
      return await setGatewayOpenclawConfig({
        data: {
          projectId: props.projectId as Id<"projects">,
          gatewayId: props.gatewayId,
          openclaw: parsedNow.value,
          schemaMode,
          host: props.host,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved OpenClaw config")
        refreshQueries()
      } else {
        setServerIssues(toPathIssues(res.issues))
        toast.error("Validation failed")
      }
    },
  })

  const harden = useMutation({
    mutationFn: async () => {
      setServerIssues(null)
      return await hardenGatewayOpenclawConfig({
        data: {
          projectId: props.projectId as Id<"projects">,
          gatewayId: props.gatewayId,
          host: props.host,
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        const result = asRecord(res)
        const changes = Array.isArray(result?.changes) ? result.changes : []
        toast.success(changes.length > 0 ? "Applied security defaults" : "Already hardened")
        refreshQueries()
        return
      }
      setServerIssues(toPathIssues(res.issues))
      toast.error("Hardening failed")
    },
    onError: (err) => toast.error(String(err)),
  })

  const liveSchemaFetch = useMutation<OpenclawSchemaLiveResult>({
    mutationFn: async () =>
      (await getOpenclawSchemaLive({
        data: {
          projectId: props.projectId as Id<"projects">,
          host: props.host,
          gatewayId: props.gatewayId,
        },
      })) as OpenclawSchemaLiveResult,
    onSuccess: (res) => {
      if (!res.ok) {
        setSchemaError(res.message || "Failed to fetch live schema")
        setSchemaMode("pinned")
        return
      }
      setLiveSchema(res.schema)
      setSchemaMode("live")
      setSchemaError("")
    },
    onError: (err) => {
      setSchemaError(String(err))
      setSchemaMode("pinned")
    },
  })

  const liveVerify = useMutation({
    mutationFn: async () =>
      await verifyGatewayOpenclawSchema({
        data: {
          projectId: props.projectId as Id<"projects">,
          host: props.host,
          gatewayId: props.gatewayId,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        const msg = res.issues?.[0]?.message || "Verification failed"
        setLiveVerifyError(msg)
        setLiveIssues(null)
        setSchemaDiff(null)
        return
      }
      setLiveVerifyError("")
      setLiveIssues(toPathIssues(res.issues))
      setSchemaDiff(res.schemaDiff || null)
    },
    onError: (err) => {
      setLiveVerifyError(String(err))
      setLiveIssues(null)
      setSchemaDiff(null)
    },
  })

  const format = () => {
    try {
      const value = JSON.parse(text)
      setText(`${JSON.stringify(value, null, 2)}\n`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON")
    }
  }

  const pinnedVersion = pinnedSchema?.version || "unknown"
  const liveVersion = liveSchema?.version || "unknown"
  const hasSchemaMismatch = Boolean(liveSchema && pinnedSchema?.version && liveSchema.version !== pinnedSchema.version)
  const hasHost = Boolean(props.host.trim())
  const canUseLive = Boolean(props.canEdit && hasHost)
  const activeSchema = schemaMode === "live" && liveSchema ? liveSchema : pinnedSchema
  const schemaDiagnostics = schemaIssues
  const hasSchemaErrors = schemaDiagnostics.some((issue) => issue.severity === "error")
  const pinnedNixOpenclawRev = schemaStatus.data && schemaStatus.data.ok ? schemaStatus.data.pinned?.openclawRev : null
  const upstreamOpenclawRev = schemaStatus.data && schemaStatus.data.ok ? schemaStatus.data.upstream?.openclawRev : null
  const pinnedSchemaRev = pinnedSchema?.openclawRev || ""
  const pinnedVsNixOpenclawMismatch = Boolean(pinnedNixOpenclawRev && pinnedSchemaRev && pinnedNixOpenclawRev !== pinnedSchemaRev)
  const pinnedVsUpstreamMismatch = Boolean(upstreamOpenclawRev && pinnedSchemaRev && upstreamOpenclawRev !== pinnedSchemaRev)
  const inlineSecretFindings = securityReport?.findings?.filter((f) => f.id.startsWith("inlineSecret.")) ?? []
  const hasInlineSecrets = inlineSecretFindings.length > 0
  const editorSchema = useMemo(() => relaxOpenclawSchemaForPassthrough(activeSchema.schema), [activeSchema.schema])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-medium">OpenClaw config (JSON)</div>
          <div className="text-xs text-muted-foreground">
            Stored as <code>hosts.{props.host}.gateways.{props.gatewayId}.openclaw</code>.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={format}>
            Format
          </Button>
          <Button type="button" variant="outline" disabled={!props.canEdit || harden.isPending} onClick={() => harden.mutate()}>
            Harden
          </Button>
          <Button
            type="button"
            disabled={shouldDisableSave({
              canEdit: props.canEdit,
              saving: save.isPending,
              parsedOk: parsed.ok,
              hasSchemaErrors,
            }) || hasInlineSecrets}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </div>
      </div>

      {hasInlineSecrets ? <InlineSecretWarnings findings={inlineSecretFindings} /> : null}

      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium">Schema source</div>
            <div className="text-xs text-muted-foreground">
              Pinned v{pinnedVersion}
              {pinnedSchema?.generatedAt ? ` · ${pinnedSchema.generatedAt}` : ""}
              {liveSchema ? ` · Live v${liveVersion}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Use live schema (advanced)</span>
              <Switch
                size="sm"
                checked={schemaMode === "live"}
                disabled={!canUseLive || liveSchemaFetch.isPending}
                onCheckedChange={(checked) => {
                  if (!checked) {
                    setSchemaMode("pinned")
                    return
                  }
                  if (!canUseLive) return
                  if (liveSchema) {
                    setSchemaMode("live")
                    return
                  }
                  liveSchemaFetch.mutate()
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canUseLive || liveVerify.isPending}
              onClick={() => liveVerify.mutate()}
            >
              Verify vs live schema
            </Button>
          </div>
        </div>
        {!canUseLive ? (
          <div className="text-xs text-muted-foreground">
            {!props.canEdit ? (
              <>Live schema requires admin access.</>
            ) : (
              <>
                Live schema requires a reachable host (set <code>defaultHost</code> in fleet config).
              </>
            )}
          </div>
        ) : null}
        {hasSchemaMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema version differs from live. Pinned v{pinnedVersion} · Live v{liveVersion}
          </div>
        ) : null}
        {pinnedVsNixOpenclawMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema rev differs from nix-openclaw pinned rev. Schema {pinnedSchemaRev.slice(0, 12)}… ·
            nix-openclaw {pinnedNixOpenclawRev?.slice(0, 12)}…
          </div>
        ) : null}
        {pinnedVsUpstreamMismatch ? (
          <div className="text-xs text-amber-700">
            Pinned schema rev behind upstream nix-openclaw. Schema {pinnedSchemaRev.slice(0, 12)}… · upstream{" "}
            {upstreamOpenclawRev?.slice(0, 12)}…
          </div>
        ) : null}
        {schemaStatus.data && schemaStatus.data.ok && schemaStatus.data.warnings && schemaStatus.data.warnings.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            {schemaStatus.data.warnings.slice(0, 2).map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        ) : null}
        {schemaStatus.data && !schemaStatus.data.ok ? (
          <div className="text-xs text-destructive">{schemaStatus.data.message}</div>
        ) : null}
        {schemaError ? <div className="text-xs text-destructive">{schemaError}</div> : null}
        {liveVerifyError ? <div className="text-xs text-destructive">{liveVerifyError}</div> : null}
      </div>

      <div className="rounded-md border bg-background/50 p-2">
        <div className="h-[360px]">
          <MonacoJsonEditor
            value={text}
            onChange={setText}
            schema={editorSchema}
            schemaId={`${schemaMode}-passthrough-${activeSchema.version}-${activeSchema.openclawRev}`}
            readOnly={!props.canEdit}
            onDiagnostics={setSchemaIssues}
          />
        </div>
      </div>

      <GatewayOpenclawDiagnostics
        parsedError={parsed.ok ? null : parsed.message}
        schemaDiagnostics={schemaDiagnostics}
        schemaDiff={schemaDiff}
        liveIssues={liveIssues}
        securityReport={securityReport}
        serverIssues={serverIssues}
      />
    </div>
  )
}
