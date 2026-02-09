import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { Id } from "../../../convex/_generated/dataModel"
import { HostThemeBadge, HostThemeColorDropdown, HostThemeEmojiPicker, normalizeHostTheme, type HostThemeColor } from "~/components/hosts/host-theme"
import { RunLogTail } from "~/components/run-log-tail"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { StackedField } from "~/components/ui/stacked-field"
import { generateProjectName } from "~/lib/project-name-generator"
import { projectsListQueryOptions, queryKeys } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { projectCreateExecute, projectCreateStart, projectInitPlan } from "~/sdk/project"

type ProjectCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ProjectCreateDialog({ open, onOpenChange }: ProjectCreateDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [baseDir, setBaseDir] = useState("")
  const [host, setHost] = useState("")
  const [templateSpec, setTemplateSpec] = useState("")
  const defaultTheme = normalizeHostTheme()
  const [hostThemeEmoji, setHostThemeEmoji] = useState(defaultTheme.emoji)
  const [hostThemeColor, setHostThemeColor] = useState<HostThemeColor>(defaultTheme.color)
  const [runId, setRunId] = useState<Id<"runs"> | null>(null)
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null)
  const [redirected, setRedirected] = useState(false)

  const directoryInputRef = useRef<HTMLInputElement>(null)
  const nameSlug = useMemo(() => slugifyProjectName(name || "project"), [name])
  const defaultBaseDir = "~/.clawlets/projects"
  const defaultHost = nameSlug
  const normalizedBaseDir = (baseDir.trim() || defaultBaseDir).replace(/\/$/, "")
  const effectiveLocalPath = normalizedBaseDir.endsWith(`/${nameSlug}`)
    ? normalizedBaseDir
    : `${normalizedBaseDir}/${nameSlug}`
  const effectiveHost = host.trim() || defaultHost
  const themeInput = normalizeHostTheme({ emoji: hostThemeEmoji, color: hostThemeColor })
  const projectsListQueryKey = projectsListQueryOptions().queryKey

  useEffect(() => {
    const input = directoryInputRef.current
    if (!input) return
    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
  }, [])

  const plan = useMutation({
    mutationFn: async () =>
      await projectInitPlan({
        data: {
          localPath: effectiveLocalPath,
          host: effectiveHost,
          templateSpec,
          theme: themeInput,
        },
      }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const start = useMutation({
    mutationFn: async () =>
      await projectCreateStart({
        data: {
          name,
          localPath: effectiveLocalPath,
          host: effectiveHost,
          templateSpec,
          theme: themeInput,
          gitInit: true,
        },
      }),
    onSuccess: (res) => {
      setRedirected(false)
      setRunId(res.runId)
      setProjectId(res.projectId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverview })
      void queryClient.invalidateQueries({ queryKey: projectsListQueryKey })
      void projectCreateExecute({ data: res }).finally(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverview })
        await queryClient.invalidateQueries({ queryKey: projectsListQueryKey })
      })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  useEffect(() => {
    if (!open) return
    setName("")
    setBaseDir("")
    setHost("")
    setTemplateSpec("")
    setHostThemeEmoji(defaultTheme.emoji)
    setHostThemeColor(defaultTheme.color)
    setRunId(null)
    setProjectId(null)
    setRedirected(false)
    plan.reset()
    start.reset()
  }, [open]) // oxlint-disable-line react/exhaustive-deps -- reset dialog state on each open

  const hasCreateActivity = start.isPending || Boolean(runId)

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
      return
    }
    if (
      hasCreateActivity &&
      typeof window !== "undefined" &&
      !window.confirm("Close and discard current project creation progress?")
    ) {
      return
    }
    onOpenChange(false)
  }

  const close = (options?: { force?: boolean }) => {
    if (options?.force) {
      onOpenChange(false)
      return
    }
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Scaffold a new clawlets infra repository on this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <StackedField id="name" label="Project name">
            <InputGroup>
              <InputGroupInput
                id="name"
                placeholder="my-fleet"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="secondary"
                  disabled={start.isPending}
                  onClick={() => setName(generateProjectName())}
                >
                  <ArrowPathIcon />
                  Generate
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </StackedField>

          <Accordion className="rounded-lg border bg-muted/20">
            <AccordionItem value="advanced" className="px-4">
              <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
                Advanced options
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-4">
                  <StackedField
                    id="path"
                    label="Project directory (optional)"
                    description={(
                      <>
                        Default: <code>{defaultBaseDir}/{nameSlug}</code>. Stored locally.
                      </>
                    )}
                    actions={(
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => directoryInputRef.current?.click()}
                      >
                        Choose folder
                      </Button>
                    )}
                  >
                    <InputGroup>
                      <InputGroupInput
                        id="path"
                        placeholder={defaultBaseDir}
                        value={baseDir}
                        onChange={(e) => setBaseDir(e.target.value)}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          onClick={() => setBaseDir(defaultBaseDir)}
                          type="button"
                        >
                          Use default
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                    <input
                      ref={directoryInputRef}
                      type="file"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.currentTarget.value = ""
                        if (!file) return
                        const rel = (file as { webkitRelativePath?: string }).webkitRelativePath || ""
                        const root = rel.split("/")[0]
                        const rawPath = (file as { path?: string }).path
                        if (typeof rawPath === "string" && rel) {
                          const parent = rawPath.slice(0, Math.max(0, rawPath.length - rel.length)).replace(/\/$/, "")
                          const next = root ? `${parent}/${root}` : parent
                          if (next) {
                            setBaseDir(next)
                            return
                          }
                        }
                        if (root) {
                          setBaseDir(`${defaultBaseDir}/${root}`)
                          toast.message("Folder name captured. Adjust the path if needed.")
                          return
                        }
                        toast.message("Folder picker unavailable. Enter a directory path.")
                      }}
                    />
                  </StackedField>

                  <StackedField
                    id="host"
                    label="Host placeholder"
                    description={(
                      <>
                        Defaults to <code>{defaultHost}</code>.
                      </>
                    )}
                  >
                    <Input
                      id="host"
                      placeholder={defaultHost}
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="theme"
                    label="Host theme"
                    description="Badge shown for the default host."
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <HostThemeEmojiPicker
                        value={hostThemeEmoji}
                        onValueChange={setHostThemeEmoji}
                      />
                      <HostThemeColorDropdown
                        value={hostThemeColor}
                        onValueChange={setHostThemeColor}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                      <HostThemeBadge theme={themeInput} size="sm" />
                      <div className="text-xs text-muted-foreground">Preview badge</div>
                    </div>
                  </StackedField>

                  <StackedField
                    id="template"
                    label="Template"
                    description={(
                      <>
                        Defaults to <code>config/template-source.json</code>. Supports <code>github:</code>, <code>gh:</code>, or <code>file:</code> specs.
                      </>
                    )}
                  >
                    <Input
                      id="template"
                      placeholder="github:owner/repo/templates/default#<40-hex-sha>"
                      value={templateSpec}
                      onChange={(e) => setTemplateSpec(e.target.value)}
                    />
                  </StackedField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => close()}
            >
              Cancel
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <AsyncButton
                type="button"
                variant="outline"
                disabled={plan.isPending || !name.trim()}
                pending={plan.isPending}
                pendingText="Previewing files..."
                onClick={() => plan.mutate()}
              >
                Preview files
              </AsyncButton>
              <AsyncButton
                type="button"
                disabled={
                  start.isPending ||
                  !!runId ||
                  !name.trim() ||
                  !effectiveLocalPath.trim() ||
                  !effectiveHost.trim()
                }
                pending={start.isPending}
                pendingText="Creating project..."
                onClick={() => start.mutate()}
              >
                Create
              </AsyncButton>
            </div>
          </div>

          {plan.data ? (
            <div className="rounded-md bg-muted/40 p-3">
              <div className="text-sm font-medium">
                {plan.data.plannedFiles.length} files
              </div>
              <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap break-words max-h-48 overflow-auto">
                {plan.data.plannedFiles.slice(0, 200).join("\n")}
                {plan.data.plannedFiles.length > 200
                  ? `\n… +${plan.data.plannedFiles.length - 200} more`
                  : ""}
              </pre>
            </div>
          ) : null}

          {projectId && runId ? (
            <div className="space-y-3">
              <RunLogTail
                runId={runId}
                onDone={(status) => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverview })
                  void queryClient.invalidateQueries({ queryKey: projectsListQueryKey })
                  if (redirected) return
                  if (status !== "succeeded") return
                  setRedirected(true)
                  close({ force: true })
                  void router.navigate({
                    to: "/$projectSlug/setup/",
                    params: { projectSlug: nameSlug },
                  } as any)
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    close({ force: true })
                    void router.navigate({
                      to: "/$projectSlug/setup/",
                      params: { projectSlug: nameSlug },
                    } as any)
                  }}
                >
                  Continue setup
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    close({ force: true })
                    void router.navigate({
                      to: "/$projectSlug",
                      params: { projectSlug: nameSlug },
                    } as any)
                  }}
                >
                  Open dashboard
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    close({ force: true })
                    void router.navigate({
                      to: "/$projectSlug/runs",
                      params: { projectSlug: nameSlug },
                    } as any)
                  }}
                >
                  Runs
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ProjectCreateDialog }
