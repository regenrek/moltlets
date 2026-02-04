"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import {
  HOST_THEME_COLORS,
  HOST_THEME_DEFAULT_EMOJI,
  normalizeHostTheme,
  type HostTheme,
  type HostThemeColor,
} from "@clawlets/core/lib/host-theme"
import { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch } from "~/components/ui/emoji-picker"
import { Button } from "~/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"
import { cn } from "~/lib/utils"

const HOST_THEME_COLOR_LABELS: Record<HostThemeColor, string> = {
  slate: "Slate",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  emerald: "Emerald",
  amber: "Amber",
  rose: "Rose",
  sky: "Sky",
}

const HOST_THEME_COLOR_CLASSES: Record<
  HostThemeColor,
  { bg: string; text: string; border: string }
> = {
  slate: {
    bg: "bg-slate-500/15",
    text: "text-slate-700 dark:text-slate-200",
    border: "border-slate-500/30",
  },
  blue: {
    bg: "bg-blue-500/15",
    text: "text-blue-700 dark:text-blue-200",
    border: "border-blue-500/30",
  },
  indigo: {
    bg: "bg-indigo-500/15",
    text: "text-indigo-700 dark:text-indigo-200",
    border: "border-indigo-500/30",
  },
  violet: {
    bg: "bg-violet-500/15",
    text: "text-violet-700 dark:text-violet-200",
    border: "border-violet-500/30",
  },
  emerald: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-200",
    border: "border-emerald-500/30",
  },
  amber: {
    bg: "bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-200",
    border: "border-amber-500/30",
  },
  rose: {
    bg: "bg-rose-500/15",
    text: "text-rose-700 dark:text-rose-200",
    border: "border-rose-500/30",
  },
  sky: {
    bg: "bg-sky-500/15",
    text: "text-sky-700 dark:text-sky-200",
    border: "border-sky-500/30",
  },
}

function HostThemeBadge({
  theme,
  size = "sm",
  className,
}: {
  theme?: Partial<HostTheme> | null
  size?: "xs" | "sm" | "md"
  className?: string
}) {
  const resolved = normalizeHostTheme(theme)
  const sizeClasses =
    size === "xs"
      ? "size-5 text-[11px]"
      : size === "md"
        ? "size-8 text-sm"
        : "size-6 text-xs"
  const tone = HOST_THEME_COLOR_CLASSES[resolved.color]

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border font-medium",
        tone.bg,
        tone.text,
        tone.border,
        sizeClasses,
        className,
      )}
      aria-hidden="true"
    >
      {resolved.emoji}
    </span>
  )
}

function HostThemeSwatch({
  color,
  className,
}: {
  color: HostThemeColor
  className?: string
}) {
  const tone = HOST_THEME_COLOR_CLASSES[color]
  return (
    <span
      className={cn("inline-flex size-5 items-center justify-center rounded-full border", tone.bg, tone.border, className)}
      aria-hidden="true"
    />
  )
}

function HostThemeColorDropdown({
  value,
  onValueChange,
  className,
}: {
  value: HostThemeColor
  onValueChange: (value: HostThemeColor) => void
  className?: string
}) {
  const label = HOST_THEME_COLOR_LABELS[value]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className={cn("w-full justify-between", className)}>
            <span className="flex items-center gap-2">
              <HostThemeSwatch color={value} />
              <span className="text-sm">{label}</span>
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent className="w-[220px]" align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onValueChange(next as HostThemeColor)}
        >
          {HOST_THEME_COLORS.map((color) => (
            <DropdownMenuRadioItem key={color} value={color} className="flex items-center gap-2">
              <HostThemeSwatch color={color} />
              <span className="text-sm">{HOST_THEME_COLOR_LABELS[color]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HostThemeEmojiPicker({
  value,
  onValueChange,
  className,
  placeholder = "Choose emoji",
}: {
  value: string
  onValueChange: (value: string) => void
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const resolved = value.trim() || HOST_THEME_DEFAULT_EMOJI

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(triggerProps) => (
          <Button {...triggerProps} variant="outline" className={cn("w-full justify-between", className)}>
            <span className="flex items-center gap-2">
              <span className="text-base">{resolved}</span>
              <span className="text-sm text-muted-foreground">{placeholder}</span>
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="text-muted-foreground" />
          </Button>
        )}
      />
      <PopoverContent className="w-[320px] p-0" align="start">
        <EmojiPicker
          className="h-[320px]"
          onEmojiSelect={(emoji) => {
            onValueChange(emoji.emoji)
            setOpen(false)
          }}
        >
          <EmojiPickerSearch placeholder="Search emoji..." />
          <EmojiPickerContent />
          <EmojiPickerFooter />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  )
}

export {
  HostThemeBadge,
  HostThemeColorDropdown,
  HostThemeEmojiPicker,
  HostThemeSwatch,
  HOST_THEME_COLOR_LABELS,
  normalizeHostTheme,
}
export type { HostTheme, HostThemeColor }
