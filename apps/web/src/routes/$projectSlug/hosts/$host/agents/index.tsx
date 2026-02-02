import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"
import { StackedField } from "~/components/ui/stacked-field"
import { useProjectBySlug } from "~/lib/project-data"
import { BotRoster, getBotChannels } from "~/components/fleet/bot/bot-roster"
import { addBot, getClawletsConfig } from "~/sdk/config"
import { authClient } from "~/lib/auth-client"

export const Route = createFileRoute("/$projectSlug/hosts/$host/agents/")({
  component: AgentsSetup,
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

  if (!cleaned) return "agent"
  if (/^[a-z]/.test(cleaned)) return cleaned
  return `agent-${cleaned}`
}

function suggestUniqueBotId(params: { displayName: string; taken: Set<string> }): string {
  const base = slugifyBotId(params.displayName || "agent")
  if (!params.taken.has(base)) return base
  for (let i = 2; i < 1_000; i++) {
    const candidate = `${base}-${i}`
    if (!params.taken.has(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

function AgentsSetup() {
  const { projectSlug, host } = Route.useParams()
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
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])

  const takenIds = useMemo(() => new Set(bots.map((b) => String(b || "").trim()).filter(Boolean)), [bots])

  const [rosterQuery, setRosterQuery] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")

  const normalizedQuery = rosterQuery.trim().toLowerCase()
  const hasRosterQuery = Boolean(normalizedQuery)

  const allChannels = useMemo(() => {
    if (!config) return []
    const found = new Set<string>()
    for (const botId of bots) {
      for (const channel of getBotChannels({ config, botId })) {
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
      return getBotChannels({ config, botId }).includes(filter)
    })
  }, [bots, channelFilter, config, normalizedQuery])

  const [addOpen, setAddOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [botIdOverride, setBotIdOverride] = useState("")
  const [botIdOverrideEnabled, setBotIdOverrideEnabled] = useState(false)

  const suggestedBotId = useMemo(
    () => suggestUniqueBotId({ displayName, taken: takenIds }),
    [displayName, takenIds],
  )
  const effectiveBotId = (botIdOverrideEnabled ? botIdOverride : suggestedBotId).trim()

  const addBotMutation = useMutation({
    mutationFn: async (bot: string) =>
      await addBot({ data: { projectId: projectId as Id<"projects">, bot } }),
    onSuccess: () => {
      toast.success("Agent added")
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

  const addAgentDialog = (
    <Dialog
      open={addOpen}
      onOpenChange={(next) => {
        setAddOpen(next)
        if (!next) {
          setDisplayName("")
          setBotIdOverride("")
          setBotIdOverrideEnabled(false)
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" disabled={!canEdit}>
            Add agent
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add agent</DialogTitle>
          <DialogDescription>
            Pick a display name. We'll generate a safe id you can override in advanced options.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                    label="Agent id"
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
                toast.error("Invalid agent id (use [a-z][a-z0-9_-]*)")
                return
              }
              if (takenIds.has(effectiveBotId)) {
                toast.error("That agent id already exists")
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
        title="Agents"
        description="Add/remove agents and configure per-agent settings."
        actions={addAgentDialog}
      />

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
              <Label htmlFor="agents-search" className="sr-only">
                Search agents
              </Label>
              <InputGroup className="bg-input/30 border-input/30 shadow-none">
                <InputGroupAddon className="pl-2">
                  <MagnifyingGlassIcon className="size-4 shrink-0 opacity-50" />
                </InputGroupAddon>
                <InputGroupInput
                  id="agents-search"
                  type="search"
                  placeholder="Search agents…"
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
            emptyText={hasRosterQuery || channelFilter !== "all" ? "No matches." : "No agents yet."}
          />
        </div>
      )}
    </div>
  )
}
