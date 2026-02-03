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
import { BotRoster, getBotChannels } from "~/components/fleet/bot/gateway-roster"
import { addBot, getClawletsConfig, setGatewayArchitecture } from "~/sdk/config"
import { authClient } from "~/lib/auth-client"
import type { GatewayArchitecture } from "@clawlets/core/lib/clawlets-config"

export const Route = createFileRoute("/$projectSlug/hosts/$host/bots/")({
  component: BotsSetup,
})

const SAFE_BOT_ID_RE = /^[a-z][a-z0-9_-]*$/

function slugifyBotId(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")

  if (!cleaned) return "bot"
  if (/^[a-z]/.test(cleaned)) return cleaned
  return `bot-${cleaned}`
}

function suggestUniqueBotId(params: { displayName: string; taken: Set<string> }): string {
  const base = slugifyBotId(params.displayName || "bot")
  if (!params.taken.has(base)) return base
  for (let i = 2; i < 1_000; i++) {
    const candidate = `${base}-${i}`
    if (!params.taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

function BotsSetup() {
  const { projectSlug, host } = Route.useParams()
  const navigate = useNavigate()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const { data: session, isPending } = authClient.useSession()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const canQuery = Boolean(session?.user?.id) && isAuthenticated && !isPending && !isLoading

  const project = useQuery({
    ...convexQuery(api.projects.get, { projectId: projectId as Id<"projects"> }),
    gcTime: 5_000,
    enabled: Boolean(projectId) && canQuery,
  })
  const canEdit = project.data?.role === "admin"

  const cfg = useQuery({
    queryKey: ["clawletsConfig", projectId],
    queryFn: async () =>
      await getClawletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
    enabled: Boolean(projectId) && canQuery,
  })
  const config = cfg.data?.config
  const hostCfg = (config as any)?.hosts?.[host]
  const bots = useMemo(() => (hostCfg?.botsOrder as string[]) || [], [hostCfg])
  const gatewayArchitecture = (config?.fleet as { gatewayArchitecture?: GatewayArchitecture } | undefined)
    ?.gatewayArchitecture
  const hasGateways = bots.length > 0
  const isSingleArchitecture = gatewayArchitecture === "single"
  const primaryGatewayId = bots[0] ? String(bots[0]) : ""

  const takenIds = useMemo(() => new Set(bots.map((b) => String(b || "").trim()).filter(Boolean)), [bots])

  const [rosterQuery, setRosterQuery] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")

  const normalizedQuery = rosterQuery.trim().toLowerCase()
  const hasRosterQuery = Boolean(normalizedQuery)

  const allChannels = useMemo(() => {
    if (!config) return []
    const found = new Set<string>()
    for (const botId of bots) {
      for (const channel of getBotChannels({ config, host, botId })) {
        found.add(channel)
      }
    }
    return Array.from(found).sort()
  }, [bots, config])

  const filteredBots = useMemo(() => {
    const query = normalizedQuery
    const filter = channelFilter

    return bots.filter((botId) => {
      if (query && !botId.toLowerCase().includes(query)) return false
      if (filter === "all") return true
      if (!config) return false
      return getBotChannels({ config, host, botId }).includes(filter)
    })
  }, [bots, channelFilter, config, normalizedQuery])

  const [addOpen, setAddOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [botIdOverride, setBotIdOverride] = useState("")
  const [botIdOverrideEnabled, setBotIdOverrideEnabled] = useState(false)
  const [architectureDraft, setArchitectureDraft] = useState<GatewayArchitecture>("multi")

  const needsArchitectureChoice = !gatewayArchitecture && !hasGateways

  const suggestedBotId = useMemo(
    () => suggestUniqueBotId({ displayName, taken: takenIds }),
    [displayName, takenIds],
  )
  const effectiveBotId = (botIdOverrideEnabled ? botIdOverride : suggestedBotId).trim()

  const addBotMutation = useMutation({
    mutationFn: async (bot: string) =>
      await addBot({
        data: {
          projectId: projectId as Id<"projects">,
          host,
          bot,
          architecture: needsArchitectureChoice ? architectureDraft : "",
        },
      }),
    onSuccess: () => {
      toast.success("Bot added")
      setAddOpen(false)
      setDisplayName("")
      setBotIdOverride("")
      setBotIdOverrideEnabled(false)
      void queryClient.invalidateQueries({ queryKey: ["clawletsConfig", projectId] })
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
      void queryClient.invalidateQueries({ queryKey: ["clawletsConfig", projectId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const addBotDialog = (
    <Dialog
      open={addOpen}
      onOpenChange={(next) => {
        setAddOpen(next)
        if (!next) {
          setDisplayName("")
          setBotIdOverride("")
          setBotIdOverrideEnabled(false)
          setArchitectureDraft("multi")
        } else {
          setArchitectureDraft(gatewayArchitecture ?? "multi")
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" disabled={!canEdit}>
            Add bot
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add bot</DialogTitle>
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
                      Each bot runs as its own gateway instance with isolated ports and state.
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
                    id="agentId"
                    label="Bot id"
                    description="Used in config paths and as a stable identifier. Allowed: [a-z][a-z0-9_-]*."
                  >
                    <Input
                      id="agentId"
                      placeholder="openclaw"
                      value={botIdOverrideEnabled ? botIdOverride : suggestedBotId}
                      onChange={(e) => {
                        setBotIdOverrideEnabled(true)
                        setBotIdOverride(e.target.value)
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
              addBotMutation.isPending ||
              !effectiveBotId ||
              !SAFE_BOT_ID_RE.test(effectiveBotId) ||
              takenIds.has(effectiveBotId)
            }
            onClick={() => {
              if (!effectiveBotId) return
              if (!SAFE_BOT_ID_RE.test(effectiveBotId)) {
                toast.error("Invalid bot id (use [a-z][a-z0-9_-]*)")
                return
              }
              if (takenIds.has(effectiveBotId)) {
                toast.error("That bot id already exists")
                return
              }
              addBotMutation.mutate(effectiveBotId)
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
        title="Bots"
        description="Add/remove bots and configure per-bot settings."
        actions={
          isSingleArchitecture && hasGateways ? (
            <Button
              type="button"
              disabled={!canEdit || !primaryGatewayId}
              onClick={() => {
                if (!primaryGatewayId) return
                void navigate({
                  to: "/$projectSlug/hosts/$host/bots/$botId/personas",
                  params: { projectSlug, host, botId: primaryGatewayId },
                })
              }}
            >
              Add agent
            </Button>
          ) : (
            addBotDialog
          )
        }
      />

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Gateway architecture</div>
          <div className="text-xs text-muted-foreground">
            Choose how bots map to OpenClaw gateways. This is a UI preference stored in the config.
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
      ) : cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <Label htmlFor="bots-search" className="sr-only">
                Search bots
              </Label>
              <InputGroup className="bg-input/30 border-input/30 shadow-none">
                <InputGroupAddon className="pl-2">
                  <MagnifyingGlassIcon className="size-4 shrink-0 opacity-50" />
                </InputGroupAddon>
                <InputGroupInput
                  id="bots-search"
                  type="search"
                  placeholder="Search bots…"
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

          <BotRoster
            projectSlug={projectSlug}
            host={host}
            projectId={projectId}
            bots={filteredBots}
            config={config}
            canEdit={canEdit}
            emptyText={hasRosterQuery || channelFilter !== "all" ? "No matches." : "No bots yet."}
          />
        </div>
      )}
    </div>
  )
}
