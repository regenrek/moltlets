import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { sealForRunner } from "~/lib/security/sealed-input"
import { isProjectRunnerOnline } from "~/lib/setup/runner-status"
import {
  detectSopsAgeKey,
  finalizeDeployCreds,
  generateSopsAgeKey,
  getDeployCredsStatus,
  updateDeployCreds,
} from "~/sdk/infra"

type SaveSopsInput = {
  kind: "save" | "remove"
  value: string
}

export function SetupSopsAgeKeyField(props: {
  projectId: Id<"projects">
}) {
  const queryClient = useQueryClient()
  const [selectedRunnerId, setSelectedRunnerId] = useState<string>("")
  const [sopsAgeKeyFileOverride, setSopsAgeKeyFileOverride] = useState<string | undefined>(undefined)
  const [sopsStatus, setSopsStatus] = useState<{ kind: "ok" | "warn" | "error"; message: string } | null>(null)

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

  useEffect(() => {
    if (sealedRunners.length === 1) setSelectedRunnerId(String(sealedRunners[0]?._id || ""))
  }, [sealedRunners])

  const creds = useQuery({
    queryKey: ["deployCreds", props.projectId],
    queryFn: async () => await getDeployCredsStatus({ data: { projectId: props.projectId } }),
    enabled: runnerOnline,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const credsByKey = useMemo(() => {
    const out: Record<string, { status?: "set" | "unset"; value?: string }> = {}
    for (const row of creds.data?.keys || []) out[row.key] = row
    return out
  }, [creds.data?.keys])

  const defaultSopsAgeKeyFile = String(credsByKey["SOPS_AGE_KEY_FILE"]?.value || creds.data?.defaultSopsAgeKeyPath || "")
  const sopsAgeKeyFile = sopsAgeKeyFileOverride ?? defaultSopsAgeKeyFile
  const sopsAgeKeyFileSet = credsByKey["SOPS_AGE_KEY_FILE"]?.status === "set"

  const pickTargetRunner = () => {
    if (sealedRunners.length === 1) return sealedRunners[0]
    return sealedRunners.find((row) => String(row._id) === selectedRunnerId)
  }

  const canMutate = runnerOnline
    && sealedRunners.length > 0
    && (sealedRunners.length === 1 || Boolean(selectedRunnerId))

  const saveSops = useMutation({
    mutationFn: async (input: SaveSopsInput) => {
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
      if (!runnerPub || !keyId || !alg) throw new Error("Runner sealed-input capabilities incomplete")

      const reserve = await updateDeployCreds({
        data: {
          projectId: props.projectId,
          targetRunnerId,
          updatedKeys: ["SOPS_AGE_KEY_FILE"],
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
        plaintextJson: JSON.stringify({ SOPS_AGE_KEY_FILE: normalized }),
      })

      await finalizeDeployCreds({
        data: {
          projectId: props.projectId,
          jobId,
          kind,
          sealedInputB64,
          sealedInputAlg: reserveAlg,
          sealedInputKeyId: reserveKeyId,
          targetRunnerId,
          updatedKeys: ["SOPS_AGE_KEY_FILE"],
        },
      })

      return input
    },
    onSuccess: async (input) => {
      toast.success(input.kind === "remove" ? "SOPS_AGE_KEY_FILE removed" : "SOPS_AGE_KEY_FILE saved")
      setSopsAgeKeyFileOverride(input.kind === "remove" ? "" : undefined)
      await queryClient.invalidateQueries({ queryKey: ["deployCreds", props.projectId] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })

  const detectSops = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await detectSopsAgeKey({ data: { projectId: props.projectId } })
    },
    onSuccess: (result) => {
      if (result.recommendedPath) {
        setSopsAgeKeyFileOverride(result.recommendedPath)
        setSopsStatus({ kind: "ok", message: `Found key: ${result.recommendedPath}` })
      } else {
        setSopsStatus({ kind: "warn", message: "No valid age key found. Generate one below." })
      }
    },
    onError: (error) => {
      setSopsStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    },
  })

  const generateSops = useMutation({
    mutationFn: async () => {
      if (!runnerOnline) throw new Error("Runner offline. Start runner first.")
      return await generateSopsAgeKey({ data: { projectId: props.projectId } })
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setSopsStatus({ kind: "warn", message: result.message || "Key already exists." })
        return
      }
      setSopsAgeKeyFileOverride(result.keyPath)
      setSopsStatus({
        kind: "ok",
        message: result.created === false ? `Using existing key: ${result.keyPath}` : `Generated key: ${result.keyPath}`,
      })
      await queryClient.invalidateQueries({ queryKey: ["deployCreds", props.projectId] })
      toast.success(result.created === false ? "Using existing SOPS key" : "SOPS key generated")
    },
    onError: (error) => {
      setSopsStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    },
  })

  const savePending = saveSops.isPending && saveSops.variables?.kind === "save"
  const removePending = saveSops.isPending && saveSops.variables?.kind === "remove"

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Operator workstation key</div>
      <div className="text-xs text-muted-foreground">
        SOPS age key path (<code>SOPS_AGE_KEY_FILE</code>) used during setup/deploy secret operations.
      </div>

      {!runnerOnline && !runnersQuery.isPending ? (
        <div className="text-xs text-muted-foreground">
          Connect your runner to save this key path.
        </div>
      ) : null}

      {runnerOnline && sealedRunners.length === 0 ? (
        <div className="text-xs text-destructive">
          No online runner advertises sealed input. Upgrade runner and retry.
        </div>
      ) : null}

      {!runnerOnline ? null : creds.isPending ? (
        <div className="text-xs text-muted-foreground">Loading key path…</div>
      ) : creds.error ? (
        <div className="text-xs text-destructive">{String(creds.error)}</div>
      ) : (
        <div className="space-y-2">
          {sealedRunners.length > 1 ? (
            <select
              id="setup-sops-target-runner"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedRunnerId}
              onChange={(event) => setSelectedRunnerId(event.target.value)}
            >
              <option value="">Select runner…</option>
              {sealedRunners.map((runner) => (
                <option key={runner._id} value={String(runner._id)}>
                  {runner.runnerName}
                </option>
              ))}
            </select>
          ) : null}

          {sopsAgeKeyFileSet ? (
            <InputGroup>
              <InputGroupInput
                id="setup-sops-age-key-file"
                readOnly
                value={sopsAgeKeyFile || "Saved path"}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  disabled={!canMutate}
                  pending={removePending}
                  pendingText="Removing..."
                  onClick={() => saveSops.mutate({ kind: "remove", value: "" })}
                >
                  Remove
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <InputGroup>
              <InputGroupInput
                id="setup-sops-age-key-file"
                value={sopsAgeKeyFile}
                onChange={(event) => setSopsAgeKeyFileOverride(event.target.value)}
                placeholder=".clawlets/keys/operators/<user>.agekey"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  disabled={!canMutate || !sopsAgeKeyFile.trim()}
                  pending={savePending}
                  pendingText="Saving..."
                  onClick={() => saveSops.mutate({ kind: "save", value: sopsAgeKeyFile })}
                >
                  Save
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          )}

          {!sopsAgeKeyFileSet ? (
            <div className="flex flex-wrap gap-2">
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
        </div>
      )}

      {sopsStatus ? (
        <div className={`text-xs ${sopsStatus.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {sopsStatus.message}
        </div>
      ) : null}
    </div>
  )
}
