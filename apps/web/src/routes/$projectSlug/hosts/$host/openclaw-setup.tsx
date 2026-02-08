"use client"

import { convexQuery } from "@convex-dev/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { SetupCelebration } from "~/components/setup/setup-celebration"
import { OpenClawSetupStepDeploy } from "~/components/setup/openclaw/step-deploy"
import { OpenClawSetupStepEnable } from "~/components/setup/openclaw/step-enable"
import { OpenClawSetupStepGateway } from "~/components/setup/openclaw/step-gateway"
import { OpenClawSetupStepSecrets } from "~/components/setup/openclaw/step-secrets"
import { SetupHeader } from "~/components/setup/setup-header"
import { SetupSection } from "~/components/setup/setup-section"
import { Accordion } from "~/components/ui/accordion"
import { projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"
import { coerceOpenClawSetupStepId } from "~/lib/setup/openclaw-setup-model"
import { useOpenClawSetupModel } from "~/lib/setup/use-openclaw-setup-model"

const OpenClawSetupSearchSchema = z.object({
  step: z.string().trim().optional(),
})

export const Route = createFileRoute("/$projectSlug/hosts/$host/openclaw-setup")({
  validateSearch: (search) => {
    const parsed = OpenClawSetupSearchSchema.safeParse(search)
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
      context.queryClient.ensureQueryData(
        convexQuery(api.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.gateways.listByProjectHost, { projectId: projectId as Id<"projects">, hostName: params.host }),
      ),
    ])
  },
  component: OpenClawSetupPage,
})

function OpenClawSetupPage() {
  const { projectSlug, host } = Route.useParams()
  const search = Route.useSearch()
  const setup = useOpenClawSetupModel({ projectSlug, host, search })
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

  const requiredDone = setup.model.steps.filter((s) => s.status === "done").length
  const requiredTotal = setup.model.steps.length
  const deployHref = `${buildHostPath(projectSlug, selectedHost)}/deploy`
  const visibleSteps = setup.model.steps.filter((s) => s.status !== "locked")
  const accordionValue = [setup.model.activeStepId]

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SetupHeader
        selectedHost={selectedHost}
        selectedHostTheme={selectedHostTheme}
        requiredDone={requiredDone}
        requiredTotal={requiredTotal}
        deployHref={deployHref}
      />

      {setup.model.showCelebration ? (
        <SetupCelebration
          title={`OpenClaw live on ${selectedHost}`}
          description="Gateway services are enabled and deployed."
          primaryLabel="Open Gateways"
          primaryTo={`${buildHostPath(projectSlug, selectedHost)}/gateways`}
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
          const stepId = coerceOpenClawSetupStepId(last)
          if (!stepId) return
          const step = setup.model.steps.find((s) => s.id === stepId)
          if (!step || step.status === "locked") return
          setup.setStep(stepId)
        }}
      >
        {visibleSteps.map((step, idx) => {
          const index = idx + 1
          if (step.id === "enable") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <OpenClawSetupStepEnable
                  projectId={projectId as Id<"projects">}
                  host={selectedHost}
                  isComplete={step.status === "done"}
                  onContinue={setup.advance}
                />
              </SetupSection>
            )
          }
          if (step.id === "gateway") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <OpenClawSetupStepGateway
                  projectSlug={projectSlug}
                  host={selectedHost}
                  isComplete={step.status === "done"}
                  onContinue={setup.advance}
                />
              </SetupSection>
            )
          }
          if (step.id === "secrets") {
            return (
              <SetupSection key={step.id} value={step.id} index={index} title={step.title} status={step.status}>
                <OpenClawSetupStepSecrets
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
                <OpenClawSetupStepDeploy
                  projectSlug={projectSlug}
                  host={selectedHost}
                  isComplete={step.status === "done"}
                  onContinue={setup.advance}
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
