import type * as React from "react"
import { Button } from "~/components/ui/button"
import { Spinner } from "~/components/ui/spinner"
import { cn } from "~/lib/utils"

type AsyncButtonProps = React.ComponentProps<typeof Button> & {
  pending?: boolean
  pendingText?: React.ReactNode
  spinnerClassName?: string
}

function AsyncButton({
  pending = false,
  pendingText,
  spinnerClassName,
  disabled,
  children,
  ...props
}: AsyncButtonProps) {
  return (
    <Button
      aria-busy={pending || undefined}
      disabled={Boolean(disabled) || pending}
      {...props}
    >
      {pending ? <Spinner data-icon="inline-start" className={cn("size-3.5", spinnerClassName)} /> : null}
      {pending ? (pendingText ?? children) : children}
    </Button>
  )
}

export { AsyncButton }
export type { AsyncButtonProps }
