import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { AsyncButton } from "~/components/ui/async-button"
import { AdminCidrField } from "~/components/hosts/admin-cidr-field"
import { Checkbox } from "~/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Field, FieldContent, FieldGroup, FieldLabel, FieldSet } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { sealForRunner } from "~/lib/security/sealed-input"
import { buildSetupDraftSectionAad, setupDraftSaveNonSecret, setupDraftSaveSealedSection, type SetupDraftView } from "~/sdk/setup"
import { SetupStepStatusBadge } from "~/components/setup/steps/step-status-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

function isSshPublicKey(text: string): boolean {
  return /^ssh-(ed25519|rsa|ecdsa)\s+/i.test(text.trim())
}

function toUniqueKeys(values: string[]): string[] {
  return Array.from(new Set(values.map((row) => row.trim()).filter(Boolean)))
}

function deriveSshLabel(key: string): string {
  const normalized = key.trim()
  const parts = normalized.split(/\s+/)
  if (parts.length >= 3) return parts.slice(2).join(" ")
  return `${parts[0] || "ssh-key"} • ${normalized.slice(0, 22)}...`
}

export function SetupStepConnection(props: {
  projectId: Id<"projects">
  config: any | null
  setupDraft: SetupDraftView | null
  host: string
  stepStatus: SetupStepStatus
}) {
  const hostCfg = props.config?.hosts?.[props.host] || null
  const fleetSshKeys = Array.isArray(props.config?.fleet?.sshAuthorizedKeys)
    ? (props.config?.fleet?.sshAuthorizedKeys as string[])
    : []

  if (!hostCfg) {
    return (
      <div className="text-sm text-muted-foreground">
        Host config not loaded yet. Ensure runner is online, then retry.
      </div>
    )
  }

  return (
    <SetupStepConnectionForm
      key={props.host}
      projectId={props.projectId}
      host={props.host}
      hostCfg={hostCfg}
      fleetSshKeys={fleetSshKeys}
      setupDraft={props.setupDraft}
      stepStatus={props.stepStatus}
    />
  )
}

