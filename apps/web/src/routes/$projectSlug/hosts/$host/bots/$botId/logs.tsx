import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/bots/$botId/logs")({
  component: BotLogs,
})

function BotLogs() {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      Logs placeholder. Hook in run log tail / agent logs here.
    </div>
  )
}
