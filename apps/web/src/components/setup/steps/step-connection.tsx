import { useEffect, useMemo, useState } from "react"
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
import type { SetupDraftConnection, SetupDraftView } from "~/sdk/setup"
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
  config: any | null
  setupDraft: SetupDraftView | null
  host: string
  stepStatus: SetupStepStatus
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
        host={props.host}
        configLoaded={Boolean(props.config)}
        hostCfg={hostCfg ?? {}}
        fleetSshKeys={fleetSshKeys}
        setupDraft={props.setupDraft}
        stepStatus={props.stepStatus}
        onDraftChange={props.onDraftChange}
        adminPassword={props.adminPassword}
        onAdminPasswordChange={props.onAdminPasswordChange}
      />
    </>
  )
}

function SetupStepConnectionForm(props: {
  host: string
  configLoaded: boolean
  hostCfg: any
  fleetSshKeys: string[]
  setupDraft: SetupDraftView | null
  stepStatus: SetupStepStatus
  onDraftChange: (next: SetupDraftConnection) => void
  adminPassword: string
  onAdminPasswordChange: (value: string) => void
}) {
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
    if (!adminCidr.trim()) missing.push("admin IP (CIDR)")
    if (selectedKeys.length === 0) missing.push("SSH public key")
    return missing
  }, [adminCidr, props.host, selectedKeys.length])

  const toggleSelectedKey = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      if (checked) return toUniqueKeys([...prev, key])
      return prev.filter((row) => row !== key)
    })
  }

  const addKeyFromDialog = () => {
    const key = newKeyText.trim()
    const label = newKeyLabel.trim()
    if (!isSshPublicKey(key)) return
    setKnownKeys((prev) => toUniqueKeys([...prev, key]))
    setSelectedKeys((prev) => toUniqueKeys([...prev, key]))
    if (label) {
      setManualLabels((prev) => ({ ...prev, [key]: label }))
    }
    setNewKeyText("")
    setNewKeyLabel("")
    setAddKeyOpen(false)
  }

  return (
    <>
      <SettingsSection
        title="Server access"
        description="SSH access and admin network settings for bootstrap."
        headerBadge={<SetupStepStatusBadge status={props.stepStatus} />}
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
                    const label = manualLabels[key] || deriveSshLabel(key)
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

                    <InputGroup>
                      <InputGroupInput
                        id="setup-admin-password"
                        type="password"
                        value={props.adminPassword}
                        onChange={(event) => props.onAdminPasswordChange(event.target.value)}
                        placeholder="Optional"
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
                    <div className="text-xs text-muted-foreground">
                      Stored as encrypted draft data during final deploy.
                    </div>
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
                className="field-sizing-fixed max-w-full min-h-[110px] break-all [overflow-wrap:anywhere] font-mono"
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
