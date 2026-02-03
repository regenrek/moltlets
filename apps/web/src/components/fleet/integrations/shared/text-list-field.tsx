import { Button } from "~/components/ui/button"
import { parseTextList } from "../helpers"

export function TextListField(props: {
  label: string
  value: string
  disabled: boolean
  pending: boolean
  minRows?: number
  buttonLabel?: string
  onChange: (value: string) => void
  onSave: (entries: string[]) => void
}) {
  const minRows = props.minRows ?? 4
  const minHeight = `${Math.max(1, minRows) * 24}px`

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <textarea
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        style={{ minHeight }}
        value={props.value}
        disabled={props.disabled || props.pending}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled || props.pending}
        onClick={() => props.onSave(parseTextList(props.value))}
      >
        {props.buttonLabel ?? "Save"}
      </Button>
    </div>
  )
}
