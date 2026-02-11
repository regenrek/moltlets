import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { generateHostName as generateRandomHostName } from "@clawlets/core/lib/host/host-name-generator"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { HostThemeBadge } from "~/components/hosts/host-theme"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Label } from "~/components/ui/label"
import { SettingsSection } from "~/components/ui/settings-section"
import { addHost } from "~/sdk/config"

export function SetupStepHost(props: {
  projectId: Id<"projects">
  config: any | null
  onSelectHost: (host: string) => void
}) {
  const hosts = useMemo(() => Object.keys(props.config?.hosts || {}).sort(), [props.config])
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const filteredHosts = useMemo(
    () => (normalizedQuery ? hosts.filter((h) => h.toLowerCase().includes(normalizedQuery)) : hosts),
    [hosts, normalizedQuery],
  )

  const [newHost, setNewHost] = useState("")
  const queryClient = useQueryClient()
  const addHostMutation = useMutation({
    mutationFn: async () => {
      const trimmed = newHost.trim()
      if (!trimmed) throw new Error("Host name required")
      return await addHost({ data: { projectId: props.projectId, host: trimmed } })
    },
    onSuccess: (result) => {
      if (result.queued) toast.success("Host add queued. Runner still processing.")
      else if (result.alreadyExists) toast.success("Host already exists")
      else toast.success("Host added")
      const nextHost = newHost.trim()
      setNewHost("")
      if (nextHost) {
        queryClient.setQueryData(
          ["hostSetupConfig", props.projectId],
          (prev: { hosts: Record<string, Record<string, unknown>>; fleet?: { sshAuthorizedKeys?: unknown[] } } | null) => {
            if (!prev) return prev
            if (prev.hosts?.[nextHost]) return prev
            return {
              ...prev,
              hosts: {
                ...prev.hosts,
                [nextHost]: {},
              },
            }
          },
        )
        void queryClient.invalidateQueries({ queryKey: ["hostSetupConfig", props.projectId] })
        props.onSelectHost(nextHost)
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const onGenerateHost = () => {
    try {
      const generated = generateRandomHostName({ existingHosts: hosts })
      setNewHost(generated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <SettingsSection
      title="Host setup"
      description="Select an existing host or add a new one for this project."
    >
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
              return (
                <button
                  key={host}
                  type="button"
                  onClick={() => props.onSelectHost(host)}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/20"
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
            <InputGroup>
              <InputGroupInput
                id="setup-new-host"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                placeholder="clawlets-prod-01"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="secondary"
                  disabled={addHostMutation.isPending}
                  onClick={onGenerateHost}
                >
                  <ArrowPathIcon />
                  Generate
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AsyncButton
              type="button"
              disabled={addHostMutation.isPending || !newHost.trim()}
              pending={addHostMutation.isPending}
              pendingText="Adding..."
              onClick={() => addHostMutation.mutate()}
            >
              Add host
            </AsyncButton>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
