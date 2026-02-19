import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { api } from "../../../../convex/_generated/api"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
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
import { maskSshPublicKey } from "~/lib/ssh-redaction"
import { deriveConnectionLateHydration } from "~/lib/setup/connection-hydration"
import { setupConfigProbeQueryKey } from "~/lib/setup/repo-probe"
import { addProjectSshKeys } from "~/sdk/config/hosts"
import type { SetupDraftConnection, SetupDraftView } from "~/sdk/setup"
import { SetupSaveStateBadge } from "~/components/setup/steps/setup-save-state-badge"
import type { SetupStepStatus } from "~/lib/setup/setup-model"

function isSshPublicKey(text: string): boolean {
  return /^ssh-(ed25519|rsa|ecdsa)\s+/i.test(text.trim())
}

function validateSshPublicKeyInput(text: string): string | null {
  const normalized = text.trim()
  if (!normalized) return "SSH public key is required."
  if (/private key/i.test(normalized) || /BEGIN [A-Z ]*PRIVATE KEY/.test(normalized)) {
    return "Private key detected. Paste only the public key line."
  }
  if (!isSshPublicKey(normalized)) {
    return "Invalid public key format. Expected prefixes: ssh-ed25519, ssh-rsa, ssh-ecdsa."
  }
  return null
}

function toUniqueKeys(values: string[]): string[] {
  return Array.from(new Set(values.map((row) => row.trim()).filter(Boolean)))
}

function deriveSshLabel(key: string, index: number): string {
  const normalized = key.trim()
  const parts = normalized.split(/\s+/)
  const keyType = parts[0] || "ssh-key"
  return `${keyType} key #${index + 1}`
}

export function SetupStepConnection(props: {
  projectId: Id<"projects">
  config: any | null
  setupDraft: SetupDraftView | null
  host: string
  stepStatus: SetupStepStatus
  projectAdminCidr: string
  projectAdminCidrError: string | null
  adminCidrDetecting: boolean
  onDetectAdminCidr: () => void
  onDraftChange: (next: SetupDraftConnection) => void
  adminPassword: string
  onAdminPasswordChange: (value: string) => void
}) {
  const hostCfg = props.config?.hosts?.[props.host] || null
  const fleetSshKeys = Array.isArray(props.config?.fleet?.sshAuthorizedKeys)
    ? (props.config?.fleet?.sshAuthorizedKeys as string[])
    : []

  return (
    <>
      {!props.config ? (
        <div className="mb-2 text-xs text-muted-foreground">
          Repo config not loaded yet. Runner must be online to probe config. Using draft values only.
        </div>
      ) : null}
      <SetupStepConnectionForm
        key={props.host}
        projectId={props.projectId}
        host={props.host}
        configLoaded={Boolean(props.config)}
        hostCfg={hostCfg ?? {}}
        fleetSshKeys={fleetSshKeys}
        setupDraft={props.setupDraft}
        stepStatus={props.stepStatus}
        projectAdminCidr={props.projectAdminCidr}
        projectAdminCidrError={props.projectAdminCidrError}
        adminCidrDetecting={props.adminCidrDetecting}
        onDetectAdminCidr={props.onDetectAdminCidr}
        onDraftChange={props.onDraftChange}
        adminPassword={props.adminPassword}
        onAdminPasswordChange={props.onAdminPasswordChange}
      />
    </>
  )
}

