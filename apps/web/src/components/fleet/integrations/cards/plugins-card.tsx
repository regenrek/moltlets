import { useState } from "react"
import { Switch } from "~/components/ui/switch"
import { ConfigCard } from "../shared/config-card"
import { buildGatewayConfigPath } from "../shared/config-path"
import { isPlainObject } from "../helpers"
import { TextListField } from "../shared/text-list-field"

export function PluginsConfigCard(props: {
  botId: string
  plugins: unknown
  canEdit: boolean
  pending: boolean
  initialAllowText: string
  initialDenyText: string
  initialPathsText: string
  onToggleEnabled: (enabled: boolean) => void
  onSaveAllow: (allow: string[]) => void
  onSaveDeny: (deny: string[]) => void
  onSavePaths: (paths: string[]) => void
}) {
  const pluginsObj = isPlainObject(props.plugins) ? (props.plugins as Record<string, unknown>) : {}
  const pluginsEnabled = pluginsObj["enabled"] === true

  const [allowText, setAllowText] = useState(() => props.initialAllowText)
  const [denyText, setDenyText] = useState(() => props.initialDenyText)
  const [pathsText, setPathsText] = useState(() => props.initialPathsText)

  return (
    <ConfigCard title="Plugins config (first-class)" configPath={buildGatewayConfigPath(props.botId, "plugins")}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Enabled</div>
          <Switch
            checked={pluginsEnabled}
            disabled={!props.canEdit || props.pending}
            onCheckedChange={(checked) => props.onToggleEnabled(checked)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextListField
            label="allow (one per line)"
            value={allowText}
            disabled={!props.canEdit}
            pending={props.pending}
            buttonLabel="Save allow"
            onChange={setAllowText}
            onSave={props.onSaveAllow}
          />

          <TextListField
            label="deny (one per line)"
            value={denyText}
            disabled={!props.canEdit}
            pending={props.pending}
            buttonLabel="Save deny"
            onChange={setDenyText}
            onSave={props.onSaveDeny}
          />
        </div>

        <TextListField
          label="load.paths (one per line)"
          value={pathsText}
          disabled={!props.canEdit}
          pending={props.pending}
          buttonLabel="Save load paths"
          onChange={setPathsText}
          onSave={props.onSavePaths}
        />
      </div>
    </ConfigCard>
  )
}
