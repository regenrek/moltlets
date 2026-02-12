"use client"

import * as React from "react"
import { cn } from "~/lib/utils"

type Orientation = "horizontal" | "vertical"
type ActivationMode = "automatic" | "manual"

type StepperContextValue = {
  id: string
  orientation: Orientation
  activationMode: ActivationMode
  disabled: boolean
  nonInteractive: boolean
  value: string
  setValue: (value: string) => void
}

const StepperContext = React.createContext<StepperContextValue | null>(null)

function useStepperContext(consumer: string): StepperContextValue {
  const ctx = React.useContext(StepperContext)
  if (!ctx) throw new Error(`\`${consumer}\` must be used within \`Stepper\``)
  return ctx
}

type StepperItemContextValue = {
  value: string
  completed: boolean
  disabled: boolean
  index: number
}

const StepperItemContext = React.createContext<StepperItemContextValue | null>(null)

function useStepperItemContext(consumer: string): StepperItemContextValue {
  const ctx = React.useContext(StepperItemContext)
  if (!ctx) throw new Error(`\`${consumer}\` must be used within \`StepperItem\``)
  return ctx
}

function useControllableValue(params: {
  value: string | undefined
  defaultValue: string
  onChange: ((next: string) => void) | undefined
}): [string, (next: string) => void] {
  const [internal, setInternal] = React.useState(params.defaultValue)
  const current = params.value !== undefined ? params.value : internal
  const set = React.useCallback(
    (next: string) => {
      if (params.value === undefined) setInternal(next)
      params.onChange?.(next)
    },
    [params.onChange, params.value],
  )
  return [current, set]
}

export type StepperProps = React.ComponentProps<"div"> & {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  orientation?: Orientation
  activationMode?: ActivationMode
  disabled?: boolean
  nonInteractive?: boolean
}

function Stepper(props: StepperProps) {
  const {
    value,
    defaultValue = "",
    onValueChange,
    orientation = "horizontal",
    activationMode = "automatic",
    disabled = false,
    nonInteractive = false,
    className,
    children,
    ...divProps
  } = props

  const reactId = React.useId()
  const [current, setCurrent] = useControllableValue({
    value,
    defaultValue,
    onChange: onValueChange,
  })

  const ctx = React.useMemo<StepperContextValue>(
    () => ({
      id: divProps.id ?? reactId,
      orientation,
      activationMode,
      disabled,
      nonInteractive,
      value: current,
      setValue: setCurrent,
    }),
    [activationMode, current, disabled, divProps.id, nonInteractive, orientation, reactId, setCurrent],
  )

  return (
    <StepperContext.Provider value={ctx}>
      <div
        {...divProps}
        id={ctx.id}
        data-orientation={orientation}
        className={cn(
          "flex gap-6",
          orientation === "vertical" ? "flex-col" : "flex-row items-start",
          className,
        )}
      >
        {children}
      </div>
    </StepperContext.Provider>
  )
}

type StepperListProps = React.ComponentProps<"div">

function StepperList(props: StepperListProps) {
  const ctx = useStepperContext("StepperList")
  const { className, children, ...divProps } = props

  const mapped = React.Children.map(children, (child, idx) => {
    if (!React.isValidElement(child)) return child
    // Only inject index into StepperItem
    if ((child.type as any)?.displayName !== "StepperItem") return child
    return React.cloneElement(child, { __index: idx + 1 } as any)
  })

  return (
    <div
      {...divProps}
      role="tablist"
      aria-orientation={ctx.orientation}
      data-orientation={ctx.orientation}
      className={cn(
        "relative",
        ctx.orientation === "vertical" ? "flex flex-col" : "flex flex-row items-center gap-2",
        className,
      )}
    >
      {mapped}
    </div>
  )
}

type StepperItemProps = React.ComponentProps<"div"> & {
  value: string
  completed?: boolean
  disabled?: boolean
  // internal, injected by StepperList
  __index?: number
}

function StepperItem(props: StepperItemProps) {
  const { value, completed = false, disabled = false, __index = 0, className, children, ...divProps } = props
  const ctx = useStepperContext("StepperItem")
  const active = ctx.value === value
  const dataState = completed ? "completed" : active ? "active" : "inactive"

  return (
    <StepperItemContext.Provider value={{ value, completed, disabled, index: __index }}>
      <div
        {...divProps}
        data-state={dataState}
        data-disabled={disabled ? "" : undefined}
        className={cn(
          "relative isolate",
          ctx.orientation === "vertical" ? "flex items-start gap-3" : "flex-1",
          className,
        )}
      >
        {children}
      </div>
    </StepperItemContext.Provider>
  )
}

type StepperTriggerProps = React.ComponentProps<"button">

