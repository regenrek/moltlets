import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { getClawdletsConfig, writeClawdletsConfigFile } from "~/sdk/config"

export const Route = createFileRoute("/projects/$projectId/setup/providers")({
  component: ProvidersSetup,
})

function ProvidersSetup() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])

  const [guildId, setGuildId] = useState("")
  const [botDiscordSecrets, setBotDiscordSecrets] = useState<Record<string, string>>({})
  const [modelSecrets, setModelSecrets] = useState<Array<{ key: string; secret: string }>>([])

  useEffect(() => {
    if (!config) return
    setGuildId(config.fleet.guildId || "")
    const nextBotSecrets: Record<string, string> = {}
    for (const botId of bots) {
      nextBotSecrets[botId] = (config.fleet.bots as any)?.[botId]?.profile?.discordTokenSecret || ""
    }
    setBotDiscordSecrets(nextBotSecrets)
    const entries = Object.entries((config.fleet.modelSecrets || {}) as Record<string, string>)
    setModelSecrets(entries.map(([key, secret]) => ({ key, secret })))
  }, [bots, config])

  const save = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")

      const nextModelSecrets: Record<string, string> = {}
      for (const row of modelSecrets) {
        const k = row.key.trim()
        const v = row.secret.trim()
        if (!k) continue
        nextModelSecrets[k] = v
      }

      const nextBots: Record<string, any> = { ...(config.fleet.bots as any) }
      for (const botId of bots) {
        const existing = nextBots[botId] || {}
        nextBots[botId] = {
          ...existing,
          profile: {
            ...(existing.profile || {}),
            discordTokenSecret: (botDiscordSecrets[botId] || "").trim(),
          },
        }
      }

      const next = {
        ...config,
        fleet: {
          ...config.fleet,
          guildId: guildId.trim(),
          modelSecrets: nextModelSecrets,
          bots: nextBots,
        },
      }

      return await writeClawdletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next, title: "Update providers" },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
      } else toast.error("Validation failed")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Providers</h1>
      <p className="text-muted-foreground">
        Configure provider integrations (Discord v1).
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Discord</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="guild">Guild ID</Label>
                <Input id="guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} />
                <div className="text-xs text-muted-foreground">
                  Stored as <code>fleet.guildId</code>.
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Per-bot discordTokenSecret</div>
              <div className="text-xs text-muted-foreground">
                Secret names only. Tokens stay on disk.
              </div>
              <div className="grid gap-3">
                {bots.length === 0 ? (
                  <div className="text-muted-foreground">No bots.</div>
                ) : (
                  bots.map((botId) => (
                    <div key={botId} className="grid gap-2 md:grid-cols-[180px_1fr] items-center">
                      <div className="text-sm font-medium">{botId}</div>
                      <Input
                        value={botDiscordSecrets[botId] || ""}
                        onChange={(e) =>
                          setBotDiscordSecrets((prev) => ({ ...prev, [botId]: e.target.value }))
                        }
                        placeholder={`discord_token_${botId}`}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="font-medium">Model providers</div>
            <div className="text-xs text-muted-foreground">
              Stored as <code>fleet.modelSecrets</code> (provider key → secret name).
            </div>
            <div className="grid gap-3">
              {modelSecrets.length === 0 ? (
                <div className="text-muted-foreground">No model secrets configured.</div>
              ) : null}
              {modelSecrets.map((row, idx) => (
                <div key={`${idx}-${row.key}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-center">
                  <Input
                    value={row.key}
                    onChange={(e) =>
                      setModelSecrets((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                      )
                    }
                    placeholder="zai"
                  />
                  <Input
                    value={row.secret}
                    onChange={(e) =>
                      setModelSecrets((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, secret: e.target.value } : r)),
                      )
                    }
                    placeholder="z_ai_api_key"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModelSecrets((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => setModelSecrets((prev) => [...prev, { key: "", secret: "" }])}
              >
                Add provider secret
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              Save providers
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })}
            >
              Reload
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
