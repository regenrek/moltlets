import { useMutation, useQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { api } from "../../../convex/_generated/api"
import type { MissingSecretConfig } from "@clawlets/core/lib/secrets/secrets-plan"
import { SECRET_WIRING_STATUSES } from "@clawlets/core/lib/runtime/control-plane-constants"
import { RunLogTail } from "~/components/run-log-tail"
import { SecretsInputs, type SecretsPlan, type SecretStatus } from "~/components/fleet/secrets-inputs"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SecretInput } from "~/components/ui/secret-input"
import { SettingsSection } from "~/components/ui/settings-section"
import { Spinner } from "~/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Textarea } from "~/components/ui/textarea"
import { setupFieldHelp } from "~/lib/setup-field-help"
import { sealForRunner } from "~/lib/security/sealed-input"
import {
  getSecretsTemplate,
  secretsInitExecute,
  secretsInitFinalize,
  secretsInitStart,
  secretsSyncExecute,
  secretsSyncPreview,
  secretsSyncStart,
  secretsVerifyExecute,
  secretsVerifyStart,
} from "~/sdk/secrets"
import { MissingEnvWiringPanel } from "~/components/secrets/missing-env-wiring"

type HostSecretsPanelProps = {
  projectId: Id<"projects">
  host: string
  scope?: "bootstrap" | "updates" | "openclaw" | "all"
  mode?: "default" | "setup"
  setupFlow?: {
    isComplete: boolean
    onContinue: () => void
  }
}

const EMPTY_MISSING_SECRET_CONFIG: MissingSecretConfig[] = []
type SecretWiringStatus = (typeof SECRET_WIRING_STATUSES)[number]
const SECRET_WIRING_STATUS_SET = new Set<string>(SECRET_WIRING_STATUSES)

function isSecretWiringStatus(value: unknown): value is SecretWiringStatus {
  return typeof value === "string" && SECRET_WIRING_STATUS_SET.has(value)
}

