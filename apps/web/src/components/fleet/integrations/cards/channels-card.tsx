import { useState } from "react"
import type { ChannelUiModel } from "@clawlets/core/lib/channel-ui-metadata"
import { Switch } from "~/components/ui/switch"
import { ConfigCard } from "../shared/config-card"
import { buildGatewayConfigPath } from "../shared/config-path"
import { isPlainObject } from "../helpers"
import { TextListField } from "../shared/text-list-field"

export function ChannelsConfigCard(props: {
  botId: string
  channels: unknown
  channelModels: ChannelUiModel[]
  canEdit: boolean
  pending: boolean
  onToggleChannel: (params: { channelId: string; enabled: boolean }) => void
  onSaveAllowFrom: (params: { channelId: string; allowFrom: string[] }) => void
}) {
  const channelsObj = isPlainObject(props.channels) ? (props.channels as Record<string, unknown>) : {}
  const [allowFromByChannel, setAllowFromByChannel] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    for (const channel of props.channelModels) {
      if (!channel.allowFrom) continue
      const entry = channelsObj[channel.id]
      const allowFrom = isPlainObject(entry) ? entry["allowFrom"] : undefined
      const text = Array.isArray(allowFrom) ? allowFrom.map(String).join("\n") : ""
      next[channel.id] = text
    }
    return next
  })

  return (
    <ConfigCard title="Channels config (first-class)" configPath={buildGatewayConfigPath(props.botId, "channels")}>
      <div className="grid gap-4 md:grid-cols-2">
        {props.channelModels.map((channel) => {
          const entry = channelsObj[channel.id]
          const enabled = !isPlainObject(entry) || entry["enabled"] !== false
          const allowFromText = allowFromByChannel[channel.id] ?? ""

          return (
            <div key={channel.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{channel.name}</div>
                {channel.supportsEnabled ? (
                  <Switch
                    checked={enabled}
                    disabled={!props.canEdit || props.pending}
                    onCheckedChange={(checked) => props.onToggleChannel({ channelId: channel.id, enabled: checked })}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground">No enable toggle in schema</div>
                )}
              </div>
              {channel.helpText ? <div className="text-xs text-muted-foreground">{channel.helpText}</div> : null}
              {channel.allowFrom ? (
                <TextListField
                  label="allowFrom (one per line)"
                  value={allowFromText}
                  disabled={!props.canEdit}
                  pending={props.pending}
                  buttonLabel={`Save ${channel.name} allowFrom`}
                  onChange={(value) =>
                    setAllowFromByChannel((prev) => ({
                      ...prev,
                      [channel.id]: value,
                    }))
                  }
                  onSave={(allowFrom) => props.onSaveAllowFrom({ channelId: channel.id, allowFrom })}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </ConfigCard>
  )
}
