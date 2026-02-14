import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { toast } from "sonner"
import { SEALED_INPUT_B64_MAX_CHARS } from "@clawlets/core/lib/runtime/control-plane-constants"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { AsyncButton } from "~/components/ui/async-button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { InputGroupButton } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { sealForRunner } from "~/lib/security/sealed-input"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import {
  generateProjectTokenKeyId,
  maskProjectToken,
  PROJECT_TOKEN_VALUE_MAX_CHARS,
  parseProjectTokenKeyring,
  resolveActiveProjectTokenEntry,
  serializeProjectTokenKeyring,
  type ProjectTokenKeyring,
  type ProjectTokenKeyringEntry,
} from "~/lib/project-token-keyring"
import { finalizeDeployCreds, getDeployCredsStatus, updateDeployCreds } from "~/sdk/infra"

type ProjectTokenKeyringKind = "hcloud" | "tailscale"

type KeyringKindConfig = {
  keyringKey: string
  activeKey: string
  label: string
  valuePlaceholder: string
}

const KEYRING_KIND_CONFIG: Record<ProjectTokenKeyringKind, KeyringKindConfig> = {
  hcloud: {
    keyringKey: "HCLOUD_TOKEN_KEYRING",
    activeKey: "HCLOUD_TOKEN_KEYRING_ACTIVE",
    label: "Hetzner API key",
    valuePlaceholder: "hcloud token",
  },
  tailscale: {
    keyringKey: "TAILSCALE_AUTH_KEY_KEYRING",
    activeKey: "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE",
    label: "Tailscale auth key",
    valuePlaceholder: "tskey-auth-...",
  },
}

function normalizeKeyringForWrite(params: {
  keyring: ProjectTokenKeyring
  activeId: string
}): {
  keyring: ProjectTokenKeyring
  activeId: string
  activeEntry: ProjectTokenKeyringEntry | null
} {
  const keyring: ProjectTokenKeyring = {
    items: params.keyring.items
      .map((entry) => ({
        id: String(entry.id || "").trim(),
        label: String(entry.label || "").trim(),
        value: String(entry.value || "").trim(),
      }))
      .filter((entry) => entry.id.length > 0 && entry.value.length > 0),
  }

  const activeEntry = resolveActiveProjectTokenEntry({
    keyring,
    activeId: params.activeId,
  })

  return {
    keyring,
    activeId: activeEntry?.id || "",
    activeEntry,
  }
}

