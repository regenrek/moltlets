import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The page you are looking for moved or does not exist.
      </p>
      <div className="mt-6">
        <Link className="text-sm font-medium underline" to="/">
          Back to home
        </Link>
      </div>
    </div>
  )
}
