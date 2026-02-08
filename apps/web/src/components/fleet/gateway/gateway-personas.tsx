import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Badge } from "~/components/ui/badge"
import { StackedField } from "~/components/ui/stacked-field"
import { Checkbox } from "~/components/ui/checkbox"
import { addGatewayAgent, removeGatewayAgent } from "~/sdk/config"

const SAFE_AGENT_ID_RE = /^[a-z][a-z0-9_-]*$/

type AgentEntry = {
  id?: string
  name?: string
  default?: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function slugifyAgentId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")

  if (!cleaned) return "agent"
  if (/^[a-z]/.test(cleaned)) return cleaned
  return `agent-${cleaned}`
}

function suggestUniqueAgentId(params: { displayName: string; taken: Set<string> }): string {
  const base = slugifyAgentId(params.displayName || "agent")
  if (!params.taken.has(base)) return base
  for (let i = 2; i < 1_000; i++) {
    const candidate = `${base}-${i}`
    if (!params.taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

function normalizeAgentList(agents: unknown): AgentEntry[] {
  if (!isPlainObject(agents)) return []
  const list = agents["list"]
  if (!Array.isArray(list)) return []
  return list.filter((entry) => isPlainObject(entry)) as AgentEntry[]
}

export function GatewayPersonas(props: {
  projectId: string
  host: string
  gatewayId: string
  agents: unknown
  canEdit: boolean
  configQueryKey?: readonly unknown[]
  metadataQueryKey?: readonly unknown[]
}) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [agentIdOverride, setAgentIdOverride] = useState("")
  const [agentIdOverrideEnabled, setAgentIdOverrideEnabled] = useState(false)
  const [makeDefault, setMakeDefault] = useState(false)

  const agents = useMemo(() => normalizeAgentList(props.agents), [props.agents])
  const sortedAgents = useMemo(
    () =>
      [...agents]
        .filter((entry) => entry.id)
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    [agents],
  )
  const takenIds = useMemo(() => new Set(sortedAgents.map((entry) => String(entry.id || ""))), [sortedAgents])
  const hasDefault = useMemo(() => sortedAgents.some((entry) => entry.default), [sortedAgents])

  const suggestedAgentId = useMemo(
    () => suggestUniqueAgentId({ displayName, taken: takenIds }),
    [displayName, takenIds],
  )
  const effectiveAgentId = (agentIdOverrideEnabled ? agentIdOverride : suggestedAgentId).trim()

  const addAgent = useMutation({
    mutationFn: async () =>
      await addGatewayAgent({
        data: {
          projectId: props.projectId,
          host: props.host,
          gatewayId: props.gatewayId,
          agentId: effectiveAgentId,
          name: displayName,
          makeDefault,
        },
      }),
    onSuccess: () => {
      toast.success("Agent added")
      setAddOpen(false)
      setDisplayName("")
      setAgentIdOverride("")
      setAgentIdOverrideEnabled(false)
      setMakeDefault(false)
      if (props.configQueryKey) {
        void queryClient.invalidateQueries({ queryKey: props.configQueryKey })
      }
      if (props.metadataQueryKey) {
        void queryClient.invalidateQueries({ queryKey: props.metadataQueryKey })
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  const removeAgent = useMutation({
    mutationFn: async (agentId: string) =>
      await removeGatewayAgent({
        data: { projectId: props.projectId, host: props.host, gatewayId: props.gatewayId, agentId },
      }),
    onSuccess: () => {
      toast.success("Agent removed")
      if (props.configQueryKey) {
        void queryClient.invalidateQueries({ queryKey: props.configQueryKey })
      }
      if (props.metadataQueryKey) {
        void queryClient.invalidateQueries({ queryKey: props.metadataQueryKey })
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Personas</div>
          <div className="text-xs text-muted-foreground">Manage agents for this gateway instance.</div>
        </div>
        <Dialog
          open={addOpen}
          onOpenChange={(next) => {
            setAddOpen(next)
            if (!next) {
              setDisplayName("")
              setAgentIdOverride("")
              setAgentIdOverrideEnabled(false)
              setMakeDefault(false)
            } else {
              setMakeDefault(!hasDefault)
            }
          }}
        >
          <DialogTrigger
            render={
              <Button type="button" size="sm" disabled={!props.canEdit}>
                Add agent
              </Button>
            }
          />
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add agent</DialogTitle>
              <DialogDescription>
                Create a persona entry under <code>{props.gatewayId}</code>. Advanced per-agent config lives in OpenClaw
                passthrough.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <StackedField id="personaDisplayName" label="Display name">
                <Input
                  id="personaDisplayName"
                  placeholder="Primary"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                />
              </StackedField>

              <StackedField
                id="personaId"
                label="Agent id"
                description="Used in config paths. Allowed: [a-z][a-z0-9_-]*."
              >
                <Input
                  id="personaId"
                  placeholder="primary"
                  value={agentIdOverrideEnabled ? agentIdOverride : suggestedAgentId}
                  onChange={(e) => {
                    setAgentIdOverrideEnabled(true)
                    setAgentIdOverride(e.target.value)
                  }}
                />
              </StackedField>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="personaDefault"
                  checked={makeDefault}
                  onCheckedChange={(checked) => setMakeDefault(Boolean(checked))}
                />
                <Label htmlFor="personaDefault" className="text-sm">
                  Make default agent
                </Label>
              </div>
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button
                type="button"
                disabled={
                  !props.canEdit ||
                  addAgent.isPending ||
                  !effectiveAgentId ||
                  !SAFE_AGENT_ID_RE.test(effectiveAgentId) ||
                  takenIds.has(effectiveAgentId)
                }
                onClick={() => {
                  if (!effectiveAgentId) return
                  if (!SAFE_AGENT_ID_RE.test(effectiveAgentId)) {
                    toast.error("Invalid agent id (use [a-z][a-z0-9_-]*)")
                    return
                  }
                  if (takenIds.has(effectiveAgentId)) {
                    toast.error("That agent id already exists")
                    return
                  }
                  addAgent.mutate()
                }}
              >
                Add agent
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {sortedAgents.length === 0 ? (
        <div className="text-xs text-muted-foreground">No personas configured yet.</div>
      ) : (
        <div className="space-y-2">
          {sortedAgents.map((entry) => {
            const id = String(entry.id || "").trim()
            if (!id) return null
            return (
              <div key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {entry.name ? `${entry.name} ` : null}
                    <code>{id}</code>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {entry.default ? <Badge variant="secondary">default</Badge> : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.canEdit || removeAgent.isPending}
                  onClick={() => {
                    if (!props.canEdit) return
                    const ok = window.confirm(`Remove agent ${id}?`)
                    if (!ok) return
                    removeAgent.mutate(id)
                  }}
                >
                  Remove
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
