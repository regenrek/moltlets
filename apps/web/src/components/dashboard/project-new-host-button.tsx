import { ArrowPathIcon, PlusIcon } from "@heroicons/react/24/outline"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { generateHostName as generateRandomHostName } from "@clawlets/core/lib/host/host-name-generator"
import { useState } from "react"
import { toast } from "sonner"
import { convexQuery } from "@convex-dev/react-query"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { addHost } from "~/sdk/config"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { Label } from "~/components/ui/label"

type HostCreateFlow = "default" | "first_host"

export function ProjectNewHostButton(props: {
  projectId: Id<"projects">
  projectSlug: string
  hosts: string[]
  runnerOnline: boolean
  flow?: HostCreateFlow
  label?: string
  size?: "default" | "sm" | "lg" | "icon"
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link"
  className?: string
  disabled?: boolean
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [newHost, setNewHost] = useState("")

  const flow = props.flow ?? "default"
  const label = props.label ?? "New Host"
  const hostsQuerySpec = convexQuery(api.controlPlane.hosts.listByProject, { projectId: props.projectId })

  const addHostMutation = useMutation({
    mutationFn: async () => {
      if (!props.runnerOnline) throw new Error("Runner offline. Start runner first.")
      const trimmed = newHost.trim()
      if (!trimmed) throw new Error("Host name required")
      if (props.hosts.includes(trimmed)) {
        return { ok: true as const, queued: false as const, alreadyExists: true as const }
      }
      return await addHost({ data: { projectId: props.projectId, host: trimmed } })
    },
    onSuccess: (result) => {
      if (result.queued) toast.success("Host add queued. Runner still processing.")
      else if (result.alreadyExists) toast.success("Host already exists")
      else toast.success("Host added")

      const createdHost = newHost.trim()
      setNewHost("")
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: hostsQuerySpec.queryKey })

      if (flow === "first_host" && createdHost.length > 0 && !result.queued) {
        void router.navigate({
          to: "/$projectSlug/hosts/$host/setup",
          params: { projectSlug: props.projectSlug, host: createdHost },
          search: { step: "infrastructure" },
        } as any)
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const onGenerateHost = () => {
    try {
      const generated = generateRandomHostName({ existingHosts: props.hosts })
      setNewHost(generated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Button
        type="button"
        size={props.size}
        variant={props.variant}
        className={props.className}
        disabled={props.disabled}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New host</DialogTitle>
            <DialogDescription>
              Add a host entry to your fleet config.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-host-name">Host name</Label>
            <InputGroup>
              <InputGroupInput
                id="new-host-name"
                placeholder="clawlets-prod-01"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="secondary"
                  disabled={addHostMutation.isPending}
                  onClick={onGenerateHost}
                >
                  <ArrowPathIcon />
                  Generate
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <AsyncButton
              type="button"
              disabled={addHostMutation.isPending || !newHost.trim() || !props.runnerOnline}
              pending={addHostMutation.isPending}
              pendingText="Adding host..."
              onClick={() => addHostMutation.mutate()}
            >
              Add host
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
