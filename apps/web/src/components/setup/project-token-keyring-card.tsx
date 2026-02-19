import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { toast } from "sonner"
import { generateProjectTokenKeyId, maskProjectToken, PROJECT_TOKEN_VALUE_MAX_CHARS } from "~/lib/project-token-keyring"
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
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import {
  queueProjectTokenKeyringUpdate,
} from "~/sdk/infra"

type ProjectTokenKeyringKind = "hcloud" | "tailscale"
type KeyringMutationAction = "add" | "remove" | "select"

type KeyringKindConfig = {
  label: string
  valuePlaceholder: string
}

type ProjectTokenKeyringItemSummary = {
  id: string
  label: string
  maskedValue: string
  isActive: boolean
}

type ProjectTokenKeyringSummary = {
  hasActive: boolean
  itemCount: number
  items: ProjectTokenKeyringItemSummary[]
}

const KEYRING_KIND_CONFIG: Record<ProjectTokenKeyringKind, KeyringKindConfig> = {
  hcloud: {
    label: "Hetzner API key",
    valuePlaceholder: "hcloud token",
  },
  tailscale: {
    label: "Tailscale auth key",
    valuePlaceholder: "tskey-auth-...",
  },
}

const DEPLOY_CREDS_RECONCILE_DELAYS_MS = [800, 2_000, 5_000] as const