function SetupStepConnectionForm(props: {
  projectId: Id<"projects">
  host: string
  configLoaded: boolean
  hostCfg: any
  fleetSshKeys: string[]
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
  projectAdminCidr: string
  projectAdminCidrError: string | null
  adminCidrDetecting: boolean
  onDetectAdminCidr: () => void
  onDraftChange: (next: SetupDraftConnection) => void
  adminPassword: string
  onAdminPasswordChange: (value: string) => void
}) {
  const queryClient = useQueryClient()
  const draftConnection = props.setupDraft?.nonSecretDraft?.connection
  const secretWiringQuery = useQuery({
    ...convexQuery(
      api.controlPlane.secretWiring.listByProjectHost,
      props.host ? { projectId: props.projectId, hostName: props.host } : "skip",
    ),
    enabled: Boolean(props.host),
  })
  const adminPasswordConfigured = useMemo(
    () =>
      (secretWiringQuery.data ?? []).some(
        (row) => row.secretName === "admin_password_hash" && row.status === "configured",
      ),
    [secretWiringQuery.data],
  )
  const adminPasswordRequired = !adminPasswordConfigured

  const [adminCidr, setAdminCidr] = useState(() => String(
    draftConnection?.adminCidr || props.hostCfg?.provisioning?.adminCidr || props.projectAdminCidr || "",
  ))

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
  const [newKeyTouched, setNewKeyTouched] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState("")
  const [manualLabels, setManualLabels] = useState<Record<string, string>>({})
  const [adminPasswordUnlocked, setAdminPasswordUnlocked] = useState(false)
  const adminPasswordLocked = adminPasswordConfigured && !adminPasswordUnlocked && !props.adminPassword.trim()
  const addProjectSshKey = useMutation({
    mutationFn: async (key: string) =>
      await addProjectSshKeys({
        data: {
          projectId: props.projectId,
          keyText: key,
          knownHostsText: "",
        },
      }),
  })

  const existingMode = (String(
    draftConnection?.sshExposureMode
    || props.hostCfg?.sshExposure?.mode
    || "bootstrap",
  ).trim() || "bootstrap") as "bootstrap" | "tailnet" | "public"

  useEffect(() => {
    const hydration = deriveConnectionLateHydration({
      configLoaded: props.configLoaded,
      draftAdminCidr: draftConnection?.adminCidr,
      draftSshAuthorizedKeys: draftConnection?.sshAuthorizedKeys,
      hostAdminCidr: props.hostCfg?.provisioning?.adminCidr,
      fleetSshKeys: props.fleetSshKeys,
      currentAdminCidr: adminCidr,
      currentKnownKeys: knownKeys,
      currentSelectedKeys: selectedKeys,
    })
    if (!hydration) return
    if (typeof hydration.adminCidr === "string") setAdminCidr(hydration.adminCidr)
    if (hydration.knownKeys) setKnownKeys(hydration.knownKeys)
    if (hydration.selectedKeys) setSelectedKeys(hydration.selectedKeys)
  }, [
    adminCidr,
    draftConnection?.adminCidr,
    draftConnection?.sshAuthorizedKeys,
    knownKeys,
    props.configLoaded,
    props.fleetSshKeys,
    props.hostCfg?.provisioning?.adminCidr,
    selectedKeys,
  ])

  useEffect(() => {
    if (adminCidr.trim()) return
    if (String(draftConnection?.adminCidr || "").trim()) return
    if (String(props.hostCfg?.provisioning?.adminCidr || "").trim()) return
    if (!props.projectAdminCidr.trim()) return
    setAdminCidr(props.projectAdminCidr.trim())
  }, [
    adminCidr,
    draftConnection?.adminCidr,
    props.hostCfg?.provisioning?.adminCidr,
    props.projectAdminCidr,
  ])

  useEffect(() => {
    props.onDraftChange({
      adminCidr: adminCidr.trim(),
      sshExposureMode: existingMode,
      sshKeyCount: selectedKeys.length,
      sshAuthorizedKeys: toUniqueKeys(selectedKeys),
    })
  }, [adminCidr, existingMode, props.onDraftChange, selectedKeys])

  const missingRequirements = useMemo(() => {
    const missing: string[] = []
    if (!props.host.trim()) missing.push("host")
    if (!adminCidr.trim() && !props.adminCidrDetecting) missing.push("admin IP (CIDR)")
    if (selectedKeys.length === 0) missing.push("SSH public key")
    if (adminPasswordRequired && !props.adminPassword.trim()) missing.push("Admin password")
    return missing
  }, [adminCidr, adminPasswordRequired, props.adminCidrDetecting, props.adminPassword, props.host, selectedKeys.length])
  const keyInputError = validateSshPublicKeyInput(newKeyText)
  const saveState = useMemo(() => {
    if (props.setupDraft?.status === "failed") return "error" as const
    if (!draftConnection) return "not_saved" as const
    const draftAdmin = String(draftConnection.adminCidr || "").trim()
    const draftMode = String(draftConnection.sshExposureMode || "bootstrap").trim() || "bootstrap"
    const draftKeys = toUniqueKeys(Array.isArray(draftConnection.sshAuthorizedKeys) ? draftConnection.sshAuthorizedKeys : [])
    const currentKeys = toUniqueKeys(selectedKeys)
    if (draftAdmin !== adminCidr.trim()) return "not_saved" as const
    if (draftMode !== existingMode) return "not_saved" as const
    if (draftKeys.length !== currentKeys.length) return "not_saved" as const
    if (draftKeys.some((key) => !currentKeys.includes(key))) return "not_saved" as const
    return "saved" as const
  }, [adminCidr, draftConnection, existingMode, props.setupDraft?.status, selectedKeys])

  const toggleSelectedKey = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      if (checked) return toUniqueKeys([...prev, key])
      return prev.filter((row) => row !== key)
    })
  }

  const addKeyFromDialog = async () => {
    const key = newKeyText.trim()
    const label = newKeyLabel.trim()
    const validationError = validateSshPublicKeyInput(key)
    if (validationError) {
      setNewKeyTouched(true)
      toast.error(validationError)
      return
    }
    setKnownKeys((prev) => toUniqueKeys([...prev, key]))
    setSelectedKeys((prev) => toUniqueKeys([...prev, key]))
    if (label) {
      setManualLabels((prev) => ({ ...prev, [key]: label }))
    }
    setNewKeyText("")
    setNewKeyTouched(false)
    setNewKeyLabel("")
    setAddKeyOpen(false)

    try {
      await addProjectSshKey.mutateAsync(key)
      await queryClient.invalidateQueries({ queryKey: setupConfigProbeQueryKey(props.projectId) })
      toast.success("SSH key added to project")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Project SSH key save failed: ${message}`)
    }
  }

  return (
    <>
      <SettingsSection
        title="Server access"
        description="SSH access and admin network settings for bootstrap."
        headerBadge={<SetupSaveStateBadge state={saveState} />}
        statusText={missingRequirements.length > 0 ? `Missing: ${missingRequirements.join(", ")}.` : "Ready for final deploy check."}
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
                    const label = manualLabels[key] || deriveSshLabel(key, idx)
                    const checkboxId = `setup-ssh-key-${idx}`
                    return (
                      <FieldLabel key={key} htmlFor={checkboxId}>
                        <Field orientation="horizontal" data-checked={checked ? "" : undefined}>
                          <FieldContent className="min-w-0">
                            <span className="block truncate text-sm font-medium">{label}</span>
                            <code className="block truncate text-xs text-muted-foreground">{maskSshPublicKey(key)}</code>
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

          <div className="space-y-2">
            <LabelWithHelp htmlFor="setup-admin-password" help={setupFieldHelp.secrets.adminPassword}>
              {adminPasswordRequired ? "Admin password (required)" : "Admin password"}
            </LabelWithHelp>

            {adminPasswordLocked ? (
              <InputGroup>
                <InputGroupInput id="setup-admin-password" readOnly value="Saved for this host" />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAdminPasswordUnlocked(true)
                      props.onAdminPasswordChange("")
                    }}
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
                  value={props.adminPassword}
                  onChange={(event) => props.onAdminPasswordChange(event.target.value)}
                  placeholder={adminPasswordRequired ? "Enter admin password" : "Enter new admin password"}
                />
                {props.adminPassword.trim() ? (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="button"
                      variant="outline"
                      onClick={() => props.onAdminPasswordChange("")}
                    >
                      Clear
                    </InputGroupButton>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
            )}
            <div className="text-xs text-muted-foreground">
              {adminPasswordLocked
                ? "This is the Linux login password for the server user 'admin'. Already saved for this host. Click Remove to set a new password."
                : adminPasswordRequired
                  ? "This is the Linux login password for the server user 'admin'. Required before first deploy."
                  : "This is the Linux login password for the server user 'admin'. Enter a value only if you want to change it."}
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
                    detecting={props.adminCidrDetecting}
                    onDetect={props.onDetectAdminCidr}
                    detectionError={props.projectAdminCidrError}
                    description="Who can SSH during bootstrap/provisioning (usually your current IP with /32)."
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </SettingsSection>

      <Dialog
        open={addKeyOpen}
        onOpenChange={(open) => {
          setAddKeyOpen(open)
          if (!open) setNewKeyTouched(false)
        }}
      >
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
              <div className="rounded-md border border-amber-300/50 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
                Never paste a private key here. Use only a single public key line.
              </div>
              <Textarea
                id="setup-new-ssh-key"
                value={newKeyText}
                onChange={(event) => {
                  setNewKeyText(event.target.value)
                  setNewKeyTouched(true)
                }}
                onBlur={() => setNewKeyTouched(true)}
                className="field-sizing-fixed max-w-full min-h-[110px] break-all [overflow-wrap:anywhere] font-mono"
                placeholder="ssh-ed25519 AAAA... user@host"
              />
              <div className="text-xs text-muted-foreground">
                Valid format starts with <code>ssh-ed25519</code>, <code>ssh-rsa</code>, or <code>ssh-ecdsa</code>.
              </div>
              {newKeyTouched && keyInputError ? (
                <div className="text-xs text-destructive">
                  {keyInputError}
                </div>
              ) : null}
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

          <DialogFooter>
            <InputGroupButton
              type="button"
              variant="outline"
              onClick={() => setAddKeyOpen(false)}
            >
              Close
            </InputGroupButton>
            <InputGroupButton
              type="button"
              variant="default"
              disabled={Boolean(keyInputError) || addProjectSshKey.isPending}
              onClick={() => void addKeyFromDialog()}
            >
              {addProjectSshKey.isPending ? "Adding..." : "Add key"}
            </InputGroupButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
