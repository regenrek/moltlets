import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { getClawdletsConfig, addBot, removeBot } from "~/sdk/config"

export const Route = createFileRoute("/projects/$projectId/setup/bots")({
  component: BotsSetup,
})

function BotsSetup() {
  const { projectId } = Route.useParams()
  const queryClient = useQueryClient()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config
  const bots = useMemo(() => (config?.fleet?.botOrder as string[]) || [], [config])

  const [newBot, setNewBot] = useState("")
  const addBotMutation = useMutation({
    mutationFn: async () => await addBot({ data: { projectId: projectId as Id<"projects">, bot: newBot } }),
    onSuccess: () => {
      toast.success("Bot added")
      setNewBot("")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
  })

  const rmBotMutation = useMutation({
    mutationFn: async (bot: string) => await removeBot({ data: { projectId: projectId as Id<"projects">, bot } }),
    onSuccess: () => {
      toast.success("Bot removed")
      void queryClient.invalidateQueries({ queryKey: ["clawdletsConfig", projectId] })
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Bots</h1>
      <p className="text-muted-foreground">
        Add/remove bots and configure per-bot settings.
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-3">
            <div className="font-medium">Add bot</div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium" htmlFor="newBot">
                  Bot id
                </label>
                <Input id="newBot" value={newBot} onChange={(e) => setNewBot(e.target.value)} placeholder="maren" />
              </div>
              <Button type="button" disabled={addBotMutation.isPending || !newBot.trim()} onClick={() => addBotMutation.mutate()}>
                Add
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Stored in <code>fleet.botOrder</code> and <code>fleet.bots</code>.
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Bot roster</div>
                <div className="text-xs text-muted-foreground">{bots.length} bots</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/projects/$projectId/setup/providers" params={{ projectId }} />}
              >
                Providers
              </Button>
            </div>

            {bots.length === 0 ? (
              <div className="text-muted-foreground">No bots yet.</div>
            ) : (
              <div className="divide-y rounded-md border">
                {bots.map((botId) => {
                  const discordSecret = (config.fleet.bots as any)?.[botId]?.profile?.discordTokenSecret || ""
                  return (
                    <div key={botId} className="p-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{botId}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          discordTokenSecret: <code>{discordSecret || "(unset)"}</code>
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="sm" variant="destructive" type="button">
                              Remove
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove bot?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes <code>{botId}</code> from the roster and config.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => rmBotMutation.mutate(botId)}
                            >
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
