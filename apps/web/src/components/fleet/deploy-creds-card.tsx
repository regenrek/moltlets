import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { AsyncButton } from "~/components/ui/async-button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { WEB_DEPLOY_CREDS_EDITABLE_KEY_SET } from "~/lib/deploy-creds-ui"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import { detectSopsAgeKey, generateSopsAgeKey, getDeployCredsStatus, updateDeployCreds } from "~/sdk/infra"

type DeployCredsCardProps = {
  projectId: Id<"projects">
  setupHref?: string | null
}

async function submitLocalRunnerUpdates(params: {
  port: number
  nonce: string
  jobId: string
  updates: Record<string, string>
}): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${params.port}/secrets/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clawlets-nonce": params.nonce,
    },
    body: JSON.stringify({
      jobId: params.jobId,
      secrets: params.updates,
    }),
  })
  if (response.ok) return
  let detail = ""
  try {
    const payload = await response.json()
    detail = payload?.error ? String(payload.error) : ""
  } catch {
    // ignore
  }
  throw new Error(detail || `runner local submit failed (${response.status})`)
}

export function DeployCredsCard({ projectId, setupHref = null }: DeployCredsCardProps) {
  const queryClient = useQueryClient()
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId }),
  })
  const runnerOnline = useMemo(() => isProjectRunnerOnline(runnersQuery.data ?? []), [runnersQuery.data])

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

  const save = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      const updates: Record<string, string> = {
        ...(hcloudToken.trim() ? { HCLOUD_TOKEN: hcloudToken.trim() } : {}),
        ...(githubToken.trim() ? { GITHUB_TOKEN: githubToken.trim() } : {}),
        ...(sopsAgeKeyFile.trim() ? { SOPS_AGE_KEY_FILE: sopsAgeKeyFile.trim() } : {}),
      }
      const updatedKeys = Object.keys(updates).filter((key) => WEB_DEPLOY_CREDS_EDITABLE_KEY_SET.has(key))
      if (updatedKeys.length === 0) throw new Error("No changes to save")
      const queued = await updateDeployCreds({
        data: {
          projectId,
          updatedKeys,
        },
      })
      return { queued: queued as any, updates }
    },
    onSuccess: async ({ queued, updates }) => {
      const localSubmit = queued?.localSubmit
      if (
        queued?.localSubmitRequired
        && localSubmit
        && typeof localSubmit.port === "number"
        && typeof localSubmit.nonce === "string"
        && typeof queued.jobId === "string"
      ) {
        try {
          await submitLocalRunnerUpdates({
            port: Math.trunc(localSubmit.port),
            nonce: localSubmit.nonce,
            jobId: queued.jobId,
            updates,
          })
          toast.success("Queued and sent to local runner")
        } catch (err) {
          toast.warning(err instanceof Error ? err.message : "Runner local submit failed; use runner prompt fallback")
        }
      } else {
        toast.info("Queued. Runner prompt/input may be required.")
      }
      setHcloudToken("")
      setGithubToken("")
      setHcloudUnlocked(false)
      setGithubUnlocked(false)
      await queryClient.invalidateQueries({ queryKey: ["deployCreds", projectId] })
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
      title="Deploy credentials"
      description="Local-only operator tokens used by bootstrap, infra, and doctor."
      actions={
        <AsyncButton
          type="button"
          disabled={save.isPending || creds.isPending || runnersQuery.isPending || !runnerOnline}
          pending={save.isPending}
          pendingText="Saving..."
          onClick={() => save.mutate()}
        >
          Save
        </AsyncButton>
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

      {!runnerOnline ? null : creds.isPending ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : creds.error ? (
        <div className="text-sm text-destructive">{String(creds.error)}</div>
      ) : (
        <div className="space-y-4">
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

          <StackedField id="githubToken" label="GitHub token" help="GitHub token (GITHUB_TOKEN).">
            <SecretInput
              id="githubToken"
              value={githubToken}
              onValueChange={setGithubToken}
              placeholder={credsByKey["GITHUB_TOKEN"]?.status === "set" ? "set (click Remove to edit)" : "(recommended)"}
              locked={credsByKey["GITHUB_TOKEN"]?.status === "set" && !githubUnlocked}
              onUnlock={() => setGithubUnlocked(true)}
            />
          </StackedField>

          <StackedField
            id="sopsAgeKeyFile"
            label="SOPS age key file"
            help="Path to your operator age key file (SOPS_AGE_KEY_FILE)."
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
        </div>
      )}
    </SettingsSection>
  )
}
