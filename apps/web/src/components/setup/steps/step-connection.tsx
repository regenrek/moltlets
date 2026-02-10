import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { AdminCidrField } from "~/components/hosts/admin-cidr-field"
import { LabelWithHelp } from "~/components/ui/label-help"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { configDotBatch } from "~/sdk/config/dot"
import { addProjectSshKeys } from "~/sdk/config/hosts"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

export function SetupStepConnection(props: {
  projectId: Id<"projects">
  config: any | null
  host: string
  stepStatus: SetupStepStatus
  onContinue: () => void
}) {
  const hostCfg = props.config?.hosts?.[props.host] || null
  const fleetSshKeys = Array.isArray(props.config?.fleet?.sshAuthorizedKeys)
    ? (props.config?.fleet?.sshAuthorizedKeys as string[])
    : []
  if (!hostCfg) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }
  return (
    <SetupStepConnectionForm
      key={props.host}
      projectId={props.projectId}
      host={props.host}
      hostCfg={hostCfg}
      fleetSshKeys={fleetSshKeys}
      stepStatus={props.stepStatus}
      onContinue={props.onContinue}
    />
  )
}

function SetupStepConnectionForm(props: {
  projectId: Id<"projects">
  host: string
  hostCfg: any
  fleetSshKeys: string[]
  stepStatus: SetupStepStatus
  onContinue: () => void
}) {
  const queryClient = useQueryClient()
  const [adminCidr, setAdminCidr] = useState(() => String(props.hostCfg?.provisioning?.adminCidr || ""))
  const [keyText, setKeyText] = useState("")

  const canSave = useMemo(() => {
    if (!props.host.trim()) return false
    if (!adminCidr.trim()) return false
    if (props.fleetSshKeys.length === 0 && !keyText.trim()) return false
    return true
  }, [adminCidr, keyText, props.fleetSshKeys.length, props.host])

  const save = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      if (props.fleetSshKeys.length === 0 && !keyText.trim()) {
        throw new Error("Add at least one SSH public key to continue.")
      }
      if (keyText.trim()) {
        const res = await addProjectSshKeys({
          data: {
            projectId: props.projectId,
            keyText,
            knownHostsText: "",
          },
        })
        if (!res.ok) {
          throw new Error("Failed to save SSH keys.")
        }
      }
      const ops = [
        { path: `hosts.${props.host}.provisioning.adminCidr`, value: adminCidr.trim() },
        // Day-0 bootstrap requires public SSH. We set this automatically during setup,
        // but avoid overwriting once the step is already marked done.
        ...(props.stepStatus === "done"
          ? []
          : [{ path: `hosts.${props.host}.sshExposure.mode`, value: "bootstrap" }]),
      ]
      return await configDotBatch({ data: { projectId: props.projectId, ops } })
    },
    onSuccess: async (res: any) => {
      if (res.ok) {
        toast.success("Saved")
        setKeyText("")
        await queryClient.invalidateQueries({
          queryKey: ["hostSetupConfig", props.projectId],
        })
        props.onContinue()
        return
      }
      const first = Array.isArray(res.issues) ? res.issues[0] : null
      toast.error(first?.message || "Validation failed")
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <AdminCidrField
          id="setup-admin-cidr"
          label="Allowed admin IP (CIDR)"
          help={setupFieldHelp.hosts.adminCidr}
          value={adminCidr}
          onValueChange={setAdminCidr}
          autoDetectIfEmpty
          description="Who can SSH during bootstrap/provisioning (usually your current IP with /32)."
        />

        <div className="space-y-2">
          <LabelWithHelp htmlFor="setup-ssh-key-text" help={setupFieldHelp.hosts.sshKeyPaste}>
            SSH public key (required)
          </LabelWithHelp>
          <Textarea
            id="setup-ssh-key-text"
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            className="font-mono min-h-[90px]"
            placeholder="ssh-ed25519 AAAA... user@host"
          />

          {props.fleetSshKeys.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              Already configured: <strong>{props.fleetSshKeys.length}</strong> project SSH key(s).
              {keyText.trim() ? " Pasted keys will be added too." : null}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              If you don’t have one yet, generate it with{" "}
              <a
                className="underline underline-offset-3 hover:text-foreground"
                href="https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent"
                target="_blank"
                rel="noreferrer"
              >
                GitHub’s guide
              </a>
              .
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AsyncButton
          type="button"
          disabled={save.isPending || !canSave}
          pending={save.isPending}
          pendingText="Saving..."
          onClick={() => save.mutate()}
        >
          Save and continue
        </AsyncButton>
        {!canSave ? (
          <div className="text-xs text-muted-foreground">
            Fill the admin IP (CIDR) and add an SSH public key.
          </div>
        ) : null}
      </div>
    </div>
  )
}
