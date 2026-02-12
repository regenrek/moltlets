import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { RunLogTail } from "~/components/run-log-tail"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { LabelWithHelp } from "~/components/ui/label-help"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { SecretInput } from "~/components/ui/secret-input"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { sealForRunner } from "~/lib/security/sealed-input"
import { writeHostSecrets, writeHostSecretsFinalize } from "~/sdk/secrets"

const TAILSCALE_SECRET_NAME = "tailscale_auth_key"

export function TailscaleAuthKeyCard(props: {
  projectId: Id<"projects">
  projectSlug: string
  host: string
}) {
  const queryClient = useQueryClient()
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("")
  const [writeRunId, setWriteRunId] = useState<Id<"runs"> | null>(null)
  const [selectedRunnerId, setSelectedRunnerId] = useState("")
  const [rotateMode, setRotateMode] = useState(false)

  const wiringQueryOptions = convexQuery(api.controlPlane.secretWiring.listByProjectHost, {
    projectId: props.projectId,
    hostName: props.host,
  })
  const wiringQuery = useQuery({
    ...wiringQueryOptions,
    enabled: Boolean(props.projectId && props.host),
  })
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId: props.projectId }),
    enabled: Boolean(props.projectId),
  })

  const hasTailscaleSecret = (wiringQuery.data ?? []).some(
    (row) => row.secretName === TAILSCALE_SECRET_NAME && row.status === "configured",
  )
  const sealedRunners = (runnersQuery.data ?? [])
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
    .toSorted((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0))

  useEffect(() => {
    if (sealedRunners.length === 1) {
      setSelectedRunnerId(String(sealedRunners[0]?._id || ""))
      return
    }
    if (!sealedRunners.some((runner) => String(runner._id) === selectedRunnerId)) {
      setSelectedRunnerId("")
    }
  }, [sealedRunners, selectedRunnerId])

  const queueTailscaleKeyWrite = useMutation({
    mutationFn: async () => {
      const key = tailscaleAuthKey.trim()
      if (!key) throw new Error("Tailscale auth key required")

      const runner = sealedRunners.length === 1
        ? sealedRunners[0]
        : sealedRunners.find((row) => String(row._id) === selectedRunnerId)
      if (!runner) {
        throw new Error(
          sealedRunners.length === 0
            ? "No online sealed-capable runner. Open Host Secrets after runner reconnects."
            : "Select a target runner first.",
        )
      }

      const targetRunnerId = String(runner._id).trim() as Id<"runners">
      const reserve = await writeHostSecrets({
        data: {
          projectId: props.projectId,
          host: props.host,
          secretNames: [TAILSCALE_SECRET_NAME],
          targetRunnerId,
        },
      })

      const sealedInputAlg = String(reserve.sealedInputAlg || runner.capabilities?.sealedInputAlg || "").trim()
      const sealedInputKeyId = String(reserve.sealedInputKeyId || runner.capabilities?.sealedInputKeyId || "").trim()
      const sealedInputPubSpkiB64 = String(
        reserve.sealedInputPubSpkiB64 || runner.capabilities?.sealedInputPubSpkiB64 || "",
      ).trim()
      const aad = `${props.projectId}:${reserve.jobId}:${reserve.kind}:${targetRunnerId}`
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: sealedInputPubSpkiB64,
        keyId: sealedInputKeyId,
        alg: sealedInputAlg,
        aad,
        plaintextJson: JSON.stringify({ tailscaleAuthKey: key }),
      })

      const queued = await writeHostSecretsFinalize({
        data: {
          projectId: props.projectId,
          host: props.host,
          jobId: reserve.jobId,
          kind: reserve.kind,
          secretNames: [TAILSCALE_SECRET_NAME],
          targetRunnerId,
          sealedInputB64,
          sealedInputAlg,
          sealedInputKeyId,
        },
      })
      return queued.runId
    },
    onSuccess: (runId) => {
      setWriteRunId(runId)
      setTailscaleAuthKey("")
      setRotateMode(false)
      toast.success("Tailscale auth key write queued")
      void queryClient.invalidateQueries({ queryKey: wiringQueryOptions.queryKey })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  if (hasTailscaleSecret && !rotateMode) {
    return (
      <Alert>
        <AlertTitle>Tailscale auth key configured</AlertTitle>
        <AlertDescription className="space-y-3">
          <div>Key wiring is configured for this host.</div>
          <div className="flex flex-wrap items-center gap-2">
            <AsyncButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRotateMode(true)}
            >
              Rotate key
            </AsyncButton>
            <AsyncButton
              type="button"
              size="sm"
              variant="outline"
              disabled={wiringQuery.isFetching}
              pending={wiringQuery.isFetching}
              pendingText="Checking..."
              onClick={() => void wiringQuery.refetch()}
            >
              Refresh status
            </AsyncButton>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  const canQueueWrite = Boolean(tailscaleAuthKey.trim())
    && sealedRunners.length > 0
    && (sealedRunners.length === 1 || Boolean(selectedRunnerId))

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Tailscale auth key</div>
        <div className="text-xs text-muted-foreground">
          Set <code>{TAILSCALE_SECRET_NAME}</code> without leaving this page.
        </div>
      </div>

      <div className="space-y-2">
        <LabelWithHelp htmlFor="vpnTailscaleAuthKey" help={setupFieldHelp.secrets.tailscaleAuthKey}>
          Key value
        </LabelWithHelp>
        <SecretInput
          id="vpnTailscaleAuthKey"
          value={tailscaleAuthKey}
          onValueChange={setTailscaleAuthKey}
          placeholder="tskey-auth-…"
        />
      </div>

      {sealedRunners.length > 1 ? (
        <div className="space-y-2">
          <LabelWithHelp htmlFor="vpnTailscaleRunner" help="Sealed-input write must target one online runner.">
            Target runner
          </LabelWithHelp>
          <NativeSelect
            id="vpnTailscaleRunner"
            value={selectedRunnerId}
            onChange={(event) => setSelectedRunnerId(event.target.value)}
          >
            <NativeSelectOption value="">Select runner…</NativeSelectOption>
            {sealedRunners.map((runner) => (
              <NativeSelectOption key={String(runner._id)} value={String(runner._id)}>
                {runner.runnerName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <AsyncButton
          type="button"
          size="sm"
          disabled={!canQueueWrite || queueTailscaleKeyWrite.isPending}
          pending={queueTailscaleKeyWrite.isPending}
          pendingText="Queueing..."
          onClick={() => queueTailscaleKeyWrite.mutate()}
        >
          Add key
        </AsyncButton>
        <Link
          className="text-xs underline underline-offset-4 hover:text-foreground"
          to="/$projectSlug/hosts/$host/secrets"
          params={{ projectSlug: props.projectSlug, host: props.host }}
        >
          Open Host Secrets
        </Link>
      </div>

      {sealedRunners.length === 0 ? (
        <div className="text-xs text-destructive">
          No online sealed-capable runner. Reconnect runner, then queue key write.
        </div>
      ) : null}
      {writeRunId ? <RunLogTail runId={writeRunId} /> : null}
    </div>
  )
}
