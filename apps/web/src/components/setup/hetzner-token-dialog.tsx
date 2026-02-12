import type { Id } from "../../../convex/_generated/dataModel"
import { DeployCredsCard } from "~/components/fleet/deploy-creds-card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"

export function HetznerTokenDialog(props: {
  projectId: Id<"projects">
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Hetzner API token</DialogTitle>
          <DialogDescription>
            Set <code>HCLOUD_TOKEN</code> for this project setup flow. Use a dedicated Hetzner project/token for each
            Clawlets project when possible.
          </DialogDescription>
        </DialogHeader>

        <DeployCredsCard
          projectId={props.projectId}
          title="Hetzner API token"
          description={(
            <>
              Local-only credential in <code>.clawlets/env</code>.{" "}
              <a
                className="underline underline-offset-3 hover:text-foreground"
                href="https://docs.clawlets.com/dashboard/hetzner-token"
                target="_blank"
                rel="noreferrer"
              >
                Open Hetzner token guide
              </a>
              .
            </>
          )}
          visibleKeys={["HCLOUD_TOKEN"]}
        />
      </DialogContent>
    </Dialog>
  )
}
