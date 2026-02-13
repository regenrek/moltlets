import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { Switch } from "~/components/ui/switch"
import { configDotBatch } from "~/sdk/config"
import {
  buildBuiltinMemoryOps,
  buildOpenclawMemoryConfig,
  readGatewayMemoryState,
  setGatewayOpenclawConfig,
  type OpenclawMemoryBackend,
} from "~/sdk/openclaw"

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function parseScore(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0 || parsed > 1) return null
  return parsed
}

function formatIssues(issues: unknown): string {
  if (!Array.isArray(issues) || issues.length === 0) return "Configuration write failed."
  return issues
    .map((issue) => {
      const row = asRecord(issue)
      const message = typeof row?.message === "string" ? row.message : "invalid"
      const path = Array.isArray(row?.path) ? row.path.map((part) => String(part)).join(".") : ""
      return path ? `${path}: ${message}` : message
    })
    .join("; ")
}

function listGatewayIds(hostCfg: Record<string, unknown>): string[] {
  const gateways = asRecord(hostCfg.gateways) ?? {}
  const order = Array.isArray(hostCfg.gatewaysOrder)
    ? hostCfg.gatewaysOrder
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
    : []
  if (order.length > 0) return order
  return Object.keys(gateways)
}

type OpenClawSetupMemoryConfig = {
  hosts: Record<string, Record<string, unknown>>
}

