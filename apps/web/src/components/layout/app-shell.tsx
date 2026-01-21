import * as React from "react"
import { AppHeader } from "~/components/layout/app-header"
import { AppSidebar } from "~/components/layout/app-sidebar"

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppSidebar>
      <div className="h-screen min-h-0 flex flex-col">
        <AppHeader />
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
            {children}
          </div>
        </main>
      </div>
    </AppSidebar>
  )
}

export { AppShell }

