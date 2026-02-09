import { ArrowPathIcon } from "@heroicons/react/24/outline"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { AsyncButton } from "~/components/ui/async-button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "~/components/ui/input-group"
import { StackedField } from "~/components/ui/stacked-field"
import { generateProjectName } from "~/lib/project-name-generator"
import { projectsListQueryOptions, queryKeys } from "~/lib/query-options"
import { slugifyProjectName } from "~/lib/project-routing"
import { projectCreateStart } from "~/sdk/project"

type ProjectCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ProjectCreateDialog({ open, onOpenChange }: ProjectCreateDialogProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [runnerRepoPathInput, setRunnerRepoPathInput] = useState("")
  const [runnerNameInput, setRunnerNameInput] = useState("")
  const [hostInput, setHostInput] = useState("")
  const [templateRepoInput, setTemplateRepoInput] = useState("")
  const [templatePathInput, setTemplatePathInput] = useState("")
  const [templateRefInput, setTemplateRefInput] = useState("")

  const nameSlug = useMemo(() => slugifyProjectName(name || "project"), [name])
  const defaultRunnerRepoPath = `~/.clawlets/projects/${nameSlug}`
  const defaultRunnerName = `runner-${nameSlug || "project"}`
  const defaultHost = nameSlug || "openclaw-fleet-host"
  const effectiveRunnerRepoPath = (runnerRepoPathInput.trim() || defaultRunnerRepoPath).replace(/\/+$/, "") || "/"
  const effectiveRunnerName = runnerNameInput.trim() || defaultRunnerName
  const effectiveHost = hostInput.trim() || defaultHost
  const projectsListQueryKey = projectsListQueryOptions().queryKey

  const start = useMutation({
    mutationFn: async () =>
      await projectCreateStart({
        data: {
          name,
          runnerRepoPath: effectiveRunnerRepoPath,
          host: effectiveHost,
          runnerName: effectiveRunnerName,
          templateRepo: templateRepoInput.trim(),
          templatePath: templatePathInput.trim(),
          templateRef: templateRefInput.trim(),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardOverview })
      void queryClient.invalidateQueries({ queryKey: projectsListQueryKey })
      toast.success("Project created")
      onOpenChange(false)
      void router.navigate({
        to: "/$projectSlug/setup/",
        params: { projectSlug: nameSlug },
      } as any)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  useEffect(() => {
    if (!open) return
    setName("")
    setRunnerRepoPathInput("")
    setRunnerNameInput("")
    setHostInput("")
    setTemplateRepoInput("")
    setTemplatePathInput("")
    setTemplateRefInput("")
    start.reset()
  }, [open]) // oxlint-disable-line react/exhaustive-deps -- reset dialog state on each open

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a fresh project and set up its repo on a runner.
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
                    id="runner-repo-path"
                    label="Runner repo path"
                    description={(
                      <>
                        Default: <code>{defaultRunnerRepoPath}</code>.
                      </>
                    )}
                  >
                    <InputGroup>
                      <InputGroupInput
                        id="runner-repo-path"
                        placeholder={defaultRunnerRepoPath}
                        value={runnerRepoPathInput}
                        onChange={(e) => setRunnerRepoPathInput(e.target.value)}
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          onClick={() => setRunnerRepoPathInput(defaultRunnerRepoPath)}
                          type="button"
                        >
                          Use default
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  </StackedField>

                  <StackedField
                    id="runner-name"
                    label="Runner name"
                    description={(
                      <>
                        Token is minted for this runner. Default: <code>{defaultRunnerName}</code>.
                      </>
                    )}
                  >
                    <Input
                      id="runner-name"
                      placeholder={defaultRunnerName}
                      value={runnerNameInput}
                      onChange={(e) => setRunnerNameInput(e.target.value)}
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
                      value={hostInput}
                      onChange={(e) => setHostInput(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="template-repo"
                    label="Template repo (optional)"
                    description={(
                      <>
                        Format: <code>owner/repo</code>.
                      </>
                    )}
                  >
                    <Input
                      id="template-repo"
                      placeholder="owner/repo"
                      value={templateRepoInput}
                      onChange={(e) => setTemplateRepoInput(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="template-path"
                    label="Template path (optional)"
                    description="Relative path in template repo."
                  >
                    <Input
                      id="template-path"
                      placeholder="templates/default"
                      value={templatePathInput}
                      onChange={(e) => setTemplatePathInput(e.target.value)}
                    />
                  </StackedField>

                  <StackedField
                    id="template-ref"
                    label="Template ref (optional)"
                    description="Git branch/tag/commit."
                  >
                    <Input
                      id="template-ref"
                      placeholder="main"
                      value={templateRefInput}
                      onChange={(e) => setTemplateRefInput(e.target.value)}
                    />
                  </StackedField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <AsyncButton
              type="button"
              disabled={start.isPending || !name.trim()}
              pending={start.isPending}
              pendingText="Creating project..."
              onClick={() => start.mutate()}
            >
              Create
            </AsyncButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ProjectCreateDialog }
