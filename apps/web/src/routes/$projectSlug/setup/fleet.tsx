import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../../convex/_generated/dataModel"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { HelpTooltip, LabelWithHelp } from "~/components/ui/label-help"
import { Switch } from "~/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { Textarea } from "~/components/ui/textarea"
import { useProjectBySlug } from "~/lib/project-data"
import { setupFieldHelp } from "~/lib/setup-field-help"
import {
  configDotGet,
  configDotSet,
  writeClawletsConfigFile,
} from "~/sdk/config"

export const Route = createFileRoute("/$projectSlug/setup/fleet")({
  component: FleetSetup,
})

function FleetSetup() {
  const { projectSlug } = Route.useParams()
  const projectQuery = useProjectBySlug(projectSlug)
  const projectId = projectQuery.projectId
  const queryClient = useQueryClient()
  const configQueryKey = ["fleetSetupConfig", projectId] as const

  const cfg = useQuery({
    queryKey: configQueryKey,
    enabled: Boolean(projectId),
    queryFn: async () => {
      const [schemaVersionNode, defaultHostNode, baseFlakeNode, fleetNode, cattleNode, hostsNode] = await Promise.all([
        configDotGet({ data: { projectId: projectId as Id<"projects">, path: "schemaVersion" } }),
        configDotGet({ data: { projectId: projectId as Id<"projects">, path: "defaultHost" } }),
        configDotGet({ data: { projectId: projectId as Id<"projects">, path: "baseFlake" } }),
        configDotGet({ data: { projectId: projectId as Id<"projects">, path: "fleet" } }),
        configDotGet({ data: { projectId: projectId as Id<"projects">, path: "cattle" } }),
        configDotGet({ data: { projectId: projectId as Id<"projects">, path: "hosts" } }),
      ])
      const schemaVersion = typeof schemaVersionNode.value === "string" ? schemaVersionNode.value : "v1"
      const defaultHost = typeof defaultHostNode.value === "string" ? defaultHostNode.value : undefined
      const baseFlake = typeof baseFlakeNode.value === "string" ? baseFlakeNode.value : ""
      const config = {
        schemaVersion,
        defaultHost,
        baseFlake,
        fleet: fleetNode.value && typeof fleetNode.value === "object" && !Array.isArray(fleetNode.value) ? fleetNode.value : {},
        cattle: cattleNode.value && typeof cattleNode.value === "object" && !Array.isArray(cattleNode.value) ? cattleNode.value : {},
        hosts: hostsNode.value && typeof hostsNode.value === "object" && !Array.isArray(hostsNode.value) ? hostsNode.value : {},
      }
      return {
        configPath: "fleet/clawlets.json",
        config,
        json: JSON.stringify(config, null, 2),
      }
    },
  })

  const config = cfg.data?.config

  const [codexEnable, setCodexEnable] = useState(false)
  const [resticEnable, setResticEnable] = useState(false)
  const [resticRepo, setResticRepo] = useState("")

  const [jsonText, setJsonText] = useState("")

  useEffect(() => {
    if (!config) return
    setCodexEnable(Boolean(config.fleet.codex?.enable))
    setResticEnable(Boolean(config.fleet.backups?.restic?.enable))
    setResticRepo(config.fleet.backups?.restic?.repository || "")
    setJsonText(JSON.stringify(config, null, 2))
  }, [config])

  const saveVisual = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error("config not loaded")
      const next = {
        ...config,
        fleet: {
          ...config.fleet,
          codex: { ...config.fleet.codex, enable: codexEnable },
          backups: {
            ...config.fleet.backups,
            restic: {
              ...config.fleet.backups.restic,
              enable: resticEnable,
              repository: resticRepo.trim(),
            },
          },
        },
      }
      return await writeClawletsConfigFile({
        data: {
          projectId: projectId as Id<"projects">,
          next,
          title: "Update fleet settings",
        },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: configQueryKey })
      } else {
        toast.error("Validation failed")
      }
    },
  })

  const saveJson = useMutation({
    mutationFn: async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch {
        return { ok: false as const, issues: [{ code: "json", path: [], message: "Invalid JSON" }] }
      }
      return await writeClawletsConfigFile({
        data: { projectId: projectId as Id<"projects">, next: parsed, title: "Update config (JSON)" },
      })
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Saved")
        void queryClient.invalidateQueries({ queryKey: configQueryKey })
      } else {
        toast.error("Validation failed")
      }
    },
  })

  const [dotPath, setDotPath] = useState("fleet.codex.enable")
  const [dotValueJson, setDotValueJson] = useState("")
  const [dotValue, setDotValue] = useState("")
  const [dotResult, setDotResult] = useState<null | { path: string; value: unknown }>(null)

  const dotGet = useMutation({
    mutationFn: async () =>
      await configDotGet({
        data: { projectId: projectId as Id<"projects">, path: dotPath },
      }),
    onSuccess: (res) => setDotResult(res),
  })

  const dotSet = useMutation({
    mutationFn: async (del: boolean) =>
      await configDotSet({
        data: {
          projectId: projectId as Id<"projects">,
          path: dotPath,
          value: dotValue || undefined,
          valueJson: dotValueJson || undefined,
          del,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Updated")
        void queryClient.invalidateQueries({ queryKey: configQueryKey })
      } else toast.error("Validation failed")
    },
  })

  const lastIssues = useMemo(() => {
    const r = (saveVisual.data && !saveVisual.data.ok ? saveVisual.data : null) ||
      (saveJson.data && !saveJson.data.ok ? saveJson.data : null) ||
      (dotSet.data && !dotSet.data.ok ? dotSet.data : null)
    return r?.issues ?? null
  }, [saveJson.data, saveVisual.data, dotSet.data])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black tracking-tight">Skills</h1>
      <p className="text-muted-foreground">
        Configure skills and <code>fleet/clawlets.json</code> for{" "}
        <span className="font-medium">{projectQuery.project?.name || projectSlug}</span>.
      </p>

      {projectQuery.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : projectQuery.error ? (
        <div className="text-sm text-destructive">{String(projectQuery.error)}</div>
      ) : !projectId ? (
        <div className="text-muted-foreground">Project not found.</div>
      ) : cfg.isPending ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : cfg.error ? (
        <div className="text-sm text-destructive">{String(cfg.error)}</div>
      ) : !config ? (
        <div className="text-muted-foreground">Missing config.</div>
      ) : (
        <Tabs defaultValue="visual" className="w-full">
          <TabsList>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
            <TabsTrigger value="dot">Dot-path</TabsTrigger>
          </TabsList>

          <TabsContent value="visual">
            <div className="rounded-lg border bg-card p-6 space-y-6">
              <div className="text-xs text-muted-foreground">
                fleet/clawlets.json
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithHelp>Codex</LabelWithHelp>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-sm font-medium">
                        <span>Enable Codex</span>
                        <HelpTooltip title="Enable Codex" side="top">
                          {setupFieldHelp.fleet.codexEnable}
                        </HelpTooltip>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Stored as <code>fleet.codex.enable</code>.
                      </div>
                    </div>
                    <Switch checked={codexEnable} onCheckedChange={setCodexEnable} />
                  </div>
                </div>

                <div className="space-y-2">
                  <LabelWithHelp>Backups (restic)</LabelWithHelp>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 text-sm font-medium">
                        <span>Enable restic</span>
                        <HelpTooltip title="Enable restic" side="top">
                          {setupFieldHelp.fleet.resticEnable}
                        </HelpTooltip>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Stored as <code>fleet.backups.restic.enable</code>.
                      </div>
                    </div>
                    <Switch checked={resticEnable} onCheckedChange={setResticEnable} />
                  </div>
                  <div className="mt-3 space-y-2">
                    <LabelWithHelp htmlFor="resticRepo" help={setupFieldHelp.fleet.resticRepo}>
                      Repository
                    </LabelWithHelp>
                    <Input
                      id="resticRepo"
                      value={resticRepo}
                      disabled={!resticEnable}
                      onChange={(e) => setResticRepo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {lastIssues ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="font-medium">Validation errors</div>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {lastIssues.slice(0, 20).map((i) => (
                      <li key={`${i.code}:${i.path.join(".")}:${i.message}`}>
                        {i.path.length ? i.path.join(".") : "(root)"}: {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <AsyncButton
                  type="button"
                  disabled={saveVisual.isPending}
                  pending={saveVisual.isPending}
                  pendingText="Saving..."
                  onClick={() => saveVisual.mutate()}
                >
                  Save
                </AsyncButton>
                <AsyncButton
                  type="button"
                  variant="outline"
                  disabled={cfg.isPending}
                  pending={cfg.isPending}
                  pendingText="Reloading..."
                  onClick={() => void queryClient.invalidateQueries({ queryKey: configQueryKey })}
                >
                  Reload
                </AsyncButton>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="json">
            <div className="rounded-lg border bg-card p-6 space-y-4">
              <div className="text-xs text-muted-foreground">Edit full config. Saved atomically.</div>
              <LabelWithHelp htmlFor="configJson" help={setupFieldHelp.fleet.jsonEditor}>
                Config JSON
              </LabelWithHelp>
              <Textarea
                id="configJson"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="font-mono min-h-[360px]"
              />
              {lastIssues ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <div className="font-medium">Validation errors</div>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {lastIssues.slice(0, 20).map((i) => (
                      <li key={`${i.code}:${i.path.join(".")}:${i.message}`}>
                        {i.path.length ? i.path.join(".") : "(root)"}: {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <AsyncButton
                  type="button"
                  disabled={saveJson.isPending}
                  pending={saveJson.isPending}
                  pendingText="Saving JSON..."
                  onClick={() => saveJson.mutate()}
                >
                  Save JSON
                </AsyncButton>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(jsonText)
                      setJsonText(`${JSON.stringify(parsed, null, 2)}\n`)
                    } catch {
                      toast.error("Invalid JSON")
                    }
                  }}
                >
                  Format
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dot">
            <div className="rounded-lg border bg-card p-6 space-y-4">
              <div className="text-xs text-muted-foreground">
                Mirrors <code>clawlets config get/set</code>.
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <LabelWithHelp htmlFor="dotPath" help={setupFieldHelp.fleet.dotPath}>
                    Path
                  </LabelWithHelp>
                  <Input id="dotPath" value={dotPath} onChange={(e) => setDotPath(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <LabelWithHelp htmlFor="dotValue" help={setupFieldHelp.fleet.dotValue}>
                    Value (string)
                  </LabelWithHelp>
                  <Input id="dotValue" value={dotValue} onChange={(e) => setDotValue(e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <LabelWithHelp htmlFor="dotJson" help={setupFieldHelp.fleet.dotValueJson}>
                    Value (JSON)
                  </LabelWithHelp>
                  <Textarea
                    id="dotJson"
                    value={dotValueJson}
                    onChange={(e) => setDotValueJson(e.target.value)}
                    className="font-mono min-h-[120px]"
                    placeholder='{"example":true}'
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AsyncButton
                  type="button"
                  variant="outline"
                  disabled={dotGet.isPending}
                  pending={dotGet.isPending}
                  pendingText="Getting..."
                  onClick={() => dotGet.mutate()}
                >
                  Get
                </AsyncButton>
                <AsyncButton
                  type="button"
                  disabled={dotSet.isPending}
                  pending={dotSet.isPending}
                  pendingText="Setting..."
                  onClick={() => dotSet.mutate(false)}
                >
                  Set
                </AsyncButton>
                <AsyncButton
                  type="button"
                  variant="destructive"
                  disabled={dotSet.isPending}
                  pending={dotSet.isPending}
                  pendingText="Deleting..."
                  onClick={() => dotSet.mutate(true)}
                >
                  Delete
                </AsyncButton>
              </div>
              {dotResult ? (
                <pre className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(dotResult, null, 2)}
                </pre>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
