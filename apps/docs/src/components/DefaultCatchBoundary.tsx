import { Link } from '@tanstack/react-router'

export function DefaultCatchBoundary({ error }: { error: Error }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Unexpected error</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {error.message || 'Try again in a moment.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link className="text-sm font-medium underline" to="/">
          Back to home
        </Link>
      </div>
    </div>
  )
}
