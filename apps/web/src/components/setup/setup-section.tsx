import { AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { Badge } from "~/components/ui/badge"
import { cn } from "~/lib/utils"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type * as React from "react"

function statusLabel(status: SetupStepStatus): string {
  if (status === "done") return "Complete"
  if (status === "active") return "In progress"
  if (status === "pending") return "Pending"
  return "Locked"
}

function statusVariant(status: SetupStepStatus): "secondary" | "outline" {
  return status === "done" ? "secondary" : "outline"
}

export function SetupSection(props: {
  value: string
  index: number
  title: string
  status: SetupStepStatus
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={props.value} className="rounded-lg border bg-card !border-b-0">
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex w-full items-center justify-between gap-3 pr-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-medium">
              {props.index}. {props.title}
            </span>
          </div>
          <Badge variant={statusVariant(props.status)} className={cn("shrink-0", props.status === "active" && "bg-muted/30")}>
            {statusLabel(props.status)}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 pt-1">
        {props.children}
      </AccordionContent>
    </AccordionItem>
  )
}