export function ProjectTokenKeyringCard(props: {
  projectId: Id<"projects">
  kind: ProjectTokenKeyringKind
  setupHref?: string | null
  title: string
  description?: ReactNode
  headerBadge?: ReactNode
  wrapInSection?: boolean
  onActiveValueChange?: (value: string) => void
  showRunnerStatusBanner?: boolean
  showRunnerStatusDetails?: boolean
}) {
  const cfg = KEYRING_KIND_CONFIG[props.kind]
  const wrapInSection = props.wrapInSection !== false
  const showRunnerStatusBanner = props.showRunnerStatusBanner !== false
  const showRunnerStatusDetails = props.showRunnerStatusDetails !== false
  const queryClient = useQueryClient()

  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])
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

  const [selectedRunnerId, setSelectedRunnerId] = useState<string>("")
  useEffect(() => {
    if (sealedRunners.length === 1) {
      setSelectedRunnerId(String(sealedRunners[0]?._id || ""))
      return
    }
    if (!sealedRunners.some((runner) => String(runner._id) === selectedRunnerId)) {
      setSelectedRunnerId("")
    }
  }, [sealedRunners, selectedRunnerId])

  const creds = useQuery({
    queryKey: ["deployCreds", props.projectId],
    queryFn: async () => await getDeployCredsStatus({ data: { projectId: props.projectId } }),
    enabled: runnerOnline,
  })

  const credsByKey = useMemo(() => {
    const out: Record<string, { status?: "set" | "unset"; value?: string }> = {}
    for (const row of creds.data?.keys || []) out[row.key] = row
    return out
  }, [creds.data?.keys])

  const keyring = useMemo(
    () => parseProjectTokenKeyring(credsByKey[cfg.keyringKey]?.value),
    [cfg.keyringKey, credsByKey],
  )
  const activeId = String(credsByKey[cfg.activeKey]?.value || "").trim()
  const activeEntry = useMemo(
    () => resolveActiveProjectTokenEntry({ keyring, activeId }),
    [activeId, keyring],
  )

  useEffect(() => {
    props.onActiveValueChange?.(activeEntry?.value || "")
  }, [activeEntry?.value, props.onActiveValueChange])

  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [newValue, setNewValue] = useState("")

  const pickTargetRunner = () => {
    if (sealedRunners.length === 1) return sealedRunners[0]
    return sealedRunners.find((row) => String(row._id) === selectedRunnerId)
  }

  const writeKeyring = useMutation({
    mutationFn: async (next: { keyring: ProjectTokenKeyring; activeId: string }) => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (sealedRunners.length === 0) throw new Error("No sealed-capable runner online. Upgrade runner.")

      const normalized = normalizeKeyringForWrite(next)
      const runner = pickTargetRunner()
      if (!runner) throw new Error("Select a sealed-capable runner")

      const targetRunnerId = String(runner._id) as Id<"runners">
      const runnerPub = String(runner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(runner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(runner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("runner sealed-input capabilities incomplete")

      const updates: Record<string, string> = {
        [cfg.keyringKey]: serializeProjectTokenKeyring(normalized.keyring),
        [cfg.activeKey]: normalized.activeId,
      }

      const updatedKeys = Object.keys(updates)
      const reserve = await updateDeployCreds({
        data: {
          projectId: props.projectId,
          targetRunnerId,
          updatedKeys,
        },
      }) as any

      const jobId = String(reserve?.jobId || "").trim()
      const kind = String(reserve?.kind || "").trim()
      if (!jobId || !kind) throw new Error("reserve response missing job metadata")

      const reserveRunnerPub = String(reserve?.sealedInputPubSpkiB64 || runnerPub).trim()
      const reserveKeyId = String(reserve?.sealedInputKeyId || keyId).trim()
      const reserveAlg = String(reserve?.sealedInputAlg || alg).trim()
      const aad = `${props.projectId}:${jobId}:${kind}:${targetRunnerId}`
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: reserveRunnerPub,
        keyId: reserveKeyId,
        alg: reserveAlg,
        aad,
        plaintextJson: JSON.stringify(updates),
      })
      if (sealedInputB64.length > SEALED_INPUT_B64_MAX_CHARS) {
        const kib = Math.ceil(sealedInputB64.length / 1024)
        throw new Error(`credential payload too large (${kib} KiB). Remove oversized keys and retry.`)
      }

      await finalizeDeployCreds({
        data: {
          projectId: props.projectId,
          jobId,
          kind,
          sealedInputB64,
          sealedInputAlg: reserveAlg,
          sealedInputKeyId: reserveKeyId,
          targetRunnerId,
          updatedKeys,
        },
      })
      return normalized
    },
    onSuccess: async () => {
      setAddOpen(false)
      setNewLabel("")
      setNewValue("")
      toast.success(`${cfg.label} settings updated`)
      await queryClient.invalidateQueries({ queryKey: ["deployCreds", props.projectId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const canMutate = runnerOnline
    && sealedRunners.length > 0
    && (sealedRunners.length === 1 || Boolean(selectedRunnerId))

  const onActivate = (id: string) => {
    void writeKeyring.mutate({ keyring, activeId: id })
  }

  const onRemove = (id: string) => {
    const nextItems = keyring.items.filter((row) => row.id !== id)
    const nextActive = activeEntry?.id === id ? nextItems[0]?.id || "" : activeEntry?.id || ""
    void writeKeyring.mutate({ keyring: { items: nextItems }, activeId: nextActive })
  }

  const onAdd = () => {
    const value = newValue.trim()
    if (!value) return
    if (value.length > PROJECT_TOKEN_VALUE_MAX_CHARS) {
      toast.error(`Token too long (max ${PROJECT_TOKEN_VALUE_MAX_CHARS} characters)`)
      return
    }

    const id = generateProjectTokenKeyId(newLabel)
    const label = newLabel.trim()
    const nextItems = [...keyring.items, { id, label, value }]
    const nextActive = activeEntry?.id || id
    void writeKeyring.mutate({ keyring: { items: nextItems }, activeId: nextActive })
  }

  const content = (
    <>
      {showRunnerStatusBanner ? (
        <RunnerStatusBanner
          projectId={props.projectId}
          setupHref={props.setupHref}
          runnerOnline={runnerOnline}
          isChecking={runnersQuery.isPending}
        />
      ) : null}

      {showRunnerStatusDetails && !runnerOnline && !runnersQuery.isPending ? (
        <div className="text-sm text-muted-foreground">Connect your runner to manage project keys.</div>
      ) : null}

      {showRunnerStatusDetails && runnerOnline && sealedRunners.length === 0 ? (
        <div className="text-sm text-destructive">No online runner advertises sealed input. Upgrade runner and retry.</div>
      ) : null}

      {!runnerOnline ? null : creds.isPending ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : creds.error ? (
        <div className="text-sm text-destructive">{String(creds.error)}</div>
      ) : (
        <div className="space-y-4">
          {sealedRunners.length > 1 ? (
            <div className="space-y-2">
              <LabelWithHelp htmlFor={`${props.kind}KeyringRunner`} help="Sealed-input writes must target one online runner.">
                Target runner
              </LabelWithHelp>
              <NativeSelect
                id={`${props.kind}KeyringRunner`}
                value={selectedRunnerId}
                onChange={(event) => setSelectedRunnerId(event.target.value)}
              >
                <NativeSelectOption value="">Select runner...</NativeSelectOption>
                {sealedRunners.map((runner) => (
                  <NativeSelectOption key={runner._id} value={String(runner._id)}>
                    {runner.runnerName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          {keyring.items.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              No saved keys yet. Add at least one project key.
            </div>
          ) : (
            <div className="space-y-2">
              {keyring.items.map((entry) => {
                const isActive = activeEntry?.id === entry.id
                return (
                  <div key={entry.id} className="rounded-md border bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{entry.label || "Key"}</div>
                        <code className="block truncate text-xs text-muted-foreground">{maskProjectToken(entry.value)}</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <AsyncButton
                          type="button"
                          size="sm"
                          variant={isActive ? "default" : "outline"}
                          disabled={!canMutate || writeKeyring.isPending || isActive}
                          pending={writeKeyring.isPending}
                          pendingText="Selecting..."
                          onClick={() => onActivate(entry.id)}
                        >
                          {isActive ? "Selected" : "Select"}
                        </AsyncButton>
                        <AsyncButton
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canMutate || writeKeyring.isPending}
                          pending={writeKeyring.isPending}
                          pendingText="Removing..."
                          onClick={() => onRemove(entry.id)}
                        >
                          Remove
                        </AsyncButton>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <InputGroupButton
              type="button"
              variant="outline"
              disabled={!canMutate || writeKeyring.isPending}
              onClick={() => setAddOpen(true)}
            >
              Add key
            </InputGroupButton>
            {activeEntry ? (
              <div className="text-xs text-muted-foreground">
                Active: <span className="font-medium">{activeEntry.label || "Key"}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add {cfg.label}</DialogTitle>
            <DialogDescription>
              Key is stored locally in project deploy credentials and never displayed in full after save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <LabelWithHelp htmlFor={`${props.kind}KeyLabel`} help="Optional label for this project key.">
                Label (optional)
              </LabelWithHelp>
              <Input
                id={`${props.kind}KeyLabel`}
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder="Team member key"
              />
            </div>
            <div className="space-y-2">
              <LabelWithHelp htmlFor={`${props.kind}KeyValue`} help="Secret value. Stored locally on the runner side.">
                Key value
              </LabelWithHelp>
              <SecretInput
                id={`${props.kind}KeyValue`}
                value={newValue}
                onValueChange={setNewValue}
                placeholder={cfg.valuePlaceholder}
              />
            </div>
          </div>

          <DialogFooter>
            <InputGroupButton type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Close
            </InputGroupButton>
            <AsyncButton
              type="button"
              disabled={!newValue.trim() || !canMutate}
              pending={writeKeyring.isPending}
              pendingText="Saving..."
              onClick={onAdd}
            >
              Save key
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  if (!wrapInSection) return content

  return (
    <SettingsSection title={props.title} description={props.description} headerBadge={props.headerBadge}>
      {content}
    </SettingsSection>
  )
}
