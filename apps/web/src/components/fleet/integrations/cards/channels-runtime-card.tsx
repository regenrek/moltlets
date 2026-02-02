import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import type { ChannelUiModel } from "@clawlets/core/lib/channel-ui-metadata"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { serverChannelsExecute, serverChannelsStart } from "~/sdk/server-channels"

export function ChannelsRuntimeCard(props: {
  projectId: string
  botId: string
  host: string
  canEdit: boolean
  channelModels: ChannelUiModel[]
  enabledChannels: string[]
}) {
  const [runId, setRunId] = useState<Id<"runs"> | null>(null)

  const runChannels = useMutation({
    mutationFn: async (params: { op: "status" | "login" | "logout"; channel?: string; probe?: boolean; verbose?: boolean }) => {
      if (!props.host.trim()) throw new Error("missing host")
      const started = await serverChannelsStart({
        data: {
          projectId: props.projectId as Id<"projects">,
          host: props.host,
          botId: props.botId,
          op: params.op,
        },
      })
      return { runId: started.runId, params }
    },
    onSuccess: (res) => {
      setRunId(res.runId)
      void serverChannelsExecute({
        data: {
          projectId: props.projectId as Id<"projects">,
          runId: res.runId,
          host: props.host,
          botId: props.botId,
          op: res.params.op,
          channel: res.params.channel || "",
          account: "",
          target: "",
          timeout: "10000",
          json: false,
          probe: Boolean(res.params.probe),
          verbose: Boolean(res.params.verbose),
        },
      })
      toast.info(`Started channels ${res.params.op}`)
    },
    onError: (err) => toast.error(String(err)),
  })

  const runtimeChannels = props.channelModels.filter((channel) => channel.runtimeOps.length > 0)

  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">Channels runtime</div>
        <div className="text-xs text-muted-foreground">Run status/login/logout for gateway channels.</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canEdit || runChannels.isPending || !props.host.trim()}
          onClick={() => runChannels.mutate({ op: "status", probe: true })}
        >
          Channels status
        </Button>
        {runtimeChannels.flatMap((channel) =>
          channel.runtimeOps.map((op) => {
            const enabled = props.enabledChannels.includes(channel.id)
            const label = `${channel.name} ${op}`
            return (
              <Button
                key={`${channel.id}:${op}`}
                size="sm"
                variant="outline"
                disabled={!props.canEdit || runChannels.isPending || !enabled || !props.host.trim()}
                onClick={() =>
                  runChannels.mutate({
                    op,
                    channel: channel.id,
                    verbose: op === "login",
                  })
                }
              >
                {label}
              </Button>
            )
          }),
        )}
        {!props.host.trim() ? (
          <span className="text-xs text-muted-foreground">
            Set <code>defaultHost</code> to run host operations.
          </span>
        ) : null}
      </div>

      {runId ? <RunLogTail runId={runId} /> : null}
    </div>
  )
}
