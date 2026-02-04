import * as React from "react"
import { Link } from "@tanstack/react-router"
import { cn } from "~/lib/utils"

type EntityStatusTone = "neutral" | "positive" | "warning" | "danger"

const STATUS_DOT_TONES: Record<EntityStatusTone, string> = {
  neutral: "bg-muted-foreground/40",
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
}

const STATUS_PILL_TONES: Record<EntityStatusTone, string> = {
  neutral: "border-muted-foreground/30 text-muted-foreground",
  positive: "border-emerald-500/30 text-emerald-600 bg-emerald-500/10",
  warning: "border-amber-500/30 text-amber-600 bg-amber-500/10",
  danger: "border-rose-500/30 text-rose-600 bg-rose-500/10",
}

type EntityRowStatus = {
  label: React.ReactNode
  tone?: EntityStatusTone
}

type EntityRowColumn = {
  label?: React.ReactNode
  value?: React.ReactNode
  align?: "start" | "end"
  className?: string
  interactive?: boolean
}

type EntityRowProps = {
  href?: string
  ariaLabel?: string
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  status?: EntityRowStatus
  columns?: EntityRowColumn[]
  meta?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
}

function EntityStatusDot({
  tone = "neutral",
  className,
}: {
  tone?: EntityStatusTone
  className?: string
}) {
  return <span className={cn("size-2 rounded-full", STATUS_DOT_TONES[tone], className)} />
}

function EntityStatusPill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: EntityStatusTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        STATUS_PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

function EntityRow({
  href,
  ariaLabel,
  leading,
  title,
  subtitle,
  status,
  columns = [],
  meta,
  trailing,
  className,
}: EntityRowProps) {
  const hasTrailing = Boolean(meta || trailing)
  const layoutColumns = React.useMemo(() => {
    const template = [
      "minmax(0, 2fr)",
      ...columns.map(() => "minmax(0, 1fr)"),
      hasTrailing ? "auto" : null,
    ].filter(Boolean)
    return template.join(" ")
  }, [columns, hasTrailing])

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card transition-colors hover:bg-muted/30",
        className,
      )}
    >
      <div
        className="pointer-events-none relative z-20 grid grid-cols-1 items-center gap-3 px-4 py-3 md:[grid-template-columns:var(--entity-row-columns)]"
        style={{ ["--entity-row-columns" as any]: layoutColumns }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {leading ? <div className="shrink-0">{leading}</div> : null}
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-medium">{title}</div>
              {status ? (
                <EntityStatusPill tone={status.tone ?? "neutral"}>
                  {status.label}
                </EntityStatusPill>
              ) : null}
            </div>
            {subtitle ? (
              <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
            ) : null}
          </div>
        </div>

        {columns.map((column, index) => (
          <div
            key={index}
            className={cn(
              "min-w-0 space-y-1",
              column.align === "end" ? "text-right" : "text-left",
              column.interactive && "pointer-events-auto",
              column.className,
            )}
          >
            {column.label ? (
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {column.label}
              </div>
            ) : null}
            <div className="truncate text-sm">{column.value ?? "—"}</div>
          </div>
        ))}

        {hasTrailing ? (
          <div className="pointer-events-auto flex min-w-0 items-center justify-end gap-2">
            {meta ? (
              <div className="text-xs text-muted-foreground truncate">{meta}</div>
            ) : null}
            {trailing ? <div className="shrink-0">{trailing}</div> : null}
          </div>
        ) : null}
      </div>

      {href ? (
        <Link
          to={href}
          aria-label={ariaLabel || (typeof title === "string" ? title : "Open")}
          className="absolute inset-0 z-10 rounded-xl transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      ) : null}
    </div>
  )
}

export { EntityRow, EntityStatusDot, EntityStatusPill }
export type { EntityRowColumn, EntityRowProps, EntityRowStatus, EntityStatusTone }