export function OpenClawSetupStepMemory(props: {
  projectId: Id<"projects">
  host: string
  config: OpenClawSetupMemoryConfig | null
  isComplete: boolean
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const hostCfg = asRecord(props.config?.hosts?.[props.host]) ?? {}
  const gateways = asRecord(hostCfg.gateways) ?? {}
  const gatewayIds = listGatewayIds(hostCfg)
  const firstGateway = gatewayIds.length > 0 ? asRecord(gateways[gatewayIds[0] || ""]) ?? {} : {}
  const initialMemory = readGatewayMemoryState({
    openclaw: firstGateway.openclaw,
    agents: firstGateway.agents,
  })

  const [backend, setBackend] = useState<OpenclawMemoryBackend>(initialMemory.backend)
  const [builtinEnabled, setBuiltinEnabled] = useState(initialMemory.builtin.enabled)
  const [builtinSessionMemory, setBuiltinSessionMemory] = useState(initialMemory.builtin.sessionMemory)
  const [builtinMaxResultsText, setBuiltinMaxResultsText] = useState(String(initialMemory.builtin.maxResults))
  const [builtinMinScoreText, setBuiltinMinScoreText] = useState(String(initialMemory.builtin.minScore))
  const [qmdCommand, setQmdCommand] = useState(initialMemory.qmd.command)
  const [qmdSessionsEnabled, setQmdSessionsEnabled] = useState(initialMemory.qmd.sessionsEnabled)
  const [qmdMaxResultsText, setQmdMaxResultsText] = useState(String(initialMemory.qmd.maxResults))

  const saveMemory = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      if (gatewayIds.length === 0) throw new Error("add a gateway first")
      const builtinMaxResults = parsePositiveInt(builtinMaxResultsText)
      if (builtinMaxResults == null) throw new Error("builtin max results must be a positive integer")
      const builtinMinScore = parseScore(builtinMinScoreText)
      if (builtinMinScore == null) throw new Error("builtin min score must be a number between 0 and 1")
      const qmdMaxResults = parsePositiveInt(qmdMaxResultsText)
      if (qmdMaxResults == null) throw new Error("qmd max results must be a positive integer")

      const builtinOps = gatewayIds.flatMap((gatewayId) =>
        buildBuiltinMemoryOps({
          host: props.host,
          gatewayId,
          settings: {
            enabled: builtinEnabled,
            sessionMemory: builtinSessionMemory,
            maxResults: builtinMaxResults,
            minScore: builtinMinScore,
          },
        }),
      )
      const batchResult = await configDotBatch({
        data: {
          projectId: props.projectId,
          ops: builtinOps,
        },
      })
      if (!batchResult.ok) throw new Error(formatIssues(batchResult.issues))

      for (const gatewayId of gatewayIds) {
        const gateway = asRecord(gateways[gatewayId]) ?? {}
        const nextOpenclaw = buildOpenclawMemoryConfig({
          openclaw: gateway.openclaw,
          backend,
          qmd: {
            command: qmdCommand,
            sessionsEnabled: qmdSessionsEnabled,
            maxResults: qmdMaxResults,
          },
        })
        const writeResult = await setGatewayOpenclawConfig({
          data: {
            projectId: props.projectId,
            host: props.host,
            gatewayId,
            schemaMode: "pinned",
            openclaw: nextOpenclaw,
          },
        })
        if (!writeResult.ok) throw new Error(formatIssues(writeResult.issues))
      }
    },
    onSuccess: async () => {
      toast.success("Memory setup saved")
      await queryClient.invalidateQueries({ queryKey: ["openclawSetupConfig", props.projectId, props.host] })
      props.onContinue()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-4">
      {gatewayIds.length > 0 ? (
        <div className="text-sm text-muted-foreground">
          Choose a default memory backend for {gatewayIds.length} gateway{gatewayIds.length === 1 ? "" : "s"}.
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Add at least one gateway before configuring memory.</div>
      )}

      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
        <div className="text-sm font-medium">Backend</div>
        <RadioGroup
          value={backend}
          onValueChange={(value) => {
            if (value === "builtin" || value === "qmd") setBackend(value)
          }}
          className="grid gap-2 md:grid-cols-2"
        >
          <label className="flex items-start gap-2 rounded-md border bg-card p-3">
            <RadioGroupItem value="builtin" id="openclaw-memory-backend-builtin" />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Builtin</span>
              <span className="block text-xs text-muted-foreground">OpenClaw embedding index and memorySearch.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border bg-card p-3">
            <RadioGroupItem value="qmd" id="openclaw-memory-backend-qmd" />
            <span className="space-y-1">
              <span className="block text-sm font-medium">QMD</span>
              <span className="block text-xs text-muted-foreground">QMD sidecar recall backend.</span>
            </span>
          </label>
        </RadioGroup>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="text-sm font-medium">Builtin settings</div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Enable memorySearch</div>
            <Switch checked={builtinEnabled} onCheckedChange={setBuiltinEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Session transcript indexing</div>
            <Switch checked={builtinSessionMemory} onCheckedChange={setBuiltinSessionMemory} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Max results</div>
            <Input value={builtinMaxResultsText} inputMode="numeric" onChange={(event) => setBuiltinMaxResultsText(event.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Min score (0-1)</div>
            <Input value={builtinMinScoreText} onChange={(event) => setBuiltinMinScoreText(event.target.value)} />
          </div>
        </div>

        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="text-sm font-medium">QMD settings</div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Command</div>
            <Input value={qmdCommand} placeholder="qmd" onChange={(event) => setQmdCommand(event.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Session indexing</div>
            <Switch checked={qmdSessionsEnabled} onCheckedChange={setQmdSessionsEnabled} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Max results</div>
            <Input value={qmdMaxResultsText} inputMode="numeric" onChange={(event) => setQmdMaxResultsText(event.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AsyncButton
          type="button"
          disabled={saveMemory.isPending || gatewayIds.length === 0}
          pending={saveMemory.isPending}
          pendingText="Saving memory setup..."
          onClick={() => saveMemory.mutate()}
        >
          Save memory setup
        </AsyncButton>
        <Button type="button" variant="outline" disabled={!props.isComplete} onClick={props.onContinue}>
          Continue
        </Button>
      </div>

      {!props.isComplete ? (
        <div className="text-xs text-muted-foreground">
          This step is complete after each gateway has an explicit memory backend.
        </div>
      ) : null}
    </div>
  )
}
