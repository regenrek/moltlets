import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Badge } from "~/components/ui/badge"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import { StackedField } from "~/components/ui/stacked-field"
import { WEB_DEPLOY_CREDS_EDITABLE_KEYS } from "~/lib/deploy-creds-ui"
import { sealForRunner } from "~/lib/security/sealed-input"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import {
  queueDeployCredsUpdate,
} from "~/sdk/infra"
import {
  buildSetupDraftSectionAad,
  setupDraftSaveSealedSection,
  type SetupDraftView,
} from "~/sdk/setup"

type EditableDeployCredKey = (typeof WEB_DEPLOY_CREDS_EDITABLE_KEYS)[number]

type DeployCredKeyStatusSummary = Partial<Record<EditableDeployCredKey, {
  status: "set" | "unset"
  value?: string
}>>

type DeployCredsCardProps = {
  projectId: Id<"projects">
  setupHref?: string | null
  runnerStatusMode?: "full" | "none"
  setupDraftFlow?: {
    host: string
    setupDraft: SetupDraftView | null
  }
  title?: string
  description?: ReactNode
  visibleKeys?: ReadonlyArray<(typeof WEB_DEPLOY_CREDS_EDITABLE_KEYS)[number]>
  headerBadge?: ReactNode
  githubRepoHint?: ReactNode
  githubFirstPushGuidance?: {
    commands: string
    hasUpstream: boolean
    upstream?: string | null
    note?: string
  } | null
  githubReadiness?: {
    runnerOnline: boolean
    pending: boolean
    refreshing: boolean
    originHead?: string | null
    branch?: string | null
    upstream?: string | null
    ahead?: number | null
    behind?: number | null
    onRefresh?: () => void
    alert?: {
      severity: "info" | "warning" | "error"
      message: string
      title?: string
      detail?: string
    } | null
  } | null
  statusSummary?: DeployCredKeyStatusSummary | null
  onQueued?: () => void
}

type SaveFieldInput = {
  key: EditableDeployCredKey
  kind: "save" | "remove"
  value: string
}

const DEPLOY_CREDS_RECONCILE_DELAYS_MS = [800, 2_000, 5_000] as const
const DEPLOY_CREDS_OPTIMISTIC_STATUS_TTL_MS = 15_000

type OptimisticDeployCredStatus = "set" | "unset"