export function ProjectTokenKeyringCard(props: {
  projectId: Id<"projects">
  kind: ProjectTokenKeyringKind
  setupHref?: string | null
  title: string
  description?: ReactNode
  headerBadge?: ReactNode
  runnerStatusMode?: "full" | "none"
  wrapInSection?: boolean
  showRunnerStatusBanner?: boolean
  showRunnerStatusDetails?: boolean
  statusSummary: {
    hasActive: boolean
    itemCount: number
    items?: ProjectTokenKeyringItemSummary[]
  }
  onQueued?: () => void
}) {
  const cfg = KEYRING_KIND_CONFIG[props.kind]
  const wrapInSection = props.wrapInSection !== false
  const runnerStatusMode = props.runnerStatusMode ?? "full"
  const showRunnerStatusBanner = props.showRunnerStatusBanner ?? (runnerStatusMode === "full")
  const showRunnerStatusDetails = props.showRunnerStatusDetails ?? (runnerStatusMode === "full")

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

  const selectedRunner = useMemo(
    () => {
      if (sealedRunners.length === 1) return sealedRunners[0]
      return sealedRunners.find((row) => String(row._id) === selectedRunnerId)
    },
    [sealedRunners, selectedRunnerId],
  )
  const readTargetRunnerId = selectedRunner ? String(selectedRunner._id) : ""
  const sourceSummary = useMemo<ProjectTokenKeyringSummary>(
    () => {
      const fromProps = props.statusSummary
      const items = Array.isArray(fromProps.items) ? fromProps.items : []
      return {
        hasActive: fromProps.hasActive === true,
        itemCount: Math.max(0, Number(fromProps.itemCount || items.length || 0)),
        items,
      }
    },
    [props.statusSummary],
  )
  const [optimisticSummary, setOptimisticSummary] = useState<ProjectTokenKeyringSummary | null>(null)
  useEffect(() => {
    setOptimisticSummary(null)
  }, [sourceSummary, readTargetRunnerId, props.kind])
  const effectiveSummary = optimisticSummary ?? sourceSummary
  const entries = effectiveSummary?.items ?? []
  const summaryItemCount = Math.max(0, Number(effectiveSummary?.itemCount || entries.length || 0))
  const summaryHasActive = effectiveSummary?.hasActive === true
  const activeEntry = useMemo(
    () => entries.find((entry) => entry.isActive) ?? null,
    [entries],
  )

  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [newValue, setNewValue] = useState("")

  const writeKeyring = useMutation({
    mutationFn: async (input: { action: KeyringMutationAction; keyId?: string; label?: string; value?: string }) => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (sealedRunners.length === 0) throw new Error("No sealed-capable runner online. Upgrade runner.")

      const runner = selectedRunner
      if (!runner) throw new Error("Select a sealed-capable runner")

      return await queueProjectTokenKeyringUpdate({
        data: {
          projectId: props.projectId,
          kind: props.kind,
          action: input.action,
          targetRunnerId: String(runner._id) as Id<"runners">,
          ...(input.keyId ? { keyId: input.keyId } : {}),
          ...(typeof input.label === "string" ? { label: input.label } : {}),
          ...(typeof input.value === "string" ? { value: input.value } : {}),
        },
      })
    },
    onSuccess: (_data, variables) => {
      if (variables.action === "add") {
        setAddOpen(false)
        setNewLabel("")
        setNewValue("")
      }
      setOptimisticSummary((current) => {
        const base: ProjectTokenKeyringSummary = current ?? sourceSummary ?? {
          hasActive: false,
          itemCount: 0,
          items: [],
        }
        const action = variables.action
        const keyId = String(variables.keyId || "").trim()
        const label = String(variables.label || "").trim()
        const value = String(variables.value || "")
        let nextItems = base.items.map((row) => ({ ...row }))
        let activeId = nextItems.find((row) => row.isActive)?.id || ""

        if (action === "add") {
          const id = keyId || generateProjectTokenKeyId(label)
          if (!nextItems.some((row) => row.id === id)) {
            const nextLabel = label || "Key"
            nextItems.push({
              id,
              label: nextLabel,
              maskedValue: maskProjectToken(value),
              isActive: false,
            })
            if (!activeId) activeId = id
          }
        } else if (action === "remove" && keyId) {
          const removed = nextItems.find((row) => row.id === keyId) ?? null
          nextItems = nextItems.filter((row) => row.id !== keyId)
          if (removed?.isActive) activeId = nextItems[0]?.id || ""
        } else if (action === "select" && keyId && nextItems.some((row) => row.id === keyId)) {
          activeId = keyId
        }

        nextItems = nextItems.map((row) => ({ ...row, isActive: row.id === activeId }))
        const hasActive = nextItems.some((row) => row.isActive)
        return {
          hasActive,
          itemCount: nextItems.length,
          items: nextItems,
        }
      })
      for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
        setTimeout(() => {
          void runnersQuery.refetch()
        }, delayMs)
      }

      props.onQueued?.()
      toast.success(`${cfg.label} update queued`)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const canMutate = runnerOnline
    && sealedRunners.length > 0
    && (sealedRunners.length === 1 || Boolean(selectedRunnerId))

  const onActivate = (id: string) => {
    void writeKeyring.mutate({ action: "select", keyId: id })
  }

  const onRemove = (id: string) => {
    void writeKeyring.mutate({ action: "remove", keyId: id })
  }

  const onAdd = () => {
    const value = newValue.trim()
    if (!value) return
    if (value.length > PROJECT_TOKEN_VALUE_MAX_CHARS) {
      toast.error(`Token too long (max ${PROJECT_TOKEN_VALUE_MAX_CHARS} characters)`)
      return
    }
    const keyId = generateProjectTokenKeyId(newLabel.trim())
    void writeKeyring.mutate({
      action: "add",
      keyId,
      label: newLabel.trim(),
      value,
    })
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

      {!runnerOnline ? null : (
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

          {entries.length === 0 ? (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {summaryItemCount === 0
                ? "No saved keys yet. Add at least one project key."
                : `${summaryItemCount} key${summaryItemCount === 1 ? "" : "s"} saved (${summaryHasActive ? "active selected" : "active missing"}).`}
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => {
                const isActive = entry.isActive
                return (
                  <div key={entry.id} className="rounded-md border bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{entry.label || "Key"}</div>
                        <code className="block truncate text-xs text-muted-foreground">{entry.maskedValue}</code>
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
            {summaryItemCount > 0 ? (
              <div className="text-xs text-muted-foreground">
                Status: {summaryHasActive ? "Active key set" : "Active key missing"}
              </div>
            ) : activeEntry ? (
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
