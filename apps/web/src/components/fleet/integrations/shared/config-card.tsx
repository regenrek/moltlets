import type { ReactNode } from "react"

export function ConfigCard(props: { title: string; configPath: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <div className="font-medium">{props.title}</div>
        <div className="text-xs text-muted-foreground">
          Stored as <code>{props.configPath}</code>.
        </div>
      </div>
      {props.children}
    </div>
  )
}
