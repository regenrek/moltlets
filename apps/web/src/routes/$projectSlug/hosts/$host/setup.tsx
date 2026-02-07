"use client"

import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { SetupCelebration } from "~/components/setup/setup-celebration"
import { SetupHeader } from "~/components/setup/setup-header"
import { SetupSection } from "~/components/setup/setup-section"
import { SetupStepConnection } from "~/components/setup/steps/step-connection"
import { SetupStepCreds } from "~/components/setup/steps/step-creds"
import { SetupStepDeploy } from "~/components/setup/steps/step-deploy"
import { SetupStepSecrets } from "~/components/setup/steps/step-secrets"
import { SetupStepVerify } from "~/components/setup/steps/step-verify"
import { Accordion } from "~/components/ui/accordion"
import { clawletsConfigQueryOptions, deployCredsQueryOptions, projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"
import { coerceSetupStepId } from "~/lib/setup/setup-model"
import { useSetupModel } from "~/lib/setup/use-setup-model"

const SetupSearchSchema = z.object({
  step: z.string().trim().optional(),
})

export const Route = createFileRoute("/$projectSlug/hosts/$host/setup")({
  validateSearch: (search) => {
    const parsed = SetupSearchSchema.safeParse(search)
    return parsed.success ? parsed.data : {}
  },
  loader: async ({ context, params }) => {
    const projectsQuery = projectsListQueryOptions()
    const projects = (await context.queryClient.ensureQueryData(projectsQuery)) as Array<any>
    const project =
      projects.find((item) => slugifyProjectName(String(item?.name || "")) === params.projectSlug) ||
      null
    const projectId = project?._id ?? null
    if (!projectId || project?.status !== "ready") return
    await Promise.all([
      context.queryClient.ensureQueryData(clawletsConfigQueryOptions(projectId)),
      context.queryClient.ensureQueryData(deployCredsQueryOptions(projectId)),
    ])
  },
  component: HostSetupPage,
})

function HostSetupPage() {
  const { projectSlug, host } = Route.useParams()
  const search = Route.useSearch()
  const setup = useSetupModel({ projectSlug, host, search })
  const projectId = setup.projectId

  if (setup.projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>
  }
  if (setup.projectQuery.error) {
    return <div className="text-sm text-destructive">{String(setup.projectQuery.error)}</div>
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>
  }
  if (setup.projectStatus === "creating") {
    return <div className="text-muted-foreground">Project setup in progress. Refresh after the run completes.</div>
  }
  if (setup.projectStatus === "error") {
    return <div className="text-sm text-destructive">Project setup failed. Check Runs for details.</div>
  }

  const selectedHost = setup.model.selectedHost
  if (!selectedHost) {
    return <div className="text-muted-foreground">Host not found in config.</div>
  }

  const hostCfg = (setup.config?.hosts as any)?.[selectedHost] ?? null
  const selectedHostTheme = hostCfg?.theme ?? null
  const provider = String(hostCfg?.provisioning?.provider || "hetzner") === "aws" ? "aws" : "hetzner"

  const requiredSteps = setup.model.steps.filter((s) => !s.optional)
  const requiredDone = requiredSteps.filter((s) => s.status === "done").length
  const deployHref = `${buildHostPath(projectSlug, selectedHost)}/deploy`
  const visibleSteps = setup.model.steps.filter((s) => s.status !== "locked")
  const accordionValue = [setup.model.activeStepId]

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SetupHeader
        selectedHost={selectedHost}
        selectedHostTheme={selectedHostTheme}
        requiredDone={requiredDone}
        requiredTotal={requiredSteps.length}
        deployHref={deployHref}
      />

      {setup.model.showCelebration ? (
        <SetupCelebration
          title="Server installed"
          description="Bootstrap complete. Next: run the Post-bootstrap checklist to lock down SSH, then install OpenClaw."
          primaryLabel="Install OpenClaw"
          primaryTo={`${buildHostPath(projectSlug, selectedHost)}/openclaw-setup`}
          secondaryLabel="Go to host overview"
          secondaryTo={buildHostPath(projectSlug, selectedHost)}
        />
      ) : null}

      <Accordion
        value={accordionValue}
        className="space-y-3"
        onValueChange={(next) => {
          const last = next.filter(Boolean).map(String).pop()
          if (!last) return
          const stepId = coerceSetupStepId(last)
          if (!stepId) return
          const step = setup.model.steps.find((s) => s.id === stepId)
          if (!step || step.status === "locked") return
          setup.setStep(stepId)
        }}
      >
        {visibleSteps.map((step, idx) => {
          const index = idx + 1
          if (step.id === "connection") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <SetupStepConnection
                  projectId={projectId as Id<"projects">}
                  config={setup.config}
                  host={selectedHost}
                  stepStatus={step.status}
                  onContinue={setup.advance}
                />
              </SetupSection>
            )
          }
          if (step.id === "creds") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <SetupStepCreds
                  projectId={projectId as Id<"projects">}
                  provider={provider}
                  isComplete={step.status === "done"}
                  onContinue={setup.advance}
                />
              </SetupSection>
            )
          }
          if (step.id === "secrets") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <SetupStepSecrets
                  projectSlug={projectSlug}
                  projectId={projectId as Id<"projects">}
                  host={selectedHost}
                  isComplete={step.status === "done"}
                  onContinue={setup.advance}
                />
              </SetupSection>
            )
          }
          if (step.id === "deploy") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <SetupStepDeploy
                  projectSlug={projectSlug}
                  host={selectedHost}
                  hasBootstrapped={setup.model.hasBootstrapped}
                  onContinue={setup.advance}
                />
              </SetupSection>
            )
          }
          if (step.id === "verify") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <SetupStepVerify
                  projectSlug={projectSlug}
                  projectId={projectId as Id<"projects">}
                  host={selectedHost}
                  config={setup.config}
                />
              </SetupSection>
            )
          }
          return null
        })}
      </Accordion>
    </div>
  )
}
