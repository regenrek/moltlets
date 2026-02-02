import { useState } from "react"
import { Switch } from "~/components/ui/switch"
import { ConfigCard } from "../shared/config-card"
import { buildBotConfigPath } from "../shared/config-path"
import { isPlainObject } from "../helpers"
import { SecretField } from "../shared/secret-field"

export function HooksConfigCard(props: {
  botId: string
  hooks: unknown
  canEdit: boolean
  pending: boolean
  initialTokenSecret: string
  initialGmailPushTokenSecret: string
  onToggleEnabled: (enabled: boolean) => void
  onSaveTokenSecret: (value: string) => void
  onSaveGmailPushTokenSecret: (value: string) => void
}) {
  const hooksObj = isPlainObject(props.hooks) ? (props.hooks as Record<string, unknown>) : {}
  const hooksEnabled = hooksObj["enabled"] === true

  const [tokenSecretText, setTokenSecretText] = useState(() => props.initialTokenSecret)
  const [gmailPushTokenSecretText, setGmailPushTokenSecretText] = useState(() => props.initialGmailPushTokenSecret)

  return (
    <ConfigCard title="Hooks config (first-class)" configPath={buildBotConfigPath(props.botId, "hooks")}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Enabled</div>
          <Switch
            checked={hooksEnabled}
            disabled={!props.canEdit || props.pending}
            onCheckedChange={(checked) => props.onToggleEnabled(checked)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SecretField
            label="tokenSecret (sops secret name)"
            value={tokenSecretText}
            placeholder="hooks_token"
            disabled={!props.canEdit}
            pending={props.pending}
            buttonLabel="Save tokenSecret"
            onChange={setTokenSecretText}
            onSave={props.onSaveTokenSecret}
          />

          <SecretField
            label="gmailPushTokenSecret (sops secret name)"
            value={gmailPushTokenSecretText}
            placeholder="hooks_gmail_push_token"
            disabled={!props.canEdit}
            pending={props.pending}
            buttonLabel="Save gmailPushTokenSecret"
            onChange={setGmailPushTokenSecretText}
            onSave={props.onSaveGmailPushTokenSecret}
          />
        </div>
      </div>
    </ConfigCard>
  )
}
