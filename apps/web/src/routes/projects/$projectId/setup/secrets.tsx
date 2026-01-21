import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { RunLogTail } from "~/components/run-log-tail"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select"
import { Switch } from "~/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Textarea } from "~/components/ui/textarea"
import { getClawdletsConfig } from "~/sdk/config"
import { getDeployCredsStatus } from "~/sdk/deploy-creds"
import {
  getSecretsTemplate,
  secretsInitExecute,
  secretsInitStart,
  secretsSyncExecute,
  secretsSyncPreview,
  secretsSyncStart,
  secretsVerifyExecute,
  secretsVerifyStart,
} from "~/sdk/secrets"

export const Route = createFileRoute("/projects/$projectId/setup/secrets")({
  component: SecretsSetup,
})

function SecretsSetup() {
  const { projectId } = Route.useParams()

  const cfg = useQuery({
    queryKey: ["clawdletsConfig", projectId],
    queryFn: async () =>
      await getClawdletsConfig({ data: { projectId: projectId as Id<"projects"> } }),
  })
  const config = cfg.data?.config as any
  const hosts = useMemo(() => Object.keys(config?.hosts || {}).sort(), [config])

  const [host, setHost] = useState("")
  useEffect(() => {
    if (!config) return
    if (host) return
    setHost(config.defaultHost || hosts[0] || "")
  }, [config, host, hosts])

  const creds = useQuery({
    queryKey: ["deployCreds", projectId],
    queryFn: async () =>
      await getDeployCredsStatus({ data: { projectId: projectId as Id<"projects"> } }),
  })

  const template = useMutation({
    mutationFn: async () =>
      await getSecretsTemplate({ data: { projectId: projectId as Id<"projects">, host } }),
  })

  const [allowPlaceholders, setAllowPlaceholders] = useState(false)
  const [adminPassword, setAdminPassword] = useState("")
  const [adminPasswordHash, setAdminPasswordHash] = useState("")
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("")
  const [discordTokens, setDiscordTokens] = useState<Record<string, string>>({})
  const [extraSecrets, setExtraSecrets] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!template.data) return
    try {
      const parsed = JSON.parse(template.data.templateJson) as any
      setDiscordTokens(parsed.discordTokens || {})
      setExtraSecrets(parsed.secrets || {})
    } catch {
      // ignore
    }
  }, [template.data])

  const [initRunId, setInitRunId] = useState<Id<"runs"> | null>(null)
  const initStart = useMutation({
    mutationFn: async () => await secretsInitStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setInitRunId(res.runId)
      void secretsInitExecute({
        data: {
          projectId: projectId as Id<"projects">,
          runId: res.runId,
          host,
          allowPlaceholders,
          adminPassword,
          adminPasswordHash,
          tailscaleAuthKey,
          discordTokens,
          secrets: extraSecrets,
        },
      })
      toast.info("Secrets init started")
    },
  })

  const [verifyRunId, setVerifyRunId] = useState<Id<"runs"> | null>(null)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const verifyStart = useMutation({
    mutationFn: async () => await secretsVerifyStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setVerifyRunId(res.runId)
      void secretsVerifyExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host },
      }).then((r) => setVerifyResult(r))
      toast.info("Secrets verify started")
    },
  })

  const [syncRunId, setSyncRunId] = useState<Id<"runs"> | null>(null)
  const [syncPreview, setSyncPreview] = useState<any>(null)
  const syncPreviewRun = useMutation({
    mutationFn: async () =>
      await secretsSyncPreview({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setSyncPreview(res as any)
    },
  })
  const syncStart = useMutation({
    mutationFn: async () => await secretsSyncStart({ data: { projectId: projectId as Id<"projects">, host } }),
    onSuccess: (res) => {
      setSyncRunId(res.runId)
      void secretsSyncExecute({
        data: { projectId: projectId as Id<"projects">, runId: res.runId, host },
      })
      toast.info("Secrets sync started")
    },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Secrets</h1>
      <p className="text-muted-foreground">
        Local secrets scaffolds, verification, and sync.
      </p>

      {cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Host</Label>
                <NativeSelect value={host} onChange={(e) => setHost(e.target.value)}>
                  {hosts.map((h) => (
                    <NativeSelectOption key={h} value={h}>
                      {h}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Allow placeholders</div>
                  <div className="text-xs text-muted-foreground">
                    Lets secrets init proceed with &lt;PLACEHOLDER&gt; values (not recommended).
                  </div>
                </div>
                <Switch checked={allowPlaceholders} onCheckedChange={setAllowPlaceholders} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Deploy credentials</div>
                <div className="text-xs text-muted-foreground">
                  Loaded from <code>.clawdlets/env</code> (preferred) or process env. Values are never shown.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={creds.isFetching}
                onClick={() => void creds.refetch()}
              >
                Refresh
              </Button>
            </div>

            {creds.isPending ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : creds.error ? (
              <div className="text-sm text-destructive">{String(creds.error)}</div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  Env file:{" "}
                  {creds.data?.envFile ? (
                    <>
                      <code>{creds.data.envFile.path}</code>{" "}
                      <span className="text-muted-foreground">
                        ({creds.data.envFile.status})
                        {creds.data.envFile.error ? ` · ${creds.data.envFile.error}` : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <code>{creds.data?.defaultEnvPath}</code>{" "}
                      <span className="text-muted-foreground">(missing)</span>
                    </>
                  )}
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  {(creds.data?.keys || []).map((k: any) => (
                    <div key={k.key} className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{k.key}</div>
                        <div className="text-xs text-muted-foreground">
                          {k.status} · {k.source}
                          {k.value ? ` · ${k.value}` : ""}
                        </div>
                      </div>
                      <div className={k.status === "set" ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
                        {k.status}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="text-xs text-muted-foreground">
                  If missing, run <code>clawdlets env init</code> and fill values (local-only).
                </div>

                <Textarea readOnly className="font-mono min-h-[120px]" value={creds.data?.template || ""} />
              </div>
            )}
          </div>

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
                      Writes encrypted host secrets and extra-files scaffolds. Runs <code>clawdlets secrets init</code>.
                    </div>
                  </div>
                  <Button type="button" variant="outline" disabled={template.isPending || !host} onClick={() => template.mutate()}>
                    Generate template
                  </Button>
                </div>

                {template.data ? (
                  <div className="space-y-4">
                    {template.data.missingSecretConfig?.length ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <div className="font-medium">Missing secret config</div>
                        <pre className="mt-2 text-xs whitespace-pre-wrap break-words">
                          {JSON.stringify(template.data.missingSecretConfig, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="adminPass">Admin password (optional)</Label>
                        <Input id="adminPass" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                        <div className="text-xs text-muted-foreground">
                          If set, the server will generate a yescrypt hash via Nix mkpasswd.
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="adminHash">Admin password hash</Label>
                        <Input id="adminHash" value={adminPasswordHash} onChange={(e) => setAdminPasswordHash(e.target.value)} placeholder="$y$…" />
                        <div className="text-xs text-muted-foreground">
                          Stored as <code>admin_password_hash</code> secret.
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tskey">Tailscale auth key (if needed)</Label>
                      <Input id="tskey" value={tailscaleAuthKey} onChange={(e) => setTailscaleAuthKey(e.target.value)} placeholder="tskey-auth-…" />
                    </div>

                    <div className="space-y-2">
                      <Label>Discord tokens</Label>
                      <div className="grid gap-3">
                        {Object.keys(discordTokens).length === 0 ? (
                          <div className="text-muted-foreground text-sm">No discord tokens required.</div>
                        ) : (
                          Object.keys(discordTokens).map((botId) => (
                            <div key={botId} className="grid gap-2 md:grid-cols-[180px_1fr] items-center">
                              <div className="text-sm font-medium">{botId}</div>
                              <Input
                                type="password"
                                value={discordTokens[botId] || ""}
                                onChange={(e) => setDiscordTokens((prev) => ({ ...prev, [botId]: e.target.value }))}
                                placeholder="discord token"
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Extra secrets</Label>
                      <div className="text-xs text-muted-foreground">
                        Values are written to encrypted YAML in <code>secrets/hosts/{host}</code>.
                      </div>
                      <div className="grid gap-3">
                        {Object.keys(extraSecrets).length === 0 ? (
                          <div className="text-muted-foreground text-sm">No extra secrets.</div>
                        ) : (
                          Object.keys(extraSecrets).sort().map((name) => (
                            <div key={name} className="grid gap-2 md:grid-cols-[220px_1fr] items-center">
                              <div className="text-sm font-medium truncate">{name}</div>
                              <Input
                                type="password"
                                value={extraSecrets[name] || ""}
                                onChange={(e) =>
                                  setExtraSecrets((prev) => ({ ...prev, [name]: e.target.value }))
                                }
                                placeholder={extraSecrets[name] || "<REPLACE_WITH_SECRET>"}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <Button type="button" disabled={initStart.isPending || !host} onClick={() => initStart.mutate()}>
                      Run secrets init
                    </Button>
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
                  Runs <code>clawdlets secrets verify --json</code> and summarizes missing secrets.
                </div>
                <Button type="button" disabled={verifyStart.isPending || !host} onClick={() => verifyStart.mutate()}>
                  Run verify
                </Button>
                {verifyResult?.result ? (
                  <Textarea readOnly className="font-mono min-h-[200px]" value={JSON.stringify(verifyResult.result, null, 2)} />
                ) : null}
                {verifyRunId ? <RunLogTail runId={verifyRunId} /> : null}
              </div>
            </TabsContent>

            <TabsContent value="sync">
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <div className="font-medium">Secrets sync</div>
                <div className="text-xs text-muted-foreground">
                  Copies secrets to the server using <code>clawdlets secrets sync</code>. Requires SSH access.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" disabled={syncPreviewRun.isPending || !host} onClick={() => syncPreviewRun.mutate()}>
                    Preview files
                  </Button>
                  <Button type="button" disabled={syncStart.isPending || !host} onClick={() => syncStart.mutate()}>
                    Sync now
                  </Button>
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
      )}
    </div>
  )
}
