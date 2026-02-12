import type { ReactNode } from "react"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card"
import { cn } from "~/lib/utils"

interface SettingsSectionProps {
  title: string
  description?: ReactNode
  children: ReactNode
  statusText?: ReactNode
  actions?: ReactNode
  className?: string
  headerBadge?: ReactNode
}

export function SettingsSection({
  title,
  description,
  children,
  statusText,
  actions,
  className,
  headerBadge,
}: SettingsSectionProps) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {headerBadge ? <CardAction>{headerBadge}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {(statusText || actions) && (
        <CardFooter className="justify-between gap-4">
          <div className="text-sm text-muted-foreground">{statusText}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </CardFooter>
      )}
    </Card>
  )
}
