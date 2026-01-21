import { createFileRoute, Link } from "@tanstack/react-router"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { Button } from "~/components/ui/button"

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Clawdlets</h1>
        <p className="text-muted-foreground mt-2 max-w-prose">
          Self-hosted UI for bootstrapping and operating a Clawdbot fleet. Start
          by creating or importing a project repository.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link to="/projects/new" />}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Create Project
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/projects" />}
        >
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} />
          View Projects
        </Button>
      </div>
    </div>
  )
}
