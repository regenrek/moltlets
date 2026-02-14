import {
  ErrorComponent,
  Link,
  rootRouteId,
  useMatch,
  useRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import type { MouseEvent } from "react"

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  const row = error as Record<string, unknown>
  if (typeof row.code === "number") return String(row.code)
  if (typeof row.code === "string") return row.code.trim()
  const cause = row.cause
  if (cause && typeof cause === "object") {
    const causeCode = (cause as Record<string, unknown>).code
    if (typeof causeCode === "number") return String(causeCode)
    if (typeof causeCode === "string") return causeCode.trim()
  }
  return ""
}

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter()
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  })
  const errorCode = readErrorCode(error)
  const showDisconnectHint = errorCode === "5" || errorCode === "1005"

  console.error(error)

  return (
    <div className="min-w-0 flex-1 p-4 flex flex-col items-center justify-center gap-6">
      <ErrorComponent error={error} />
      {showDisconnectHint ? (
        <div className="max-w-xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Connection dropped (error code {errorCode}). Check runner process logs for heartbeat/control-plane failures, then retry.
        </div>
      ) : null}
      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={() => {
            void router.invalidate()
          }}
          className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
        >
          Try Again
        </button>
        {isRoot ? (
          <Link
            to="/"
            className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
          >
            Home
          </Link>
        ) : (
          <Link
            to="/"
            className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded-sm text-white uppercase font-extrabold`}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              e.preventDefault()
              window.history.back()
            }}
          >
            Go Back
          </Link>
        )}
      </div>
    </div>
  )
}
