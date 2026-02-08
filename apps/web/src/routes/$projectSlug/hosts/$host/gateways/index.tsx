import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useConvexAuth } from "convex/react"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { api } from "../../../../../../convex/_generated/api"
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"
import { StackedField } from "~/components/ui/stacked-field"
import { useProjectBySlug } from "~/lib/project-data"
import { GatewayRoster, type GatewayRosterDetail } from "~/components/fleet/gateway/gateway-roster"
import { addGateway, setGatewayArchitecture } from "~/sdk/config"
import { authClient } from "~/lib/auth-client"
import type { GatewayArchitecture } from "@clawlets/core/lib/config/clawlets-config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/gateways/")({
  component: GatewaysSetup,
})

const SAFE_GATEWAY_ID_RE = /^[a-z][a-z0-9_-]*$/

function slugifyGatewayId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")

  if (!cleaned) return "gateway"
  if (/^[a-z]/.test(cleaned)) return cleaned
  return `gateway-${cleaned}`
}

function suggestUniqueGatewayId(params: { displayName: string; taken: Set<string> }): string {
  const base = slugifyGatewayId(params.displayName || "gateway")
  if (!params.taken.has(base)) return base
  for (let i = 2; i < 1_000; i++) {
    const candidate = `${base}-${i}`
    if (!params.taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

function GatewaysSetup() {
  const { projectSlug, host } = Route.useParams()
  const navigate = useNavigate()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const project = useQuery({
    ...convexQuery(api.controlPlane.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })
  const canEdit = project.data?.role === "admin"

  const hostsQuerySpec = convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> })
  const hostsQuery = useQuery({
    ...hostsQuerySpec,
    enabled: Boolean(projectId) && canQuery,
    gcTime: 5_000,
  })
  const hostSummary = hostsQuery.data?.find((row) => row.hostName === host)

  const gatewaysQuerySpec = convexQuery(api.controlPlane.gateways.listByProjectHost, {
    projectId: projectId as Id<"projects">,
    hostName: host,
  })
  const gatewaysQuery = useQuery({
    ...gatewaysQuerySpec,
    enabled: Boolean(projectId) && canQuery && Boolean(hostSummary),
    gcTime: 5_000,
  })
  const gatewayRows = gatewaysQuery.data || []
  const gateways = useMemo(() => gatewayRows.map((row) => row.gatewayId), [gatewayRows])
  const gatewayArchitecture = (hostSummary?.desired as { gatewayArchitecture?: GatewayArchitecture } | undefined)
    ?.gatewayArchitecture
  const hasGateways = gateways.length > 0
  const isSingleArchitecture = gatewayArchitecture === "single"
  const primaryGatewayId = gateways[0] ? String(gateways[0]) : ""

  const takenIds = useMemo(
    () => new Set(gateways.map((g) => String(g || "").trim()).filter(Boolean)),
    [gateways],
  )

  const [rosterQuery, setRosterQuery] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")

  const normalizedQuery = rosterQuery.trim().toLowerCase()
  const hasRosterQuery = Boolean(normalizedQuery)

  const gatewayDetailsById = useMemo<Record<string, GatewayRosterDetail>>(() => {
    const byId: Record<string, GatewayRosterDetail> = {}
    for (const row of gatewayRows) {
      const details = (row.desired || {}) as {
        channels?: string[]
        port?: number
      }
      byId[row.gatewayId] = {
        channels: Array.isArray(details.channels) ? details.channels.map((entry) => String(entry)).filter(Boolean) : [],
        port: typeof details.port === "number" && Number.isFinite(details.port) ? Math.trunc(details.port) : null,
      }
    }
    return byId
  }, [gatewayRows])

  const allChannels = useMemo(() => {
    const found = new Set<string>()
    for (const gatewayId of gateways) {
      const channels = gatewayDetailsById[gatewayId]?.channels || []
      for (const channel of channels) {
        const normalized = String(channel || "").trim()
        if (normalized) found.add(normalized)
      }
    }
    return Array.from(found).sort()
  }, [gateways, gatewayDetailsById])

  const filteredGateways = useMemo(() => {
    const query = normalizedQuery
    const filter = channelFilter

    return gateways.filter((gatewayId) => {
      if (query && !gatewayId.toLowerCase().includes(query)) return false
      if (filter === "all") return true
      return (gatewayDetailsById[gatewayId]?.channels || []).includes(filter)
    })
  }, [gateways, channelFilter, gatewayDetailsById, normalizedQuery])

  const [addOpen, setAddOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [gatewayIdOverride, setGatewayIdOverride] = useState("")
  const [gatewayIdOverrideEnabled, setGatewayIdOverrideEnabled] = useState(false)
  const [architectureDraft, setArchitectureDraft] = useState<GatewayArchitecture>("multi")

  const needsArchitectureChoice = !gatewayArchitecture && !hasGateways

  const suggestedGatewayId = useMemo(
    () => suggestUniqueGatewayId({ displayName, taken: takenIds }),
    [displayName, takenIds],
  )
  const effectiveGatewayId = (gatewayIdOverrideEnabled ? gatewayIdOverride : suggestedGatewayId).trim()

  const addGatewayMutation = useMutation({
    mutationFn: async (gatewayId: string) =>
      await addGateway({
        data: {
          projectId: projectId as Id<"projects">,
          host,
          gatewayId,
          architecture: needsArchitectureChoice ? architectureDraft : "",
        },
      }),
    onSuccess: () => {
      toast.success("Gateway added")
      setAddOpen(false)
      setDisplayName("")
      setGatewayIdOverride("")
      setGatewayIdOverrideEnabled(false)
      void queryClient.invalidateQueries({ queryKey: hostsQuerySpec.queryKey })
      void queryClient.invalidateQueries({ queryKey: gatewaysQuerySpec.queryKey })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const setArchitecture = useMutation({
    mutationFn: async (architecture: GatewayArchitecture) =>
      await setGatewayArchitecture({
        data: { projectId: projectId as Id<"projects">, architecture },
      }),
    onSuccess: () => {
      toast.success("Gateway architecture updated")
      void queryClient.invalidateQueries({ queryKey: hostsQuerySpec.queryKey })
      void queryClient.invalidateQueries({ queryKey: gatewaysQuerySpec.queryKey })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const addGatewayDialog = (
    <Dialog
      open={addOpen}
      onOpenChange={(next) => {
        setAddOpen(next)
        if (!next) {
          setDisplayName("")
          setGatewayIdOverride("")
          setGatewayIdOverrideEnabled(false)
          setArchitectureDraft("multi")
        } else {
          setArchitectureDraft(gatewayArchitecture ?? "multi")
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" disabled={!canEdit}>
            Add gateway
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add gateway</DialogTitle>
          <DialogDescription>
            Pick a display name. We'll generate a safe id you can override in advanced options.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsArchitectureChoice ? (
            <StackedField
              id="gatewayArchitecture"
              label="Gateway architecture"
              description="Pick how you want to scale: multiple isolated gateways or one gateway with multiple agents."
            >
              <RadioGroup
                value={architectureDraft}
                onValueChange={(value) => setArchitectureDraft(value as GatewayArchitecture)}
                className="gap-3"
              >
                <label className="flex items-start gap-3 rounded-md border bg-muted/10 p-3">
                  <RadioGroupItem value="multi" />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">Multiple gateways</span>
                    <span className="block text-xs text-muted-foreground">
                      Each entry runs as its own gateway instance with isolated ports and state.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-md border bg-muted/10 p-3">
                  <RadioGroupItem value="single" />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">One gateway, multiple agents</span>
                    <span className="block text-xs text-muted-foreground">
                      One gateway process, multiple personas under agents.list.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </StackedField>
          ) : null}
          <StackedField id="agentDisplayName" label="Display name">
            <Input
              id="agentDisplayName"
              placeholder="OpenClaw"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
            />
          </StackedField>

          <Accordion className="rounded-lg border bg-muted/20">
            <AccordionItem value="advanced" className="px-4">
              <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
                Advanced options
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-3">
                  <StackedField
                    id="gatewayId"
                    label="Gateway id"
                    description="Used in config paths and as a stable identifier. Allowed: [a-z][a-z0-9_-]*."
                  >
                    <Input
                      id="gatewayId"
                      placeholder="openclaw"
                      value={gatewayIdOverrideEnabled ? gatewayIdOverride : suggestedGatewayId}
                      onChange={(e) => {
                        setGatewayIdOverrideEnabled(true)
                        setGatewayIdOverride(e.target.value)
                      }}
                    />
                  </StackedField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            type="button"
            disabled={
              !canEdit ||
              addGatewayMutation.isPending ||
              !effectiveGatewayId ||
              !SAFE_GATEWAY_ID_RE.test(effectiveGatewayId) ||
              takenIds.has(effectiveGatewayId)
            }
            onClick={() => {
              if (!effectiveGatewayId) return
              if (!SAFE_GATEWAY_ID_RE.test(effectiveGatewayId)) {
                toast.error("Invalid gateway id (use [a-z][a-z0-9_-]*)")
                return
              }
              if (takenIds.has(effectiveGatewayId)) {
                toast.error("That gateway id already exists")
                return
              }
              addGatewayMutation.mutate(effectiveGatewayId)
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gateways"
        description="Add/remove gateways and configure per-gateway settings."
        actions={
          isSingleArchitecture && hasGateways ? (
            <Button
              type="button"
              disabled={!canEdit || !primaryGatewayId}
              onClick={() => {
                if (!primaryGatewayId) return
                void navigate({
                  to: "/$projectSlug/hosts/$host/gateways/$gatewayId/personas",
                  params: { projectSlug, host, gatewayId: primaryGatewayId },
                })
              }}
            >
              Add agent
            </Button>
          ) : (
            addGatewayDialog
          )
        }
      />

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Gateway architecture</div>
          <div className="text-xs text-muted-foreground">
            Choose how personas map to OpenClaw gateways. This is a UI preference stored in the config.
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select
            value={gatewayArchitecture || ""}
            onValueChange={(value) => setArchitecture.mutate(value as GatewayArchitecture)}
          >
            <SelectTrigger className="w-full sm:w-64" disabled={!canEdit || setArchitecture.isPending || !projectId}>
              <SelectValue placeholder="Choose architecture" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="multi">Multiple gateways</SelectItem>
                <SelectItem value="single">One gateway, multiple agents</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">
            Changing this does not migrate existing gateways or agents.
          </div>
        </div>
      </div>

      {projectQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projectQuery.error ? (
        <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
      ) : !projectId ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : hostsQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : hostsQuery.error ? (
        <div className="text-sm text-destructive">{String(hostsQuery.error)}</div>
      ) : !hostSummary ? (
        <div className="text-muted-foreground">Host not found in control-plane metadata.</div>
      ) : gatewaysQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : gatewaysQuery.error ? (
        <div className="text-sm text-destructive">{String(gatewaysQuery.error)}</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <Label htmlFor="gateways-search" className="sr-only">
                Search gateways
              </Label>
              <InputGroup className="bg-input/30 border-input/30 shadow-none">
                <InputGroupAddon className="pl-2">
                  <MagnifyingGlassIcon className="size-4 shrink-0 opacity-50" />
                </InputGroupAddon>
                <InputGroupInput
                  id="gateways-search"
                  type="search"
                  placeholder="Search gateways…"
                  value={rosterQuery}
                  onChange={(e) => setRosterQuery(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </InputGroup>
            </div>

            <div className="w-full sm:w-auto">
              <Select value={channelFilter} onValueChange={(value) => setChannelFilter(value ?? "all")}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="All channels" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectGroup>
                    <SelectItem value="all">All channels</SelectItem>
                    {allChannels.map((channel) => (
                      <SelectItem key={channel} value={channel}>
                        {channel}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <GatewayRoster
            projectSlug={projectSlug}
            host={host}
            projectId={projectId}
            gateways={filteredGateways}
            gatewayDetails={gatewayDetailsById}
            canEdit={canEdit}
            emptyText={hasRosterQuery || channelFilter !== "all" ? "No matches." : "No gateways yet."}
          />
        </div>
      )}
    </div>
  )
}
