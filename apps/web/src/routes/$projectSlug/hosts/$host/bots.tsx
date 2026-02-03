import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/bots")({
  component: BotsLayout,
})

function BotsLayout() {
  return <Outlet />
}
