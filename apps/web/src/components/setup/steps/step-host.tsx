import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostThemeBadge } from "~/components/hosts/host-theme"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { addHost } from "~/sdk/config"

export function SetupStepHost(props: {
  projectId: Id<"projects">
  config: any | null
  selectedHost: string | null
  onSelectHost: (host: string) => void
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const hosts = useMemo(() => Object.keys(props.config?.hosts || {}).sort(), [props.config])
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const filteredHosts = useMemo(
    () => (normalizedQuery ? hosts.filter((h) => h.toLowerCase().includes(normalizedQuery)) : hosts),
    [hosts, normalizedQuery],
  )

  const [newHost, setNewHost] = useState("")
  const addHostMutation = useMutation({
    mutationFn: async () => {
      const trimmed = newHost.trim()
      if (!trimmed) throw new Error("Host name required")
      return await addHost({ data: { projectId: props.projectId, host: trimmed } })
    },
    onSuccess: () => {
      toast.success("Host added")
      const nextHost = newHost.trim()
      setNewHost("")
      void queryClient.invalidateQueries({ queryKey: ["clawletsConfig", props.projectId] })
      if (nextHost) props.onSelectHost(nextHost)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-4">
      {hosts.length ? (
        <div className="space-y-2">
          <Label htmlFor="setup-host-search">Search hosts</Label>
          <Input
            id="setup-host-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter…"
          />
        </div>
      ) : null}

      {filteredHosts.length ? (
        <div className="grid gap-2">
          {filteredHosts.map((host) => {
            const hostCfg = (props.config?.hosts as any)?.[host] || {}
            const enabled = hostCfg?.enable !== false
            const isActive = host === props.selectedHost
            return (
              <button
                key={host}
                type="button"
                onClick={() => props.onSelectHost(host)}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isActive ? "bg-muted/40" : "hover:bg-muted/20"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <HostThemeBadge theme={hostCfg?.theme} size="xs" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{host}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {hostCfg?.targetHost ? `Target: ${hostCfg.targetHost}` : "Target host not set"}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-xs text-muted-foreground">
                  {enabled ? "enabled" : "disabled"}
                </div>
              </button>
            )
          })}
        </div>
      ) : hosts.length ? (
        <div className="text-sm text-muted-foreground">No hosts match.</div>
      ) : (
        <div className="text-sm text-muted-foreground">No hosts configured yet.</div>
      )}

      <div className="rounded-lg border bg-muted/10 p-4 space-y-3">
        <div className="font-medium">Add host</div>
        <div className="space-y-2">
          <Label htmlFor="setup-new-host">Host name</Label>
          <Input
            id="setup-new-host"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            placeholder="clawlets-prod-01"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={addHostMutation.isPending || !newHost.trim()}
            onClick={() => addHostMutation.mutate()}
          >
            Add host
          </Button>
          <Button
            type="button"
            disabled={!props.selectedHost}
            onClick={props.onContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

