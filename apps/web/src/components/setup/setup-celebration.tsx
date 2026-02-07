import { Link } from "@tanstack/react-router"
import { Button } from "~/components/ui/button"

export function SetupCelebration(props: {
  title: string
  description: string
  primaryLabel: string
  primaryTo: string
  secondaryLabel: string
  secondaryTo: string
}) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-black tracking-tight">{props.title}</h2>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          nativeButton={false}
          render={<Link to={props.primaryTo} />}
        >
          {props.primaryLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          nativeButton={false}
          render={<Link to={props.secondaryTo} />}
        >
          {props.secondaryLabel}
        </Button>
      </div>
    </div>
  )
}
