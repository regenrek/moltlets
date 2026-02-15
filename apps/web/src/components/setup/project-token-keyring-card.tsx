import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  getDeployCredsStatus,
  mutateProjectTokenKeyring,
  type DeployCredsStatus,
  type ProjectTokenKeyringStatus,
} from "~/sdk/infra"

type ProjectTokenKeyringKind = "hcloud" | "tailscale"
type KeyringMutationAction = "add" | "remove" | "select"

type KeyringKindConfig = {
  label: string
  valuePlaceholder: string
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

const KEYRING_ENV_KEYS = {
  hcloud: {
    keyringKey: "HCLOUD_TOKEN_KEYRING",
    activeKey: "HCLOUD_TOKEN_KEYRING_ACTIVE",
  },
  tailscale: {
    keyringKey: "TAILSCALE_AUTH_KEY_KEYRING",
    activeKey: "TAILSCALE_AUTH_KEY_KEYRING_ACTIVE",
  },
} as const

const DEPLOY_CREDS_RECONCILE_DELAYS_MS = [800, 2_000, 5_000] as const

export function ProjectTokenKeyringCard(props: {
  projectId: Id<"projects">
  kind: ProjectTokenKeyringKind
  setupHref?: string | null
  title: string
  description?: ReactNode
  headerBadge?: ReactNode
  wrapInSection?: boolean
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

  const selectedRunner = useMemo(
    () => {
      if (sealedRunners.length === 1) return sealedRunners[0]
      return sealedRunners.find((row) => String(row._id) === selectedRunnerId)
    },
    [sealedRunners, selectedRunnerId],
  )
  const readTargetRunnerId = selectedRunner ? String(selectedRunner._id) : ""

  const deployCreds = useQuery({
    queryKey: ["deployCreds", props.projectId, readTargetRunnerId],
    queryFn: async () => await getDeployCredsStatus({
      data: {
        projectId: props.projectId,
        ...(readTargetRunnerId ? { targetRunnerId: readTargetRunnerId } : {}),
      },
    }),
    enabled: runnerOnline && (sealedRunners.length === 1 || Boolean(readTargetRunnerId)),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const keyring = deployCreds.data?.projectTokenKeyringStatuses?.[props.kind] ?? null
  const entries = keyring?.items ?? []
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

      return await mutateProjectTokenKeyring({
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
      queryClient.setQueryData<DeployCredsStatus | undefined>(
        ["deployCreds", props.projectId, readTargetRunnerId],
        (current) => {
          if (!current) return current
          const cfg = KEYRING_ENV_KEYS[props.kind]
          const currentKeyring = current.projectTokenKeyringStatuses?.[props.kind]
          const currentItems = currentKeyring?.items ?? []
          const currentActiveId = String(currentKeyring?.activeId || "").trim()
          const currentActive = currentItems.find((row) => row.isActive) ?? null

          const action = variables.action
          const keyId = String(variables.keyId || "").trim()
          const label = String(variables.label || "").trim()
          const value = String(variables.value || "")

          let nextItems = currentItems
          let nextActiveId = currentActiveId

          if (action === "add") {
            const id = keyId || generateProjectTokenKeyId(label)
            const maskedValue = maskProjectToken(value)
            const nextLabel = label || "Key"
            if (currentItems.some((row) => row.id === id)) return current
            nextItems = [
              ...currentItems,
              { id, label: nextLabel, maskedValue, isActive: false },
            ]
            if (!currentActive) nextActiveId = id
          } else if (action === "remove") {
            if (!keyId) return current
            const removed = currentItems.find((row) => row.id === keyId) ?? null
            nextItems = currentItems.filter((row) => row.id !== keyId)
            if (!removed) return current
            if (removed.isActive) nextActiveId = nextItems[0]?.id || ""
          } else if (action === "select") {
            if (!keyId) return current
            if (!currentItems.some((row) => row.id === keyId)) return current
            nextActiveId = keyId
          }

          nextItems = nextItems.map((row) => ({ ...row, isActive: row.id === nextActiveId }))
          const hasActive = nextItems.some((row) => row.isActive)
          const nextKeyring: ProjectTokenKeyringStatus = {
            kind: props.kind,
            keyringKey: cfg.keyringKey,
            activeKey: cfg.activeKey,
            activeId: nextActiveId,
            hasActive,
            items: nextItems,
          }
          return {
            ...current,
            projectTokenKeyrings: {
              ...current.projectTokenKeyrings,
              [props.kind]: {
                activeId: nextKeyring.activeId,
                itemCount: nextKeyring.items.length,
                hasActive: nextKeyring.hasActive,
              },
            },
            projectTokenKeyringStatuses: {
              ...current.projectTokenKeyringStatuses,
              [props.kind]: nextKeyring,
            },
          }
        },
      )

      for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["deployCreds", props.projectId] })
        }, delayMs)
      }

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

      {!runnerOnline ? null : deployCreds.isPending ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : deployCreds.error ? (
        <div className="text-sm text-destructive">{String(deployCreds.error)}</div>
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

          {entries.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              No saved keys yet. Add at least one project key.
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