export function HostSecretsPanel({ projectId, host, scope = "all", mode = "default", setupFlow }: HostSecretsPanelProps) {
  const setupMode = mode === "setup"
  const template = useQuery({
    queryKey: ["secretsTemplate", projectId, host, scope],
    queryFn: async () => await getSecretsTemplate({ data: { projectId, host, scope } }),
    enabled: Boolean(host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const hasTemplate = Boolean(template.data)
  const runnersQuery = useQuery({
    ...convexQuery(api.controlPlane.runners.listByProject, { projectId }),
  })
  const secretWiringQuery = useQuery({
    ...convexQuery(api.controlPlane.secretWiring.listByProjectHost, { projectId, hostName: host }),
    enabled: Boolean(host),
  })
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

  const [adminPassword, setAdminPassword] = useState("")
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("")
  const [tailscaleUnlocked, setTailscaleUnlocked] = useState(false)
  const [needsTailscaleAuthKey, setNeedsTailscaleAuthKey] = useState(false)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [secretsTemplate, setSecretsTemplate] = useState<Record<string, string>>({})
  const [secretsPlan, setSecretsPlan] = useState<SecretsPlan | null>(null)

  useEffect(() => {
    if (!template.data) return
    try {
      const parsed = JSON.parse(template.data.templateJson) as any
      const parsedSecrets = (parsed.secrets || {}) as Record<string, string>
      const plan = (template.data as { secretsPlan?: SecretsPlan }).secretsPlan

      setNeedsTailscaleAuthKey(Boolean(parsed.tailscaleAuthKey))
      if (!parsed.tailscaleAuthKey) setTailscaleAuthKey("")

      setSecretsPlan(plan || null)
      setSecretsTemplate(parsedSecrets)

      setSecrets((prev) => {
        const skipNames = new Set(["admin_password_hash", "tailscale_auth_key"])
        const planNames = plan
          ? Array.from(new Set([
            ...((plan.required || []).map((spec) => spec.name)),
            ...((plan.optional || []).map((spec) => spec.name)),
          ])).filter((name) => !skipNames.has(name))
          : Object.keys(parsedSecrets)
        const out: Record<string, string> = {}
        for (const name of planNames) out[name] = prev[name] || ""
        return out
      })
    } catch {
      // ignore
    }
  }, [template.data])

  const allowedSecretNames = useMemo(() => {
    const names = new Set<string>()
    for (const spec of secretsPlan?.required || []) names.add(spec.name)
    for (const spec of secretsPlan?.optional || []) names.add(spec.name)
    return names
  }, [secretsPlan])
  const planMissing = secretsPlan?.missing
    ?? ((template.data as { missingSecretConfig?: MissingSecretConfig[] } | undefined)?.missingSecretConfig)
    ?? EMPTY_MISSING_SECRET_CONFIG
  const planWarnings = secretsPlan?.warnings || []
  const missingEnvVars = useMemo(() => {
    return (planMissing || []).filter((item) => (item as MissingSecretConfig).kind === "envVar") as Array<
      Extract<MissingSecretConfig, { kind: "envVar" }>
    >
  }, [planMissing])

  const [initRunId, setInitRunId] = useState<Id<"runs"> | null>(null)
  const initStart = useMutation({
    mutationFn: async () => await secretsInitStart({ data: { projectId, host, scope } }),
    onSuccess: async (res) => {
      setInitRunId(res.runId)
      const secretsPayload = Object.fromEntries(
        Object.entries(secrets)
          .map(([k, v]) => [k, String(v || "")])
          .filter(([name, value]) => value.trim() && allowedSecretNames.has(name)),
      )
      const runner =
        sealedRunners.length === 1
          ? sealedRunners[0]
          : sealedRunners.find((row) => String(row._id) === selectedRunnerId)
      if (!runner) {
        toast.error("Select an online sealed-capable runner before starting secrets init")
        return
      }
      const targetRunnerId = String(runner._id)
      const inputPayload: Record<string, string> = {
        ...Object.fromEntries(Object.entries(secretsPayload).map(([k, v]) => [String(k), String(v)])),
        ...(adminPassword.trim() ? { adminPasswordHash: adminPassword.trim() } : {}),
        ...(tailscaleAuthKey.trim() ? { tailscaleAuthKey: tailscaleAuthKey.trim() } : {}),
      }
      const secretNames = Object.keys(inputPayload)
      const reserve = await secretsInitExecute({
        data: {
          projectId,
          runId: res.runId,
          host,
          scope,
          allowPlaceholders: false,
          secretNames,
          targetRunnerId: targetRunnerId as Id<"runners">,
        },
      })
      const aad = `${projectId}:${reserve.jobId}:${reserve.kind}:${targetRunnerId}`
      const reserveRunnerPub = String(reserve.sealedInputPubSpkiB64 || "").trim()
      const reserveKeyId = String(reserve.sealedInputKeyId || runner.capabilities?.sealedInputKeyId || "").trim()
      const reserveAlg = String(reserve.sealedInputAlg || runner.capabilities?.sealedInputAlg || "").trim()
      const sealedInputB64 = await sealForRunner({
        runnerPubSpkiB64: reserveRunnerPub || String(runner.capabilities?.sealedInputPubSpkiB64 || ""),
        keyId: reserveKeyId,
        alg: reserveAlg,
        aad,
        plaintextJson: JSON.stringify(inputPayload),
      })
      await secretsInitFinalize({
        data: {
          projectId,
          jobId: reserve.jobId,
          kind: reserve.kind,
          sealedInputB64,
          sealedInputAlg: reserveAlg,
          sealedInputKeyId: reserveKeyId,
        },
      })
      toast.info("Secrets init queued")
    },
  })

  const verifyQuery = useQuery({
    queryKey: ["secretsVerify", projectId, host, scope],
    queryFn: async () => {
      if (!host) throw new Error("missing host")
      const res = await secretsVerifyStart({ data: { projectId, host, scope } })
      const result = await secretsVerifyExecute({
        data: { projectId, runId: res.runId, host, scope },
      })
      return { runId: res.runId, result }
    },
    enabled: Boolean(host),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const verifyRunId = verifyQuery.data?.runId ?? null
  const verifyResult = verifyQuery.data?.result ?? null
  const verifyUpdatedAt = verifyQuery.dataUpdatedAt || null

  const [syncRunId, setSyncRunId] = useState<Id<"runs"> | null>(null)
  const [syncPreview, setSyncPreview] = useState<any>(null)
  const syncPreviewRun = useMutation({
    mutationFn: async () =>
      await secretsSyncPreview({ data: { projectId, host } }),
    onSuccess: (res) => {
      setSyncPreview(res as any)
    },
  })
  const syncStart = useMutation({
    mutationFn: async () => await secretsSyncStart({ data: { projectId, host } }),
    onSuccess: (res) => {
      setSyncRunId(res.runId)
      void secretsSyncExecute({
        data: { projectId, runId: res.runId, host },
      })
      toast.info("Secrets sync started")
    },
  })

  useEffect(() => {
    setAdminUnlocked(false)
    setTailscaleUnlocked(false)
  }, [host])

  const verifyResults = useMemo<any[]>(() => [], [])

  const verifySummary = useMemo(() => {
    if (verifyResults.length === 0) return null
    let ok = 0
    let missing = 0
    let warn = 0
    for (const entry of verifyResults) {
      if (entry?.status === "ok") ok += 1
      else if (entry?.status === "missing") missing += 1
      else if (entry?.status === "warn") warn += 1
    }
    return { ok, missing, warn, total: verifyResults.length }
  }, [verifyResults])

  const secretStatusByName = useMemo<Record<string, SecretStatus>>(() => {
    const out: Record<string, SecretStatus> = {}
    for (const entry of verifyResults) {
      if (!entry || typeof entry.secret !== "string") continue
      if (entry.status === "ok" || entry.status === "missing" || entry.status === "warn") {
        out[entry.secret] = { status: entry.status, detail: typeof entry.detail === "string" ? entry.detail : undefined }
      }
    }
    return out
  }, [verifyResults])

  const secretWiringStatusByName = useMemo<Record<string, SecretWiringStatus>>(() => {
    const out: Record<string, SecretWiringStatus> = {}
    for (const row of secretWiringQuery.data ?? []) {
      if (!row?.secretName) continue
      if (!isSecretWiringStatus(row.status)) continue
      out[row.secretName] = row.status
    }
    return out
  }, [secretWiringQuery.data])

  const adminConfigured = secretWiringStatusByName["admin_password_hash"] === "configured"
  const tailscaleConfigured = secretWiringStatusByName["tailscale_auth_key"] === "configured"
  const adminLocked = (adminConfigured || secretStatusByName["admin_password_hash"]?.status === "ok") && !adminUnlocked
  const tailscaleLocked = (tailscaleConfigured || secretStatusByName["tailscale_auth_key"]?.status === "ok") && !tailscaleUnlocked
  const showAdminEditorInSetup = !adminLocked || Boolean(adminPassword.trim())
  const showTailscaleEditorInSetup = !tailscaleLocked || Boolean(tailscaleAuthKey.trim())
  const lockedPlaceholder = "set (click Remove to edit)"

  const initBlockedReason = !host
    ? "Select a host first."
    : sealedRunners.length === 0
      ? "Connect an online sealed-capable runner first."
      : sealedRunners.length > 1 && !selectedRunnerId
        ? "Select a target runner."
        : null

  if (setupMode) {
    const canSaveInSetup = !initBlockedReason && Boolean(template.data) && !template.isPending && !template.error
    const setupStatus = setupFlow?.isComplete
      ? "Secrets verified. Continue to deploy."
      : initBlockedReason || "Save required secrets. Setup will re-check readiness."
    return (
      <SettingsSection
        title="Server passwords"
        description="Set required bootstrap secrets for this host."
        statusText={setupStatus}
        actions={setupFlow?.isComplete ? (
          <Button type="button" onClick={setupFlow.onContinue}>
            Continue
          </Button>
        ) : (
          <AsyncButton
            type="button"
            disabled={!canSaveInSetup || initStart.isPending}
            pending={initStart.isPending}
            pendingText="Saving secrets..."
            onClick={() => initStart.mutate()}
          >
            Save secrets
          </AsyncButton>
        )}
      >
        {template.isPending ? (
          <div className="text-muted-foreground text-sm">Loading required secrets…</div>
        ) : template.error ? (
          <div className="text-sm text-destructive">{String(template.error)}</div>
        ) : template.data ? (
          <div className="space-y-4">
            {sealedRunners.length > 1 ? (
              <div className="space-y-2">
                <LabelWithHelp htmlFor="secretsInitRunnerSetup" help="Sealed-input jobs must target one runner.">
                  Target runner
                </LabelWithHelp>
                <select
                  id="secretsInitRunnerSetup"
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
              </div>
            ) : null}

            {planWarnings.length ? (
              <div className="text-xs text-muted-foreground">
                {planWarnings.length} warning(s) in template. Optional values can be completed later.
              </div>
            ) : null}
            {planMissing.length ? (
              <div className="text-xs text-destructive">
                Missing secret config detected. Fill required values below and re-check readiness.
              </div>
            ) : null}

            <div className="space-y-2">
              <LabelWithHelp htmlFor="adminPassSetup" help={setupFieldHelp.secrets.adminPassword}>
                Admin password (optional)
              </LabelWithHelp>
              {!showAdminEditorInSetup ? (
                <>
                  <InputGroup>
                    <InputGroupInput
                      id="adminPassSetup"
                      readOnly
                      value="Already set on host"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton type="button" onClick={() => setAdminUnlocked(true)}>
                        Edit
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <div className="text-xs text-muted-foreground">
                    Existing admin password is configured. Edit only if you want to rotate it.
                  </div>
                </>
              ) : (
                <SecretInput
                  id="adminPassSetup"
                  value={adminPassword}
                  onValueChange={setAdminPassword}
                  placeholder="Set new admin password"
                />
              )}
            </div>

            {needsTailscaleAuthKey ? (
              <div className="space-y-2">
                <LabelWithHelp htmlFor="tskeySetup" help={setupFieldHelp.secrets.tailscaleAuthKey}>
                  Tailscale auth key
                </LabelWithHelp>
                {!showTailscaleEditorInSetup ? (
                  <>
                    <InputGroup>
                      <InputGroupInput
                        id="tskeySetup"
                        readOnly
                        value="Already set on host"
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton type="button" onClick={() => setTailscaleUnlocked(true)}>
                          Edit
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    <div className="text-xs text-muted-foreground">
                      Existing Tailscale key is configured. Edit only if you want to rotate it.
                    </div>
                  </>
                ) : (
                  <SecretInput
                    id="tskeySetup"
                    value={tailscaleAuthKey}
                    onValueChange={setTailscaleAuthKey}
                    placeholder="tskey-auth-…"
                  />
                )}
              </div>
            ) : null}

            <SecretsInputs
              host={host}
              secrets={secrets}
              setSecrets={setSecrets}
              secretsTemplate={secretsTemplate}
              secretsPlan={secretsPlan}
              secretStatusByName={secretStatusByName}
            />

            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">Readiness check</div>
                <AsyncButton
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={verifyQuery.isFetching || !host}
                  pending={verifyQuery.isFetching}
                  pendingText="Checking..."
                  onClick={() => void verifyQuery.refetch()}
                >
                  Recheck
                </AsyncButton>
              </div>
              {setupFlow?.isComplete ? (
                <div className="text-emerald-700">All required secrets are configured.</div>
              ) : verifyQuery.isFetching ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-3" />
                  Checking current secret status...
                </div>
              ) : (
                <div className="text-muted-foreground">
                  Save secrets, then recheck. Continue unlocks when required values are ready.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">Loading required secrets…</div>
        )}
      </SettingsSection>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <Tabs defaultValue="init">
            <TabsList>
              <TabsTrigger value="init">Init</TabsTrigger>
              <TabsTrigger value="verify">Verify</TabsTrigger>
              <TabsTrigger value="sync">Sync</TabsTrigger>
            </TabsList>

            <TabsContent value="init">
              <div className="rounded-lg border bg-card p-6 space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Secrets init</div>
                    <div className="text-xs text-muted-foreground">
                      Writes encrypted host secrets and extra-files scaffolds. Runs <code>clawlets secrets init</code>.
                    </div>
                  </div>
                  <AsyncButton
                    type="button"
                    variant="outline"
                    disabled={template.isFetching || !host}
                    pending={template.isFetching}
                    pendingText={hasTemplate ? "Refreshing..." : "Generating..."}
                    onClick={() => void template.refetch()}
                  >
                    {hasTemplate ? "Refresh template" : "Generate template"}
                  </AsyncButton>
                </div>

                {template.isPending ? (
                  <div className="text-muted-foreground text-sm">Loading template…</div>
                ) : template.error ? (
                  <div className="text-sm text-destructive">{String(template.error)}</div>
                ) : template.data ? (
                  <div className="space-y-4">
                    {sealedRunners.length === 0 ? (
                      <div className="text-sm text-destructive">
                        No online runner advertises sealed input. Upgrade runner before secrets init.
                      </div>
                    ) : null}
                    {sealedRunners.length > 1 ? (
                      <div className="space-y-2">
                        <LabelWithHelp htmlFor="secretsInitRunner" help="Sealed-input jobs must target one runner.">
                          Target runner
                        </LabelWithHelp>
                        <select
                          id="secretsInitRunner"
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
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      Template auto-loaded. Secrets are not shown; use Verify to check. Refresh if you changed config.
                    </div>
                    {template.dataUpdatedAt ? (
                      <div className="text-xs text-muted-foreground">
                        Last refreshed: <code>{new Date(template.dataUpdatedAt).toLocaleString()}</code>
                      </div>
                    ) : null}
                    <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">Stored secrets status</div>
                          <AsyncButton
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={verifyQuery.isFetching || !host}
                            pending={verifyQuery.isFetching}
                            pendingText="Checking..."
                            onClick={() => void verifyQuery.refetch()}
                          >
                            Check stored secrets
                          </AsyncButton>
                        </div>
                      {verifySummary ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">set {verifySummary.ok}</Badge>
                          {verifySummary.warn ? <Badge variant="outline">optional {verifySummary.warn}</Badge> : null}
                          {verifySummary.missing ? <Badge variant="destructive">missing {verifySummary.missing}</Badge> : null}
                          {verifyUpdatedAt ? (
                            <span className="text-muted-foreground">
                              Last checked: {new Date(verifyUpdatedAt).toLocaleString()}
                            </span>
                          ) : null}
                          {verifyQuery.isFetching ? (
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <Spinner className="size-3" />
                              Checking…
                            </span>
                          ) : null}
                        </div>
                      ) : verifyQuery.isFetching ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Spinner className="size-3" />
                          Checking stored secrets…
                        </div>
                      ) : verifyQuery.error ? (
                        <div className="text-sm text-destructive">{String(verifyQuery.error)}</div>
                      ) : (
                        <div className="text-muted-foreground">
                          Not checked yet. Runs the same check as the Verify tab.
                        </div>
                      )}
                    </div>
                    {planWarnings.length ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm space-y-2">
                        <div className="font-medium">Warnings</div>
                        <div className="space-y-2">
                          {planWarnings.map((warning, idx) => (
                            <div key={`${warning.kind}-${idx}`} className="rounded-md border bg-white/70 p-2">
                              <div className="text-sm font-medium">{warning.message}</div>
                              <div className="text-xs text-muted-foreground">
                                {warning.kind}
                                {warning.gateway ? ` · gateway ${warning.gateway}` : ""}
                                {warning.path ? ` · ${warning.path}` : ""}
                              </div>
                              {warning.suggestion ? (
                                <div className="text-xs text-muted-foreground">
                                  Suggestion: <code>{warning.suggestion}</code>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <MissingEnvWiringPanel
                      projectId={projectId}
                      host={host}
                      missingEnvVars={missingEnvVars}
                      onWired={() => void template.refetch()}
                    />

                    {planMissing.length ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <div className="font-medium">Missing secret config (details)</div>
                        <pre className="mt-2 text-xs whitespace-pre-wrap break-words">
                          {JSON.stringify(planMissing, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <LabelWithHelp htmlFor="adminPass" help={setupFieldHelp.secrets.adminPassword}>
                            Admin password (optional)
                          </LabelWithHelp>
                        </div>
                        <SecretInput
                          id="adminPass"
                          value={adminPassword}
                          onValueChange={setAdminPassword}
                          placeholder={adminLocked ? lockedPlaceholder : "Set new admin password"}
                          locked={adminLocked}
                          onUnlock={() => setAdminUnlocked(true)}
                        />
                        <div className="text-xs text-muted-foreground">
                          If set, the server will generate a yescrypt hash via Nix mkpasswd. If left blank, the existing secret is kept (or placeholders are used when enabled).
                        </div>
                      </div>
                    </div>

                    {needsTailscaleAuthKey ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <LabelWithHelp htmlFor="tskey" help={setupFieldHelp.secrets.tailscaleAuthKey}>
                            Tailscale auth key
                          </LabelWithHelp>
                        </div>
                        <SecretInput
                          id="tskey"
                          value={tailscaleAuthKey}
                          onValueChange={setTailscaleAuthKey}
                          placeholder={tailscaleLocked ? lockedPlaceholder : "tskey-auth-…"}
                          locked={tailscaleLocked}
                          onUnlock={() => setTailscaleUnlocked(true)}
                        />
                      </div>
                    ) : null}

                    <SecretsInputs
                      host={host}
                      secrets={secrets}
                      setSecrets={setSecrets}
                      secretsTemplate={secretsTemplate}
                      secretsPlan={secretsPlan}
                      secretStatusByName={secretStatusByName}
                    />

                    <AsyncButton
                      type="button"
                      disabled={
                        initStart.isPending
                        || !host
                        || sealedRunners.length === 0
                        || (sealedRunners.length > 1 && !selectedRunnerId)
                      }
                      pending={initStart.isPending}
                      pendingText="Running secrets init..."
                      onClick={() => initStart.mutate()}
                    >
                      Run secrets init
                    </AsyncButton>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Generate a template to see required tokens for this host.
                  </div>
                )}

                {initRunId ? <RunLogTail runId={initRunId} /> : null}
              </div>
            </TabsContent>

            <TabsContent value="verify">
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <div className="font-medium">Secrets verify</div>
                <div className="text-xs text-muted-foreground">
                  Runs <code>{`clawlets secrets verify --scope ${scope} --json`}</code> and summarizes missing secrets.
                </div>
                <AsyncButton
                  type="button"
                  disabled={verifyQuery.isFetching || !host}
                  pending={verifyQuery.isFetching}
                  pendingText="Checking..."
                  onClick={() => void verifyQuery.refetch()}
                >
                  Run verify
                </AsyncButton>
                {verifyResult ? (
                  <Textarea
                    readOnly
                    className="font-mono min-h-[120px]"
                    value={JSON.stringify({ queued: true, message: "Verify job queued. Follow run logs for progress." }, null, 2)}
                  />
                ) : null}
                {verifyRunId ? <RunLogTail runId={verifyRunId} /> : null}
              </div>
            </TabsContent>

            <TabsContent value="sync">
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <div className="font-medium">Secrets sync</div>
                <div className="text-xs text-muted-foreground">
                  Copies secrets to the server using <code>clawlets secrets sync</code>. Requires SSH access.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <AsyncButton
                    type="button"
                    variant="outline"
                    disabled={syncPreviewRun.isPending || !host}
                    pending={syncPreviewRun.isPending}
                    pendingText="Previewing..."
                    onClick={() => syncPreviewRun.mutate()}
                  >
                    Preview files
                  </AsyncButton>
                  <AsyncButton
                    type="button"
                    disabled={syncStart.isPending || !host}
                    pending={syncStart.isPending}
                    pendingText="Syncing..."
                    onClick={() => syncStart.mutate()}
                  >
                    Sync now
                  </AsyncButton>
                </div>

                {syncPreview ? (
                  syncPreview.ok ? (
                    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                      <div className="text-sm font-medium">Will sync</div>
                      <div className="text-xs text-muted-foreground">
                        {syncPreview.files?.length ?? 0} file(s) · digest <code>{syncPreview.digest}</code>
                      </div>
                      <pre className="text-xs whitespace-pre-wrap break-words">
                        {String(syncPreview.localDir)}{"\n"}→{"\n"}{String(syncPreview.remoteDir)}{"\n\n"}
                        {(syncPreview.files || []).join("\n")}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-sm text-destructive">
                      Preview failed: {String(syncPreview.message)}
                    </div>
                  )
                ) : null}
                {syncRunId ? <RunLogTail runId={syncRunId} /> : null}
              </div>
            </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
