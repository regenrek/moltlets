import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { WEB_DEPLOY_CREDS_EDITABLE_KEYS } from "~/lib/deploy-creds-ui"
import { sealForRunner } from "~/lib/security/sealed-input"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import {
  detectSopsAgeKey,
  finalizeDeployCreds,
  generateSopsAgeKey,
  getDeployCredsStatus,
  updateDeployCreds,
} from "~/sdk/infra"
import {
  buildSetupDraftSectionAad,
  setupDraftSaveSealedSection,
  type SetupDraftView,
} from "~/sdk/setup"

type DeployCredsCardProps = {
  projectId: Id<"projects">
  setupHref?: string | null
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
  } | null
}

type EditableDeployCredKey = (typeof WEB_DEPLOY_CREDS_EDITABLE_KEYS)[number]

type SaveFieldInput = {
  key: EditableDeployCredKey
  kind: "save" | "remove"
  value: string
}

export function DeployCredsCard({
  projectId,
  setupHref = null,
  setupDraftFlow,
  title = "Deploy credentials",
  description = "Local-only operator tokens used by bootstrap, infra, and doctor.",
  visibleKeys,
  headerBadge,
  githubRepoHint = null,
  githubFirstPushGuidance = null,
}: DeployCredsCardProps) {
  const queryClient = useQueryClient()
  const keysToShow = visibleKeys?.length ? visibleKeys : WEB_DEPLOY_CREDS_EDITABLE_KEYS
  const visibleKeySet = useMemo(() => new Set<string>(keysToShow), [keysToShow])
  const showGithubToken = visibleKeySet.has("GITHUB_TOKEN")
  const showSopsAgeKeyFile = visibleKeySet.has("SOPS_AGE_KEY_FILE")
  const setupMode = Boolean(setupDraftFlow)
  const [setupDraftValues, setSetupDraftValues] = useState<Partial<Record<EditableDeployCredKey, string>>>({})
  useEffect(() => {
    setSetupDraftValues({})
  }, [projectId, setupDraftFlow?.host])

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
    if (sealedRunners.length === 1) setSelectedRunnerId(String(sealedRunners[0]?._id || ""))
  }, [sealedRunners])

  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () => await getDeployCredsStatus({ data: { projectId } }),
    enabled: runnerOnline,
  })

  const credsByKey = useMemo(() => {
    const out: Record<string, { status?: "set" | "unset"; value?: string }> = {}
    for (const k of creds.data?.keys || []) out[k.key] = k
    return out
  }, [creds.data?.keys])

  const [githubToken, setGithubToken] = useState("")
  const [sopsAgeKeyFileOverride, setSopsAgeKeyFileOverride] = useState<string | undefined>(undefined)
  const [sopsStatus, setSopsStatus] = useState<{ kind: "ok" | "warn" | "error"; message: string } | null>(null)

  const defaultSopsAgeKeyFile = String(credsByKey["SOPS_AGE_KEY_FILE"]?.value || creds.data?.defaultSopsAgeKeyPath || "")
  const sopsAgeKeyFile = sopsAgeKeyFileOverride ?? defaultSopsAgeKeyFile
  const projectKeyIsSet = (key: EditableDeployCredKey): boolean => credsByKey[key]?.status === "set"
  const projectVisibleKeysReady = keysToShow.every((key) => projectKeyIsSet(key))
  const setupDraftDeployCredsSet = setupDraftFlow?.setupDraft?.sealedSecretDrafts?.deployCreds?.status === "set"
  const githubTokenRequired = Boolean(
    setupDraftFlow
    && showGithubToken
    && !setupDraftDeployCredsSet
    && !projectKeyIsSet("GITHUB_TOKEN"),
  )

  async function copyText(value: string): Promise<void> {
    if (!value.trim()) return
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // ignore
    }
  }

  const pickTargetRunner = () => {
    if (sealedRunners.length === 1) return sealedRunners[0]
    return sealedRunners.find((row) => String(row._id) === selectedRunnerId)
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
          section: "deployCreds",
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
            section: "deployCreds",
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

      const reserve = await updateDeployCreds({
        data: {
          projectId,
          targetRunnerId,
          updatedKeys: [input.key],
        },
      }) as any

      const jobId = String(reserve?.jobId || "").trim()
      const kind = String(reserve?.kind || "").trim()
      if (!jobId || !kind) throw new Error("reserve response missing job metadata")

      const reserveRunnerPub = String(reserve?.sealedInputPubSpkiB64 || runnerPub).trim()
      const reserveKeyId = String(reserve?.sealedInputKeyId || keyId).trim()
      const reserveAlg = String(reserve?.sealedInputAlg || alg).trim()
      const aad = `${projectId}:${jobId}:${kind}:${targetRunnerId}`
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: reserveRunnerPub,
        keyId: reserveKeyId,
        alg: reserveAlg,
        aad,
        plaintextJson: JSON.stringify(updates),
      })

      await finalizeDeployCreds({
        data: {
          projectId,
          jobId,
          kind,
          sealedInputB64,
          sealedInputAlg: reserveAlg,
          sealedInputKeyId: reserveKeyId,
          targetRunnerId,
          updatedKeys: [input.key],
        },
      })

      return input
    },
    onSuccess: async (input) => {
      toast.success(input.kind === "remove" ? `${input.key} removed` : `${input.key} saved`)
      if (input.key === "GITHUB_TOKEN") setGithubToken("")
      if (input.key === "SOPS_AGE_KEY_FILE") setSopsAgeKeyFileOverride(input.kind === "remove" ? "" : undefined)
      if (setupDraftFlow) await queryClient.invalidateQueries({ queryKey: ["setupDraft", projectId, setupDraftFlow.host] })
      else await queryClient.invalidateQueries({ queryKey: ["deployCreds", projectId] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const detectSops = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await detectSopsAgeKey({ data: { projectId } })
    },
    onSuccess: (res) => {
      if (res.recommendedPath) {
        setSopsAgeKeyFileOverride(res.recommendedPath)
        setSopsStatus({ kind: "ok", message: `Found key: ${res.recommendedPath}` })
      } else {
        setSopsStatus({ kind: "warn", message: "No valid age key found. Generate one below." })
      }
    },
    onError: (err) => {
      setSopsStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
    },
  })

  const generateSops = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await generateSopsAgeKey({ data: { projectId } })
    },
    onSuccess: async (res) => {
      if (res.ok) {
        setSopsAgeKeyFileOverride(res.keyPath)
        setSopsStatus({
          kind: "ok",
          message: res.created === false ? `Using existing key: ${res.keyPath}` : `Generated key: ${res.keyPath}`,
        })
        await queryClient.invalidateQueries({ queryKey: ["deployCreds", projectId] })
        toast.success(res.created === false ? "Using existing SOPS key" : "SOPS key generated")
      } else {
        setSopsStatus({ kind: "warn", message: res.message || "Key already exists." })
      }
    },
    onError: (err) => {
      setSopsStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
    },
  })

  const keyIsSet = (key: EditableDeployCredKey): boolean => {
    if (setupDraftFlow) return Boolean(setupDraftValues[key]?.trim())
    const status = credsByKey[key]?.status
    if (status === "set") return true
    if (status === "unset") return false
    return false
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
      <RunnerStatusBanner
        projectId={projectId}
        setupHref={setupHref}
        runnerOnline={runnerOnline}
        isChecking={runnersQuery.isPending}
      />

      {!runnerOnline && !runnersQuery.isPending ? (
        <div className="text-sm text-muted-foreground">
          Connect your runner to load and update deploy credentials.
        </div>
      ) : null}

      {runnerOnline && sealedRunners.length === 0 ? (
        <div className="text-sm text-destructive">
          No online runner advertises sealed input. Upgrade runner and retry.
        </div>
      ) : null}

      {!runnerOnline ? null : creds.isPending ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : creds.error ? (
        <div className="text-sm text-destructive">{String(creds.error)}</div>
      ) : (
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
            <StackedField
              id="githubToken"
              label="GitHub token"
              help={githubTokenRequired
                ? "GitHub token (GITHUB_TOKEN). Required for setup."
                : "GitHub token (GITHUB_TOKEN)."}
            >
              {githubRepoHint ? (
                <div className="mb-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {githubRepoHint}
                </div>
              ) : null}

              {githubFirstPushGuidance ? (
                <div className="mb-2 rounded-md border bg-muted/20 p-2 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">First push help</div>
                    <InputGroupButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void copyText(githubFirstPushGuidance.commands)}
                    >
                      Copy commands
                    </InputGroupButton>
                  </div>
                  <div className="text-muted-foreground">
                    {githubFirstPushGuidance.hasUpstream
                      ? `Upstream detected (${githubFirstPushGuidance.upstream || "configured"}). Push once, then refresh.`
                      : "No upstream detected. Set or update origin, push once, then refresh."}
                  </div>
                  <pre className="rounded-md border bg-muted/30 p-2 whitespace-pre-wrap break-words">
                    {githubFirstPushGuidance.commands}
                  </pre>
                </div>
              ) : null}

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
            </StackedField>
          ) : null}

          {showSopsAgeKeyFile ? (
            <StackedField
              id="sopsAgeKeyFile"
              label="SOPS age key file"
              help="Path to your operator age key file (SOPS_AGE_KEY_FILE)."
            >
              {keyIsSet("SOPS_AGE_KEY_FILE") ? (
                <InputGroup>
                  <InputGroupInput
                    id="sopsAgeKeyFile"
                    readOnly
                    value={sopsAgeKeyFile || "Saved path"}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      disabled={!canMutateKeys}
                      pending={keyActionPending("SOPS_AGE_KEY_FILE", "remove")}
                      pendingText="Removing..."
                      onClick={() => runRemoveKey("SOPS_AGE_KEY_FILE")}
                    >
                      Remove
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                <InputGroup>
                  <InputGroupInput
                    id="sopsAgeKeyFile"
                    value={sopsAgeKeyFile}
                    onChange={(e) => setSopsAgeKeyFileOverride(e.target.value)}
                    placeholder=".clawlets/keys/operators/<user>.agekey"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      disabled={!canMutateKeys || !sopsAgeKeyFile.trim()}
                      pending={keyActionPending("SOPS_AGE_KEY_FILE", "save")}
                      pendingText="Saving..."
                      onClick={() => runSaveKey("SOPS_AGE_KEY_FILE", sopsAgeKeyFile)}
                    >
                      Save
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              )}

              {!keyIsSet("SOPS_AGE_KEY_FILE") ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <InputGroupButton
                    variant="outline"
                    size="sm"
                    disabled={!runnerOnline || detectSops.isPending}
                    pending={detectSops.isPending}
                    pendingText="Finding..."
                    onClick={() => detectSops.mutate()}
                  >
                    Find
                  </InputGroupButton>
                  <InputGroupButton
                    variant="outline"
                    size="sm"
                    disabled={!runnerOnline || generateSops.isPending}
                    pending={generateSops.isPending}
                    pendingText="Generating..."
                    onClick={() => generateSops.mutate()}
                  >
                    Generate
                  </InputGroupButton>
                </div>
              ) : null}

              {sopsStatus ? (
                <div className={`text-xs ${sopsStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {sopsStatus.message}
                </div>
              ) : null}
            </StackedField>
          ) : null}
        </div>
      )}
    </SettingsSection>
  )
}
