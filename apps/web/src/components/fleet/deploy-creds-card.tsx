import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "~/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { StackedField } from "~/components/ui/stacked-field"
import { detectSopsAgeKey, generateSopsAgeKey, getDeployCredsStatus, updateDeployCreds } from "~/sdk/infra"

type DeployCredsCardProps = {
  projectId: Id<"projects">
}

export function DeployCredsCard({ projectId }: DeployCredsCardProps) {
  const queryClient = useQueryClient()
  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () => await getDeployCredsStatus({ data: { projectId } }),
  })

  const credsByKey = useMemo(() => {
    const out: Record<string, any> = {}
    for (const k of creds.data?.keys || []) out[k.key] = k
    return out
  }, [creds.data?.keys])

  const [hcloudToken, setHcloudToken] = useState("")
  const [githubToken, setGithubToken] = useState("")
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("")
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("")
  const [awsSessionToken, setAwsSessionToken] = useState("")
  const [hcloudUnlocked, setHcloudUnlocked] = useState(false)
  const [githubUnlocked, setGithubUnlocked] = useState(false)
  const [awsAccessKeyUnlocked, setAwsAccessKeyUnlocked] = useState(false)
  const [awsSecretAccessKeyUnlocked, setAwsSecretAccessKeyUnlocked] = useState(false)
  const [awsSessionTokenUnlocked, setAwsSessionTokenUnlocked] = useState(false)
  const [sopsAgeKeyFileOverride, setSopsAgeKeyFileOverride] = useState<string | undefined>(undefined)
  const [sopsStatus, setSopsStatus] = useState<{ kind: "ok" | "warn" | "error"; message: string } | null>(null)

  const defaultSopsAgeKeyFile = String(
    credsByKey["SOPS_AGE_KEY_FILE"]?.value || creds.data?.defaultSopsAgeKeyPath || "",
  )
  const sopsAgeKeyFile = sopsAgeKeyFileOverride ?? defaultSopsAgeKeyFile

  const save = useMutation({
    mutationFn: async () => {
      return await updateDeployCreds({
        data: {
          projectId,
          updates: {
            ...(hcloudToken.trim() ? { HCLOUD_TOKEN: hcloudToken.trim() } : {}),
            ...(githubToken.trim() ? { GITHUB_TOKEN: githubToken.trim() } : {}),
            ...(awsAccessKeyId.trim() ? { AWS_ACCESS_KEY_ID: awsAccessKeyId.trim() } : {}),
            ...(awsSecretAccessKey.trim() ? { AWS_SECRET_ACCESS_KEY: awsSecretAccessKey.trim() } : {}),
            ...(awsSessionToken.trim() ? { AWS_SESSION_TOKEN: awsSessionToken.trim() } : {}),
            SOPS_AGE_KEY_FILE: sopsAgeKeyFile.trim(),
          },
        },
      })
    },
    onSuccess: async () => {
      toast.success("Saved")
      setHcloudToken("")
      setGithubToken("")
      setAwsAccessKeyId("")
      setAwsSecretAccessKey("")
      setAwsSessionToken("")
      setHcloudUnlocked(false)
      setGithubUnlocked(false)
      setAwsAccessKeyUnlocked(false)
      setAwsSecretAccessKeyUnlocked(false)
      setAwsSessionTokenUnlocked(false)
      await queryClient.invalidateQueries({ queryKey: ["deployCreds", projectId] })
    },
    onError: (err) => {
      toast.error(String(err))
    },
  })

  const detectSops = useMutation({
    mutationFn: async () => await detectSopsAgeKey({ data: { projectId } }),
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
    mutationFn: async () => await generateSopsAgeKey({ data: { projectId } }),
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
        <Button type="button" disabled={save.isPending || creds.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      {creds.isPending ? (
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

          <StackedField id="awsAccessKeyId" label="AWS access key id" help="AWS access key id (AWS_ACCESS_KEY_ID).">
            <SecretInput
              id="awsAccessKeyId"
              value={awsAccessKeyId}
              onValueChange={setAwsAccessKeyId}
              placeholder={credsByKey["AWS_ACCESS_KEY_ID"]?.status === "set" ? "set (click Remove to edit)" : "(required for aws hosts)"}
              locked={credsByKey["AWS_ACCESS_KEY_ID"]?.status === "set" && !awsAccessKeyUnlocked}
              onUnlock={() => setAwsAccessKeyUnlocked(true)}
            />
          </StackedField>

          <StackedField id="awsSecretAccessKey" label="AWS secret access key" help="AWS secret access key (AWS_SECRET_ACCESS_KEY).">
            <SecretInput
              id="awsSecretAccessKey"
              value={awsSecretAccessKey}
              onValueChange={setAwsSecretAccessKey}
              placeholder={credsByKey["AWS_SECRET_ACCESS_KEY"]?.status === "set" ? "set (click Remove to edit)" : "(required for aws hosts)"}
              locked={credsByKey["AWS_SECRET_ACCESS_KEY"]?.status === "set" && !awsSecretAccessKeyUnlocked}
              onUnlock={() => setAwsSecretAccessKeyUnlocked(true)}
            />
          </StackedField>

          <StackedField id="awsSessionToken" label="AWS session token" help="AWS session token (AWS_SESSION_TOKEN), when using temporary credentials.">
            <SecretInput
              id="awsSessionToken"
              value={awsSessionToken}
              onValueChange={setAwsSessionToken}
              placeholder={credsByKey["AWS_SESSION_TOKEN"]?.status === "set" ? "set (click Remove to edit)" : "(optional)"}
              locked={credsByKey["AWS_SESSION_TOKEN"]?.status === "set" && !awsSessionTokenUnlocked}
              onUnlock={() => setAwsSessionTokenUnlocked(true)}
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
                <InputGroupButton disabled={detectSops.isPending} onClick={() => detectSops.mutate()}>
                  {detectSops.isPending ? "Finding…" : "Find"}
                </InputGroupButton>
                <InputGroupButton disabled={generateSops.isPending} onClick={() => generateSops.mutate()}>
                  {generateSops.isPending ? "Generating…" : "Generate"}
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