export function DeployCredsCard({
  projectId,
  setupHref = null,
  runnerStatusMode = "full",
  setupDraftFlow,
  title = "Deploy credentials",
  description = "Local-only operator tokens used by bootstrap, infra, and doctor.",
  visibleKeys,
  headerBadge,
  githubRepoHint = null,
  githubFirstPushGuidance = null,
  githubReadiness = null,
  statusSummary = null,
  onQueued,
}: DeployCredsCardProps) {
  const queryClient = useQueryClient()
  const keysToShow = visibleKeys?.length ? visibleKeys : WEB_DEPLOY_CREDS_EDITABLE_KEYS
  const visibleKeySet = useMemo(() => new Set<string>(keysToShow), [keysToShow])
  const showGithubToken = visibleKeySet.has("GITHUB_TOKEN")
  const showSopsAgeKeyFile = visibleKeySet.has("SOPS_AGE_KEY_FILE")
  const setupMode = Boolean(setupDraftFlow)
  const [setupDraftValues, setSetupDraftValues] = useState<Partial<Record<EditableDeployCredKey, string>>>({})
  const [optimisticKeyStatus, setOptimisticKeyStatus] = useState<Partial<Record<EditableDeployCredKey, OptimisticDeployCredStatus>>>({})
  const optimisticStatusTimeoutsRef = useRef<Partial<Record<EditableDeployCredKey, ReturnType<typeof setTimeout>>>>({})

  const clearOptimisticStatusTimers = () => {
    const timeouts = optimisticStatusTimeoutsRef.current
    for (const timeout of Object.values(timeouts)) {
      if (!timeout) continue
      clearTimeout(timeout)
    }
    optimisticStatusTimeoutsRef.current = {}
  }

  const setOptimisticStatus = (key: EditableDeployCredKey, status: OptimisticDeployCredStatus) => {
    setOptimisticKeyStatus((prev) => ({ ...prev, [key]: status }))

    const existing = optimisticStatusTimeoutsRef.current[key]
    if (existing) clearTimeout(existing)

    optimisticStatusTimeoutsRef.current[key] = setTimeout(() => {
      setOptimisticKeyStatus((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
      const active = optimisticStatusTimeoutsRef.current[key]
      if (active) clearTimeout(active)
      delete optimisticStatusTimeoutsRef.current[key]
    }, DEPLOY_CREDS_OPTIMISTIC_STATUS_TTL_MS)
  }

  useEffect(() => {
    setSetupDraftValues({})
    setOptimisticKeyStatus({})
    clearOptimisticStatusTimers()
  }, [projectId, setupDraftFlow?.host])
  useEffect(() => {
    return () => {
      clearOptimisticStatusTimers()
    }
  }, [])

  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId }),
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
      if (sealedRunners.length === 1) return sealedRunners[0] ?? null
      return sealedRunners.find((row) => String(row._id) === selectedRunnerId) ?? null
    },
    [sealedRunners, selectedRunnerId],
  )

  const [githubToken, setGithubToken] = useState("")
  const effectiveStatusSummary = useMemo<DeployCredKeyStatusSummary>(
    () => {
      if (statusSummary) return statusSummary
      const runnerSummary = selectedRunner?.deployCredsSummary
      if (!runnerSummary) return {}
      return {
        GITHUB_TOKEN: { status: runnerSummary.hasGithubToken ? "set" : "unset" },
        SOPS_AGE_KEY_FILE: { status: runnerSummary.sopsAgeKeyFileSet ? "set" : "unset" },
      }
    },
    [selectedRunner?.deployCredsSummary, statusSummary],
  )
  const projectKeyIsSet = (key: EditableDeployCredKey): boolean => {
    const optimistic = optimisticKeyStatus[key]
    if (optimistic === "set") return true
    if (optimistic === "unset") return false
    const summaryStatus = effectiveStatusSummary[key]?.status
    if (summaryStatus === "set") return true
    if (summaryStatus === "unset") return false
    return false
  }
  const projectVisibleKeysReady = keysToShow.every((key) => projectKeyIsSet(key))
  const setupDraftDeployCredsSet = setupDraftFlow?.setupDraft?.sealedSecretDrafts?.hostBootstrapCreds?.status === "set"
  const githubTokenRequired = Boolean(
    setupDraftFlow
    && showGithubToken
    && !setupDraftDeployCredsSet
    && !projectKeyIsSet("GITHUB_TOKEN"),
  )

  const pickTargetRunner = () => {
    if (sealedRunners.length === 1) return sealedRunners[0]
    return sealedRunners.find((row) => String(row._id) === selectedRunnerId)
  }

  function formatShortSha(sha?: string | null): string {
    return String(sha || "").trim().slice(0, 7) || "none"
  }

  const saveField = useMutation({
    mutationFn: async (input: SaveFieldInput) => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (sealedRunners.length === 0) throw new Error("No sealed-capable runner online. Upgrade runner.")

      const normalized = input.kind === "remove" ? "" : input.value.trim()
      if (input.kind === "save" && !normalized) throw new Error("Value is required")

      const runner = pickTargetRunner()
      if (!runner) throw new Error("Select a sealed-capable runner")

      const targetRunnerId = String(runner._id) as Id<"runners">
      const runnerPub = String(runner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(runner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(runner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("runner sealed-input capabilities incomplete")

      if (setupDraftFlow) {
        const sessionValues = { ...setupDraftValues }
        if (input.kind === "remove") delete sessionValues[input.key]
        else sessionValues[input.key] = normalized

        const updates = Object.fromEntries(
          Object.entries(sessionValues)
            .filter(([, value]) => typeof value === "string" && value.trim().length > 0),
        ) as Record<string, string>
        if (Object.keys(updates).length === 0) {
          throw new Error("At least one deploy credential value is required for setup draft")
        }

        const setupAad = buildSetupDraftSectionAad({
          projectId,
          host: setupDraftFlow.host,
          section: "hostBootstrapCreds",
          targetRunnerId,
        })
        const setupDraftSealedInputB64 = await sealForRunner({
          runnerPubSpkiB64: runnerPub,
          keyId,
          alg,
          aad: setupAad,
          plaintextJson: JSON.stringify(updates),
        })

        await setupDraftSaveSealedSection({
          data: {
            projectId,
            host: setupDraftFlow.host,
            section: "hostBootstrapCreds",
            targetRunnerId,
            sealedInputB64: setupDraftSealedInputB64,
            sealedInputAlg: alg,
            sealedInputKeyId: keyId,
            aad: setupAad,
            expectedVersion: setupDraftFlow.setupDraft?.version,
          },
        })
        setSetupDraftValues(updates)
        return input
      }

      const updates: Record<string, string> = {
        [input.key]: normalized,
      }
      await queueDeployCredsUpdate({
        data: {
          projectId,
          targetRunnerId,
          updates,
        },
      })

      return input
    },
    onSuccess: async (input) => {
      toast.success(input.kind === "remove" ? `${input.key} removed` : `${input.key} saved`)
      onQueued?.()
      setOptimisticStatus(input.key, input.kind === "remove" ? "unset" : "set")
      if (input.key === "GITHUB_TOKEN") setGithubToken("")
      if (setupDraftFlow) {
        await queryClient.invalidateQueries({ queryKey: ["setupDraft", projectId, setupDraftFlow.host] })
        return
      }
      for (const delayMs of DEPLOY_CREDS_RECONCILE_DELAYS_MS) {
        setTimeout(() => {
          void runnersQuery.refetch()
        }, delayMs)
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const keyIsSet = (key: EditableDeployCredKey): boolean => {
    if (setupDraftFlow) {
      if (setupDraftValues[key]?.trim()) return true
      return setupDraftDeployCredsSet
    }
    return projectKeyIsSet(key)
  }

  const runSaveKey = (key: EditableDeployCredKey, value: string) => {
    saveField.mutate({ key, kind: "save", value })
  }

  const runRemoveKey = (key: EditableDeployCredKey) => {
    saveField.mutate({ key, kind: "remove", value: "" })
  }

  const keyActionPending = (key: EditableDeployCredKey, kind: "save" | "remove"): boolean => {
    return saveField.isPending && saveField.variables?.key === key && saveField.variables?.kind === kind
  }

  const canMutateKeys = runnerOnline
    && sealedRunners.length > 0
    && (sealedRunners.length === 1 || Boolean(selectedRunnerId))

  return (
    <SettingsSection title={title} description={description} headerBadge={headerBadge}>
      {runnerStatusMode !== "none" ? (
        <RunnerStatusBanner
          projectId={projectId}
          setupHref={setupHref}
          runnerOnline={runnerOnline}
          isChecking={runnersQuery.isPending}
        />
      ) : null}

      {runnerStatusMode !== "none" && !runnerOnline && !runnersQuery.isPending ? (
        <div className="text-sm text-muted-foreground">
          Connect your runner to load and update deploy credentials.
        </div>
      ) : null}

      {runnerStatusMode !== "none" && runnerOnline && sealedRunners.length === 0 ? (
        <div className="text-sm text-destructive">
          No online runner advertises sealed input. Upgrade runner and retry.
        </div>
      ) : null}

      {!runnerOnline ? null : (
        <div className="space-y-4">
          {setupMode && projectVisibleKeysReady ? (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {showGithubToken && showSopsAgeKeyFile
                ? "Project GitHub token and SOPS path already exist."
                : showGithubToken
                  ? "Project GitHub token already exists."
                  : "Project SOPS path already exists."}{" "}
              Setup reuses project credentials across hosts. Enter values below only to override for this host draft.
            </div>
          ) : null}

          {setupMode && setupDraftDeployCredsSet ? (
            <div className="text-xs text-muted-foreground">
              Existing setup draft credentials are write-only. Enter new values to replace what is sealed.
            </div>
          ) : null}

          {sealedRunners.length > 1 ? (
            <StackedField
              id="deployCredsRunner"
              label="Target runner"
              help="Sealed-input jobs must target exactly one online runner."
            >
              <select
                id="deployCredsRunner"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedRunnerId}
                onChange={(e) => setSelectedRunnerId(e.target.value)}
              >
                <option value="">Select runner…</option>
                {sealedRunners.map((runner) => (
                  <option key={runner._id} value={String(runner._id)}>
                    {runner.runnerName}
                  </option>
                ))}
              </select>
            </StackedField>
          ) : null}

          {showGithubToken ? (
            <div className="space-y-2">
              {githubReadiness ? (
                <div className="mb-2 rounded-md border bg-muted/30 p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">Git push readiness</div>
                    <AsyncButton
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!githubReadiness.runnerOnline || githubReadiness.refreshing}
                      pending={githubReadiness.refreshing}
                      pendingText="Refreshing..."
                      onClick={() => githubReadiness.onRefresh?.()}
                    >
                      Refresh
                    </AsyncButton>
                  </div>

                  {githubReadiness.pending ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Spinner className="size-3" />
                      Checking repo state...
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1 text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <span>Revision to deploy</span>
                          <code>{formatShortSha(githubReadiness.originHead)}</code>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Branch</span>
                          <span>{githubReadiness.branch || "unknown"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Upstream</span>
                          <span>{githubReadiness.upstream || "unset"}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">ahead {githubReadiness.ahead ?? 0}</Badge>
                        <Badge variant="outline">behind {githubReadiness.behind ?? 0}</Badge>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {githubReadiness?.alert ? (
                <Alert
                  variant={githubReadiness.alert.severity === "error" ? "destructive" : "default"}
                  className={githubReadiness.alert.severity === "warning"
                    ? "mb-2 border-amber-300/50 bg-amber-50/50 text-amber-900 [&_[data-slot=alert-description]]:text-amber-900/90"
                    : "mb-2"}
                >
                  <AlertTitle>{githubReadiness.alert.title || "Deploy blocked"}</AlertTitle>
                  <AlertDescription>
                    {githubReadiness.alert.detail || githubReadiness.alert.message}
                  </AlertDescription>
                </Alert>
              ) : null}

              {githubFirstPushGuidance ? (
                <div className="mb-2 rounded-md border bg-muted/20 p-2 text-xs space-y-2">
                  <div className="font-medium">First push help</div>
                  <div className="text-muted-foreground">
                    {githubFirstPushGuidance.hasUpstream
                      ? `Upstream detected (${githubFirstPushGuidance.upstream || "configured"}). Push once, then refresh.`
                      : "No upstream detected. Use the path below, set/update origin, push once, then refresh."}
                  </div>
                  <pre className="rounded-md border bg-muted/30 p-2 whitespace-pre-wrap break-words">
                    {githubFirstPushGuidance.commands}
                  </pre>
                  {githubFirstPushGuidance.note ? (
                    <div className="text-muted-foreground">{githubFirstPushGuidance.note}</div>
                  ) : null}
                </div>
              ) : null}

              {githubRepoHint ? (
                <div className="mb-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {githubRepoHint}
                </div>
              ) : null}

              <LabelWithHelp
                htmlFor="githubToken"
                className="text-sm font-medium"
                help={githubTokenRequired
                  ? "GitHub token (GITHUB_TOKEN). Required for setup."
                  : "GitHub token (GITHUB_TOKEN)."}
              >
                GitHub token
              </LabelWithHelp>

              {keyIsSet("GITHUB_TOKEN") ? (
                <InputGroup>
                  <InputGroupInput id="githubToken" readOnly value="Saved for this project" />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      disabled={!canMutateKeys}
                      pending={keyActionPending("GITHUB_TOKEN", "remove")}
                      pendingText="Removing..."
                      onClick={() => runRemoveKey("GITHUB_TOKEN")}
                    >
                      Remove
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <InputGroup>
                  <InputGroupInput
                    id="githubToken"
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder={githubTokenRequired ? "Required" : "Recommended"}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      disabled={!canMutateKeys || !githubToken.trim()}
                      pending={keyActionPending("GITHUB_TOKEN", "save")}
                      pendingText="Saving..."
                      onClick={() => runSaveKey("GITHUB_TOKEN", githubToken)}
                    >
                      Save
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              )}
            </div>
          ) : null}

          {showSopsAgeKeyFile ? (
            <StackedField
              id="sopsAgeKeyFile"
              label="SOPS age key file"
              help="Host-scoped SOPS key path is configured during host setup deploy."
            >
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Project-wide SOPS path editing was removed. This value is host-scoped and is written during setup apply.
              </div>
            </StackedField>
          ) : null}
        </div>
      )}
    </SettingsSection>
  )
}