function StepperTrigger(props: StepperTriggerProps) {
  const ctx = useStepperContext("StepperTrigger")
  const item = useStepperItemContext("StepperTrigger")
  const { className, onClick, onFocus, ...buttonProps } = props

  const triggerId = `${ctx.id}-trigger-${item.value}`
  const contentId = `${ctx.id}-content-${item.value}`
  const isActive = ctx.value === item.value
  const isDisabled = ctx.disabled || item.disabled

  return (
    <button
      {...buttonProps}
      id={triggerId}
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={contentId}
      disabled={isDisabled}
      data-state={item.completed ? "completed" : isActive ? "active" : "inactive"}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        if (ctx.nonInteractive || isDisabled) return
        ctx.setValue(item.value)
      }}
      onFocus={(e) => {
        onFocus?.(e)
        if (e.defaultPrevented) return
        if (ctx.nonInteractive || isDisabled) return
        if (ctx.activationMode === "automatic") ctx.setValue(item.value)
      }}
      className={cn(
        "inline-flex w-full items-start gap-3 text-left text-zinc-900 focus-visible:outline-none dark:text-zinc-100 disabled:pointer-events-none disabled:text-zinc-500 dark:disabled:text-zinc-400",
        className,
      )}
    />
  )
}

type StepperIndicatorProps = React.ComponentProps<"div"> & {
  children?: React.ReactNode | ((state: "inactive" | "active" | "completed") => React.ReactNode)
}

function StepperIndicator(props: StepperIndicatorProps) {
  const item = useStepperItemContext("StepperIndicator")
  const ctx = useStepperContext("StepperIndicator")
  const { className, children, ...divProps } = props

  const state = item.completed ? "completed" : ctx.value === item.value ? "active" : "inactive"

  return (
    <div
      {...divProps}
      data-state={state}
      data-disabled={item.disabled ? "true" : "false"}
      className={cn(
        "relative isolate z-20 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-zinc-50 text-sm font-medium transition-colors dark:bg-zinc-950",
        "data-[state=active]:border-highlight data-[state=active]:bg-highlight data-[state=active]:text-highlight-foreground",
        "data-[state=completed]:border-highlight data-[state=completed]:bg-highlight data-[state=completed]:text-highlight-foreground",
        "data-[state=inactive]:border-zinc-300 data-[state=inactive]:bg-zinc-50 data-[state=inactive]:text-zinc-500 dark:data-[state=inactive]:border-zinc-700 dark:data-[state=inactive]:bg-zinc-950 dark:data-[state=inactive]:text-zinc-400",
        "data-[disabled=true]:border-zinc-300 data-[disabled=true]:bg-zinc-200 data-[disabled=true]:text-zinc-500 dark:data-[disabled=true]:border-zinc-700 dark:data-[disabled=true]:bg-zinc-900 dark:data-[disabled=true]:text-zinc-500",
        className,
      )}
    >
      {typeof children === "function"
        ? children(state)
        : children ?? item.index ?? "•"}
    </div>
  )
}

type StepperSeparatorProps = React.ComponentProps<"div">

function StepperSeparator(props: StepperSeparatorProps) {
  const ctx = useStepperContext("StepperSeparator")
  const item = useStepperItemContext("StepperSeparator")
  const { className, ...divProps } = props
  const state = item.completed ? "completed" : ctx.value === item.value ? "active" : "inactive"

  return (
    <div
      {...divProps}
      role="separator"
      aria-orientation={ctx.orientation}
      data-state={state}
      className={cn(
        "bg-zinc-300 transition-colors data-[state=completed]:bg-primary dark:bg-zinc-700",
        ctx.orientation === "vertical" ? "h-full w-0.5" : "h-0.5 w-full flex-1",
        className,
      )}
    />
  )
}

type StepperTitleProps = React.ComponentProps<"span">

function StepperTitle(props: StepperTitleProps) {
  const { className, ...spanProps } = props
  return <span {...spanProps} className={cn("text-sm font-medium", className)} />
}

type StepperDescriptionProps = React.ComponentProps<"span">

function StepperDescription(props: StepperDescriptionProps) {
  const { className, ...spanProps } = props
  return <span {...spanProps} className={cn("text-xs text-muted-foreground", className)} />
}

type StepperContentProps = React.ComponentProps<"div"> & {
  value: string
  forceMount?: boolean
}

function StepperContent(props: StepperContentProps) {
  const ctx = useStepperContext("StepperContent")
  const { value, forceMount = false, className, children, ...divProps } = props
  const active = ctx.value === value
  if (!active && !forceMount) return null

  return (
    <div
      {...divProps}
      id={`${ctx.id}-content-${value}`}
      role="tabpanel"
      aria-labelledby={`${ctx.id}-trigger-${value}`}
      data-state={active ? "active" : "inactive"}
      className={cn(className)}
    >
      {children}
    </div>
  )
}

StepperItem.displayName = "StepperItem"

export {
  Stepper,
  StepperList,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperDescription,
  StepperContent,
}
