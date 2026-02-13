import { useState } from "react"
import { AsyncButton } from "~/components/ui/async-button"
import { Input } from "~/components/ui/input"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { Switch } from "~/components/ui/switch"
import { ConfigCard } from "../shared/config-card"
import { buildGatewayConfigPath } from "../shared/config-path"
import type { BuiltinMemorySettings, OpenclawMemoryBackend, QmdMemorySettings } from "~/sdk/openclaw"

export type MemoryCardSaveInput = {
  backend: OpenclawMemoryBackend
  builtin: BuiltinMemorySettings
  qmd: QmdMemorySettings
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
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null
  return parsed
}

export function MemoryConfigCard(props: {
  host: string
  gatewayId: string
  canEdit: boolean
  pending: boolean
  initialBackend: OpenclawMemoryBackend
  initialBuiltin: BuiltinMemorySettings
  initialQmd: QmdMemorySettings
  onSave: (input: MemoryCardSaveInput) => void
}) {
  const [backend, setBackend] = useState<OpenclawMemoryBackend>(props.initialBackend)
  const [builtinEnabled, setBuiltinEnabled] = useState(props.initialBuiltin.enabled)
  const [builtinSessionMemory, setBuiltinSessionMemory] = useState(props.initialBuiltin.sessionMemory)
  const [builtinMaxResultsText, setBuiltinMaxResultsText] = useState(String(props.initialBuiltin.maxResults))
  const [builtinMinScoreText, setBuiltinMinScoreText] = useState(String(props.initialBuiltin.minScore))
  const [qmdCommand, setQmdCommand] = useState(props.initialQmd.command)
  const [qmdSessionsEnabled, setQmdSessionsEnabled] = useState(props.initialQmd.sessionsEnabled)
  const [qmdMaxResultsText, setQmdMaxResultsText] = useState(String(props.initialQmd.maxResults))
  const [validationError, setValidationError] = useState<string | null>(null)

  return (
    <ConfigCard
      title="Memory config"
      configPath={`${buildGatewayConfigPath(props.host, props.gatewayId)}.{agents.defaults.memorySearch,openclaw.memory}`}
    >
      <div className="space-y-3">
        <div className="text-sm font-medium">Backend</div>
        <RadioGroup
          value={backend}
          onValueChange={(value) => {
            if (value === "builtin" || value === "qmd") setBackend(value)
          }}
          className="grid gap-2 md:grid-cols-2"
        >
          <label className="flex items-start gap-2 rounded-md border bg-muted/10 p-3">
            <RadioGroupItem value="builtin" id={`memory-backend-builtin-${props.gatewayId}`} />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Builtin</span>
              <span className="block text-xs text-muted-foreground">OpenClaw memorySearch embeddings.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border bg-muted/10 p-3">
            <RadioGroupItem value="qmd" id={`memory-backend-qmd-${props.gatewayId}`} />
            <span className="space-y-1">
              <span className="block text-sm font-medium">QMD</span>
              <span className="block text-xs text-muted-foreground">QMD backend for memory retrieval.</span>
            </span>
          </label>
        </RadioGroup>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-md border bg-muted/10 p-3">
          <div className="text-sm font-medium">Builtin settings</div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Enable memorySearch</div>
            <Switch checked={builtinEnabled} disabled={!props.canEdit || props.pending} onCheckedChange={setBuiltinEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Session indexing</div>
            <Switch checked={builtinSessionMemory} disabled={!props.canEdit || props.pending} onCheckedChange={setBuiltinSessionMemory} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Max results</div>
            <Input
              value={builtinMaxResultsText}
              inputMode="numeric"
              disabled={!props.canEdit || props.pending}
              onChange={(event) => setBuiltinMaxResultsText(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Min score (0-1)</div>
            <Input
              value={builtinMinScoreText}
              disabled={!props.canEdit || props.pending}
              onChange={(event) => setBuiltinMinScoreText(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border bg-muted/10 p-3">
          <div className="text-sm font-medium">QMD settings</div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Command</div>
            <Input
              value={qmdCommand}
              placeholder="qmd"
              disabled={!props.canEdit || props.pending}
              onChange={(event) => setQmdCommand(event.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Session indexing</div>
            <Switch checked={qmdSessionsEnabled} disabled={!props.canEdit || props.pending} onCheckedChange={setQmdSessionsEnabled} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Max results</div>
            <Input
              value={qmdMaxResultsText}
              inputMode="numeric"
              disabled={!props.canEdit || props.pending}
              onChange={(event) => setQmdMaxResultsText(event.target.value)}
            />
          </div>
        </div>
      </div>

      {validationError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          {validationError}
        </div>
      ) : null}

      <AsyncButton
        type="button"
        disabled={!props.canEdit || props.pending}
        pending={props.pending}
        pendingText="Saving memory config..."
        onClick={() => {
          const builtinMaxResults = parsePositiveInt(builtinMaxResultsText)
          if (builtinMaxResults == null) {
            setValidationError("Builtin max results must be a positive integer.")
            return
          }
          const builtinMinScore = parseScore(builtinMinScoreText)
          if (builtinMinScore == null) {
            setValidationError("Builtin min score must be a number between 0 and 1.")
            return
          }
          const qmdMaxResults = parsePositiveInt(qmdMaxResultsText)
          if (qmdMaxResults == null) {
            setValidationError("QMD max results must be a positive integer.")
            return
          }
          setValidationError(null)
          props.onSave({
            backend,
            builtin: {
              enabled: builtinEnabled,
              sessionMemory: builtinSessionMemory,
              maxResults: builtinMaxResults,
              minScore: builtinMinScore,
            },
            qmd: {
              command: qmdCommand.trim() || "qmd",
              sessionsEnabled: qmdSessionsEnabled,
              maxResults: qmdMaxResults,
            },
          })
        }}
      >
        Save memory config
      </AsyncButton>
    </ConfigCard>
  )
}
