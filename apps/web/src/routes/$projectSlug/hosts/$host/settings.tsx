import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/$projectSlug/hosts/$host/settings")({
  component: HostSettingsLayout,
})

function HostSettingsLayout() {
  return <Outlet />
}
