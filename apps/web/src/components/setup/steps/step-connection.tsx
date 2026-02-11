import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { AdminCidrField } from "~/components/hosts/admin-cidr-field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { setupConfigProbeQueryKey } from "~/lib/setup/repo-probe"
import { resolveConnectionStepMissingRequirements, shouldShowConnectionSshKeyEditor } from "~/lib/setup/connection-step"
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
  const hasProjectSshKeys = props.fleetSshKeys.length > 0
  const [showKeyEditor, setShowKeyEditor] = useState(() => !hasProjectSshKeys)
  const [keyText, setKeyText] = useState("")

  const missingRequirements = useMemo(() => {
    return resolveConnectionStepMissingRequirements({
      host: props.host,
      adminCidr,
      hasProjectSshKeys,
      keyText,
    })
  }, [adminCidr, hasProjectSshKeys, keyText, props.host])
  const canSave = missingRequirements.length === 0
  const showSshKeyEditor = shouldShowConnectionSshKeyEditor({
    hasProjectSshKeys,
    showKeyEditor,
    keyText,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      if (!hasProjectSshKeys && !keyText.trim()) {
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
        setShowKeyEditor(false)
        await queryClient.invalidateQueries({
          queryKey: setupConfigProbeQueryKey(props.projectId),
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
    <SettingsSection
      title="Server access"
      description="Network and SSH settings required for bootstrap."
      statusText={!canSave ? `Missing: ${missingRequirements.join(", ")}.` : undefined}
      actions={(
        <AsyncButton
          type="button"
          disabled={save.isPending || !canSave}
          pending={save.isPending}
          pendingText="Saving..."
          onClick={() => save.mutate()}
        >
          Save and continue
        </AsyncButton>
      )}
    >
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
            SSH public key {hasProjectSshKeys ? "(optional)" : "(required)"}
          </LabelWithHelp>
          {hasProjectSshKeys && !showSshKeyEditor ? (
            <>
              <InputGroup>
                <InputGroupInput
                  id="setup-ssh-key-text"
                  readOnly
                  value={`${props.fleetSshKeys.length} project SSH key${props.fleetSshKeys.length === 1 ? "" : "s"} configured`}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    variant="secondary"
                    onClick={() => setShowKeyEditor(true)}
                  >
                    Add key
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <div className="text-xs text-muted-foreground">
                Existing keys satisfy this step. Continue without pasting a new key.
              </div>
            </>
          ) : (
            <>
              <Textarea
                id="setup-ssh-key-text"
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                className="font-mono min-h-[90px]"
                placeholder="ssh-ed25519 AAAA... user@host"
              />

              {hasProjectSshKeys ? (
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Already configured: <strong>{props.fleetSshKeys.length}</strong> project SSH key(s).
                    {keyText.trim() ? " Pasted keys will be added too." : null}
                  </span>
                  {showKeyEditor ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setKeyText("")
                        setShowKeyEditor(false)
                      }}
                    >
                      Done editing
                    </Button>
                  ) : null}
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
            </>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}
