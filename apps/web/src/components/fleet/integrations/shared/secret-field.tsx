import { AsyncButton } from "~/components/ui/async-button"
import { Input } from "~/components/ui/input"

export function SecretField(props: {
  label: string
  value: string
  placeholder?: string
  disabled: boolean
  pending: boolean
  buttonLabel: string
  onChange: (value: string) => void
  onSave: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <Input
        value={props.value}
        disabled={props.disabled || props.pending}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
      <AsyncButton
        size="sm"
        variant="outline"
        disabled={props.disabled || props.pending}
        pending={props.pending}
        pendingText="Saving..."
        onClick={() => props.onSave(props.value)}
      >
        {props.buttonLabel}
      </AsyncButton>
    </div>
  )
}