function SetupStepConnectionForm(props: {
  projectId: Id<"projects">
  host: string
  hostCfg: any
  fleetSshKeys: string[]
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
}) {
  const queryClient = useQueryClient()
  const draftConnection = props.setupDraft?.nonSecretDraft?.connection

  const [adminCidr, setAdminCidr] = useState(() => String(draftConnection?.adminCidr || props.hostCfg?.provisioning?.adminCidr || ""))

  const initialKnownKeys = useMemo(
    () => toUniqueKeys([
      ...props.fleetSshKeys,
      ...(Array.isArray(draftConnection?.sshAuthorizedKeys) ? draftConnection.sshAuthorizedKeys : []),
    ]),
    [draftConnection?.sshAuthorizedKeys, props.fleetSshKeys],
  )

  const [knownKeys, setKnownKeys] = useState<string[]>(() => initialKnownKeys)
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => {
    const fromDraft = Array.isArray(draftConnection?.sshAuthorizedKeys)
      ? toUniqueKeys(draftConnection.sshAuthorizedKeys)
      : []
    return fromDraft.length > 0 ? fromDraft : initialKnownKeys
  })

  const [addKeyOpen, setAddKeyOpen] = useState(false)
  const [newKeyText, setNewKeyText] = useState("")
  const [newKeyLabel, setNewKeyLabel] = useState("")
  const [manualLabels, setManualLabels] = useState<Record<string, string>>({})

  const [adminPassword, setAdminPassword] = useState("")

  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
  })
  const sealedRunners = useMemo(
    () =>
      (runnersQuery.data ?? [])
        .filter(
          (runner) =>
            runner.lastStatus === "online"
            && runner.capabilities?.supportsSealedInput === true
            && typeof runner.capabilities?.sealedInputPubSpkiB64 === "string"
            && runner.capabilities.sealedInputPubSpkiB64.trim().length > 0
            && typeof runner.capabilities?.sealedInputKeyId === "string"
            && runner.capabilities.sealedInputKeyId.trim().length > 0
            && typeof runner.capabilities?.sealedInputAlg === "string"
            && runner.capabilities.sealedInputAlg.trim().length > 0,
        )
        .toSorted((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0)),
    [runnersQuery.data],
  )

  const missingRequirements = useMemo(() => {
    const missing: string[] = []
    if (!props.host.trim()) missing.push("host")
    if (!adminCidr.trim()) missing.push("admin IP (CIDR)")
    if (selectedKeys.length === 0) missing.push("SSH public key")
    return missing
  }, [adminCidr, props.host, selectedKeys.length])

  const canSaveConnection = missingRequirements.length === 0
  const adminPasswordSet = props.setupDraft?.sealedSecretDrafts?.bootstrapSecrets?.status === "set"

  const saveConnection = useMutation({
    mutationFn: async () => {
      if (!props.host.trim()) throw new Error("missing host")
      if (!adminCidr.trim()) throw new Error("Admin CIDR is required")
      if (selectedKeys.length === 0) throw new Error("Select at least one SSH key")

      const existingMode = String(
        draftConnection?.sshExposureMode
        || props.hostCfg?.sshExposure?.mode
        || "bootstrap",
      ).trim() || "bootstrap"

      return await setupDraftSaveNonSecret({
        data: {
          projectId: props.projectId,
          host: props.host,
          expectedVersion: props.setupDraft?.version,
          patch: {
            connection: {
              adminCidr: adminCidr.trim(),
              sshExposureMode: existingMode as "bootstrap" | "tailnet" | "public",
              sshKeyCount: selectedKeys.length,
              sshAuthorizedKeys: toUniqueKeys(selectedKeys),
            },
          },
        },
      })
    },
    onSuccess: async () => {
      toast.success("Access settings saved")
      await queryClient.invalidateQueries({ queryKey: ["setupDraft", props.projectId, props.host] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const saveAdminPassword = useMutation({
    mutationFn: async (kind: "save" | "remove") => {
      const preferredRunnerId = props.setupDraft?.sealedSecretDrafts?.deployCreds?.targetRunnerId
      const runner = preferredRunnerId
        ? sealedRunners.find((row) => String(row._id) === String(preferredRunnerId))
        : sealedRunners.length === 1
          ? sealedRunners[0]
          : null
      if (!runner) throw new Error("Save a token first with an online sealed runner.")

      const runnerId = String(runner._id) as Id<"runners">
      const runnerPub = String(runner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(runner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(runner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

      const value = kind === "remove" ? "" : adminPassword.trim()
      if (kind === "save" && !value) throw new Error("Admin password is required")

      const aad = buildSetupDraftSectionAad({
        projectId: props.projectId,
        host: props.host,
        section: "bootstrapSecrets",
        targetRunnerId: runnerId,
      })
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: runnerPub,
        keyId,
        alg,
        aad,
        plaintextJson: JSON.stringify({ adminPasswordHash: value }),
      })

      await setupDraftSaveSealedSection({
        data: {
          projectId: props.projectId,
          host: props.host,
          section: "bootstrapSecrets",
          targetRunnerId: runnerId,
          sealedInputB64,
          sealedInputAlg: alg,
          sealedInputKeyId: keyId,
          aad,
          expectedVersion: props.setupDraft?.version,
        },
      })

      return kind
    },
    onSuccess: async (kind) => {
      if (kind === "save") setAdminPassword("")
      toast.success(kind === "remove" ? "Admin password removed" : "Admin password saved")
      await queryClient.invalidateQueries({ queryKey: ["setupDraft", props.projectId, props.host] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const toggleSelectedKey = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      if (checked) return toUniqueKeys([...prev, key])
      return prev.filter((row) => row !== key)
    })
  }

  const addKeyFromDialog = () => {
    const key = newKeyText.trim()
    const label = newKeyLabel.trim()
    if (!isSshPublicKey(key)) {
      toast.error("Enter a valid SSH public key")
      return
    }
    setKnownKeys((prev) => toUniqueKeys([...prev, key]))
    setSelectedKeys((prev) => toUniqueKeys([...prev, key]))
    if (label) {
      setManualLabels((prev) => ({ ...prev, [key]: label }))
    }
    setNewKeyText("")
    setNewKeyLabel("")
    setAddKeyOpen(false)
    toast.success("SSH key added")
  }

  return (
    <>
      <SettingsSection
        title="Server access"
        description="SSH access and admin network settings for bootstrap."
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
        statusText={!canSaveConnection ? `Missing: ${missingRequirements.join(", ")}.` : undefined}
        actions={(
          <AsyncButton
            type="button"
            disabled={saveConnection.isPending || !canSaveConnection}
            pending={saveConnection.isPending}
            pendingText="Saving..."
            onClick={() => saveConnection.mutate()}
          >
            Save access settings
          </AsyncButton>
        )}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="setup-ssh-key-list" help={setupFieldHelp.hosts.sshKeyPaste}>
              SSH keys
            </LabelWithHelp>

            {knownKeys.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No SSH keys yet. Add at least one key to continue.
              </div>
            ) : (
              <FieldSet id="setup-ssh-key-list">
                <FieldGroup data-slot="checkbox-group" className="gap-4">
                  {knownKeys.map((key, idx) => {
                    const checked = selectedKeys.includes(key)
                    const label = manualLabels[key] || deriveSshLabel(key)
                    const checkboxId = `setup-ssh-key-${idx}`
                    return (
                      <FieldLabel key={key} htmlFor={checkboxId}>
                        <Field orientation="horizontal" data-checked={checked ? "" : undefined}>
                          <FieldContent className="min-w-0">
                            <span className="block truncate text-sm font-medium">{label}</span>
                            <code className="block truncate text-xs text-muted-foreground">{key}</code>
                          </FieldContent>
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={(next) => toggleSelectedKey(key, Boolean(next))}
                          />
                        </Field>
                      </FieldLabel>
                    )
                  })}
                </FieldGroup>
              </FieldSet>
            )}

            <div className="flex flex-wrap gap-2">
              <InputGroupButton type="button" variant="outline" onClick={() => setAddKeyOpen(true)}>
                Add SSH key
              </InputGroupButton>
              {selectedKeys.length > 0 ? (
                <div className="self-center text-xs text-muted-foreground">
                  {selectedKeys.length} selected for this host setup.
                </div>
              ) : null}
            </div>
          </div>

          <Accordion className="rounded-lg border bg-muted/20">
            <AccordionItem value="advanced" className="px-4">
              <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
                Advanced options
              </AccordionTrigger>
              <AccordionContent className="pb-4">
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
                    <LabelWithHelp htmlFor="setup-admin-password" help={setupFieldHelp.secrets.adminPassword}>
                      Admin password
                    </LabelWithHelp>

                    {adminPasswordSet ? (
                      <InputGroup>
                        <InputGroupInput id="setup-admin-password" readOnly value="Saved for this host" />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            disabled={saveAdminPassword.isPending}
                            pending={saveAdminPassword.isPending}
                            pendingText="Removing..."
                            onClick={() => saveAdminPassword.mutate("remove")}
                          >
                            Remove
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    ) : (
                      <InputGroup>
                        <InputGroupInput
                          id="setup-admin-password"
                          type="password"
                          value={adminPassword}
                          onChange={(event) => setAdminPassword(event.target.value)}
                          placeholder="Set admin password"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            disabled={saveAdminPassword.isPending || !adminPassword.trim()}
                            pending={saveAdminPassword.isPending}
                            pendingText="Saving..."
                            onClick={() => saveAdminPassword.mutate("save")}
                          >
                            Save
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SettingsSection>

      <Dialog open={addKeyOpen} onOpenChange={setAddKeyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add SSH key</DialogTitle>
            <DialogDescription>
              Add a project SSH public key. The key becomes selectable for this host setup.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <LabelWithHelp htmlFor="setup-new-ssh-key" help={setupFieldHelp.hosts.sshKeyPaste}>
                SSH public key
              </LabelWithHelp>
              <Textarea
                id="setup-new-ssh-key"
                value={newKeyText}
                onChange={(event) => setNewKeyText(event.target.value)}
                className="font-mono min-h-[110px]"
                placeholder="ssh-ed25519 AAAA... user@host"
              />
            </div>

            <div className="space-y-2">
              <LabelWithHelp htmlFor="setup-new-ssh-key-label" help="Optional label shown in this setup UI.">
                Label (optional)
              </LabelWithHelp>
              <Input
                id="setup-new-ssh-key-label"
                value={newKeyLabel}
                onChange={(event) => setNewKeyLabel(event.target.value)}
                placeholder="Laptop key"
              />
            </div>
          </div>

          <DialogFooter showCloseButton>
            <InputGroupButton
              type="button"
              disabled={!newKeyText.trim()}
              onClick={addKeyFromDialog}
            >
              Add key
            </InputGroupButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
