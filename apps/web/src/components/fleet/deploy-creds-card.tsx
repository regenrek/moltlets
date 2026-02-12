import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { WEB_DEPLOY_CREDS_EDITABLE_KEYS, WEB_DEPLOY_CREDS_EDITABLE_KEY_SET } from "~/lib/deploy-creds-ui"
import { sealForRunner } from "~/lib/security/sealed-input"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import {
  detectSopsAgeKey,
  finalizeDeployCreds,
  generateSopsAgeKey,
  getDeployCredsStatus,
  updateDeployCreds,
} from "~/sdk/infra"

type DeployCredsCardProps = {
  projectId: Id<"projects">
  setupHref?: string | null
  setupAction?: {
    isComplete: boolean
    onContinue: () => void
  }
  title?: string
  description?: ReactNode
  visibleKeys?: ReadonlyArray<(typeof WEB_DEPLOY_CREDS_EDITABLE_KEYS)[number]>
}

export function DeployCredsCard({
  projectId,
  setupHref = null,
  setupAction,
  title = "Deploy credentials",
  description = "Local-only operator tokens used by bootstrap, infra, and doctor.",
  visibleKeys,
}: DeployCredsCardProps) {
  const queryClient = useQueryClient()
  const keysToShow = visibleKeys?.length ? visibleKeys : WEB_DEPLOY_CREDS_EDITABLE_KEYS
  const visibleKeySet = useMemo(() => new Set<string>(keysToShow), [keysToShow])
  const showHcloudToken = visibleKeySet.has("HCLOUD_TOKEN")
  const showGithubToken = visibleKeySet.has("GITHUB_TOKEN")
  const showSopsAgeKeyFile = visibleKeySet.has("SOPS_AGE_KEY_FILE")
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
    }
  }, [sealedRunners])

  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () => await getDeployCredsStatus({ data: { projectId } }),
    enabled: runnerOnline,
  })

  const credsByKey = useMemo(() => {
    const out: Record<string, any> = {}
    for (const k of creds.data?.keys || []) out[k.key] = k
    return out
  }, [creds.data?.keys])

  const [hcloudToken, setHcloudToken] = useState("")
  const [githubToken, setGithubToken] = useState("")
  const [hcloudUnlocked, setHcloudUnlocked] = useState(false)
  const [githubUnlocked, setGithubUnlocked] = useState(false)
  const [sopsAgeKeyFileOverride, setSopsAgeKeyFileOverride] = useState<string | undefined>(undefined)
  const [sopsStatus, setSopsStatus] = useState<{ kind: "ok" | "warn" | "error"; message: string } | null>(null)

  const defaultSopsAgeKeyFile = String(
    credsByKey["SOPS_AGE_KEY_FILE"]?.value || creds.data?.defaultSopsAgeKeyPath || "",
  )
  const sopsAgeKeyFile = sopsAgeKeyFileOverride ?? defaultSopsAgeKeyFile
  const githubTokenRequired = Boolean(setupAction && showGithubToken)

  const save = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      if (sealedRunners.length === 0) throw new Error("No sealed-capable runner online. Upgrade runner.")
      const nextSopsAgeKeyFile = sopsAgeKeyFile.trim()
      const shouldUpdateSopsAgeKeyFile = showSopsAgeKeyFile
        && ((sopsAgeKeyFileOverride !== undefined && nextSopsAgeKeyFile.length > 0)
          || (sopsAgeKeyFileOverride === undefined
            && credsByKey["SOPS_AGE_KEY_FILE"]?.status !== "set"
            && nextSopsAgeKeyFile.length > 0))
      const updates: Record<string, string> = {
        ...(showHcloudToken && hcloudToken.trim() ? { HCLOUD_TOKEN: hcloudToken.trim() } : {}),
        ...(showGithubToken && githubToken.trim() ? { GITHUB_TOKEN: githubToken.trim() } : {}),
        ...(shouldUpdateSopsAgeKeyFile ? { SOPS_AGE_KEY_FILE: nextSopsAgeKeyFile } : {}),
      }
      const updatedKeys = Object.keys(updates).filter((key) => WEB_DEPLOY_CREDS_EDITABLE_KEY_SET.has(key))
      if (updatedKeys.length === 0) throw new Error("No changes to save")
      const runner =
        sealedRunners.length === 1
          ? sealedRunners[0]
          : sealedRunners.find((row) => String(row._id) === selectedRunnerId)
      if (!runner) throw new Error("Select a sealed-capable runner")
      const targetRunnerId = String(runner._id)
      const reserve = await updateDeployCreds({
        data: {
          projectId,
          targetRunnerId,
          updatedKeys,
        },
      }) as any
      const jobId = String(reserve?.jobId || "").trim()
      const kind = String(reserve?.kind || "").trim()
      if (!jobId || !kind) throw new Error("reserve response missing job metadata")
      const runnerPub = String(reserve?.sealedInputPubSpkiB64 || runner.capabilities?.sealedInputPubSpkiB64 || "").trim()
      const keyId = String(reserve?.sealedInputKeyId || runner.capabilities?.sealedInputKeyId || "").trim()
      const alg = String(reserve?.sealedInputAlg || runner.capabilities?.sealedInputAlg || "").trim()
      if (!runnerPub || !keyId || !alg) throw new Error("runner sealed-input capabilities incomplete")
      const aad = `${projectId}:${jobId}:${kind}:${targetRunnerId}`
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: runnerPub,
        keyId,
        alg,
        aad,
        plaintextJson: JSON.stringify(updates),
      })
      const queued = await finalizeDeployCreds({
        data: {
          projectId,
          jobId,
          kind,
          sealedInputB64,
          sealedInputAlg: alg,
          sealedInputKeyId: keyId,
          targetRunnerId,
          updatedKeys,
        },
      })
      return { queued }
    },
    onSuccess: () => {
      toast.success("Queued sealed update to runner")
      setHcloudToken("")
      setGithubToken("")
      setHcloudUnlocked(false)
      setGithubUnlocked(false)
      void queryClient.invalidateQueries({ queryKey: ["deployCreds", projectId] })
    },
    onError: (err) => {
      toast.error(String(err))
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
        setSopsStatus({ kind: "ok", message: `Generated key: ${res.keyPath}` })
        await queryClient.invalidateQueries({ queryKey: ["deployCreds", projectId] })
        toast.success("SOPS key generated")
      } else {
        setSopsStatus({ kind: "warn", message: res.message || "Key already exists." })
      }
    },
    onError: (err) => {
      setSopsStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
    },
  })

  return (
    <SettingsSection
      title={title}
      description={description}
      actions={
        setupAction?.isComplete ? (
          <Button type="button" onClick={setupAction.onContinue}>
            Continue
          </Button>
        ) : (
          <AsyncButton
            type="button"
            disabled={
              save.isPending
              || creds.isPending
              || runnersQuery.isPending
              || !runnerOnline
              || sealedRunners.length === 0
              || (sealedRunners.length > 1 && !selectedRunnerId)
            }
            pending={save.isPending}
            pendingText="Saving..."
            onClick={() => save.mutate()}
          >
            {setupAction ? "Save and continue" : "Save"}
          </AsyncButton>
        )
      }
    >
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
          {showHcloudToken ? (
            <StackedField id="hcloudToken" label="Hetzner API token" help="Hetzner Cloud API token (HCLOUD_TOKEN).">
              <SecretInput
                id="hcloudToken"
                value={hcloudToken}
                onValueChange={setHcloudToken}
                placeholder={credsByKey["HCLOUD_TOKEN"]?.status === "set" ? "set (click Remove to edit)" : "(required)"}
                locked={credsByKey["HCLOUD_TOKEN"]?.status === "set" && !hcloudUnlocked}
                onUnlock={() => setHcloudUnlocked(true)}
              />
            </StackedField>
          ) : null}

          {showGithubToken ? (
            <StackedField
              id="githubToken"
              label="GitHub token"
              help={githubTokenRequired
                ? "GitHub token (GITHUB_TOKEN). Required for Setup."
                : "GitHub token (GITHUB_TOKEN)."}
              description={(
                <>
                  Need help creating one?{" "}
                  <a
                    className="underline underline-offset-3 hover:text-foreground"
                    href="https://docs.clawlets.com/dashboard/github-token"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open GitHub token guide
                  </a>
                  .
                </>
              )}
            >
              <SecretInput
                id="githubToken"
                value={githubToken}
                onValueChange={setGithubToken}
                placeholder={credsByKey["GITHUB_TOKEN"]?.status === "set"
                  ? "set (click Remove to edit)"
                  : githubTokenRequired
                    ? "(required)"
                    : "(recommended)"}
                locked={credsByKey["GITHUB_TOKEN"]?.status === "set" && !githubUnlocked}
                onUnlock={() => setGithubUnlocked(true)}
              />
            </StackedField>
          ) : null}

          {showSopsAgeKeyFile ? (
            <StackedField
              id="sopsAgeKeyFile"
              label="SOPS age key file"
              help="Path to your operator age key file (SOPS_AGE_KEY_FILE)."
              description={(
                <>
                  Need one?{" "}
                  <a
                    className="underline underline-offset-3 hover:text-foreground"
                    href="https://docs.clawlets.com/dashboard/sops-age-key"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open SOPS age key guide
                  </a>
                  .
                </>
              )}
            >
              <InputGroup>
                <InputGroupInput
                  id="sopsAgeKeyFile"
                  value={sopsAgeKeyFile}
                  onChange={(e) => setSopsAgeKeyFileOverride(e.target.value)}
                  placeholder=".clawlets/keys/operators/<user>.agekey"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    disabled={!runnerOnline || detectSops.isPending}
                    pending={detectSops.isPending}
                    pendingText="Finding..."
                    onClick={() => detectSops.mutate()}
                  >
                    Find
                  </InputGroupButton>
                  <InputGroupButton
                    disabled={!runnerOnline || generateSops.isPending}
                    pending={generateSops.isPending}
                    pendingText="Generating..."
                    onClick={() => generateSops.mutate()}
                  >
                    Generate
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
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
