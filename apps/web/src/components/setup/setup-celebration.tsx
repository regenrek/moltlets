import { Link } from "@tanstack/react-router"
import { CheckCircleIcon, SparklesIcon } from "@heroicons/react/24/solid"
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
    <div className="relative overflow-hidden rounded-xl border bg-card p-6 space-y-4">
      <span className="absolute -top-4 -right-4 size-16 rounded-full bg-emerald-300/25 motion-safe:animate-ping motion-reduce:animate-none" />
      <div className="relative space-y-1">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900">
          <SparklesIcon className="size-3.5 text-emerald-700" />
          Setup complete
        </div>
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight">
          <CheckCircleIcon className="size-6 text-emerald-700" />
          {props.title}
        </h2>
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
