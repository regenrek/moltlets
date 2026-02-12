"use client"

import { convexQuery } from "@convex-dev/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"
import type { HostTheme } from "@clawlets/core/lib/host/host-theme"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner"
import { SetupCelebration } from "~/components/setup/setup-celebration"
import { SetupHeader } from "~/components/setup/setup-header"
import { SetupStepConnection } from "~/components/setup/steps/step-connection"
import { SetupStepCreds } from "~/components/setup/steps/step-creds"
import { SetupStepDeploy } from "~/components/setup/steps/step-deploy"
import { SetupStepInfrastructure } from "~/components/setup/steps/step-infrastructure"
import { SetupStepSecrets } from "~/components/setup/steps/step-secrets"
import { SetupStepVerify } from "~/components/setup/steps/step-verify"
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperList,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "~/components/ui/stepper"
import { projectsListQueryOptions } from "~/lib/query-options"
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing"
import type { SetupStepId, SetupStepStatus } from "~/lib/setup/setup-model"
import { SETUP_STEP_IDS, coerceSetupStepId, deriveHostSetupStepper } from "~/lib/setup/setup-model"
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
    if (!projectId) return
    if (project?.status !== "ready") {
      throw redirect({
        to: "/$projectSlug/runner",
        params: { projectSlug: params.projectSlug },
      })
    }
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.controlPlane.hosts.listByProject, { projectId: projectId as Id<"projects"> }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.controlPlane.runners.listByProject, { projectId: projectId as Id<"projects"> }),
      ),
    ])
  },
  component: HostSetupPage,
})

const STEP_META: Record<string, { title: string; description: string }> = {
  infrastructure: { title: "Hetzner Setup", description: "Token and provisioning defaults" },
  connection: { title: "Server Access", description: "Network and SSH settings" },
  creds: { title: "Provider Tokens", description: "GitHub and SOPS credentials" },
  secrets: { title: "Server Passwords", description: "Secrets encryption and sync" },
  deploy: { title: "Install Server", description: "Bootstrap and deploy the host" },
  verify: { title: "Secure and Verify", description: "Lock down SSH and verify" },
}

function stepMeta(id: string) {
  return STEP_META[id] ?? { title: id, description: "" }
}

function isStepCompleted(status: SetupStepStatus) {
  return status === "done"
}

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

  const selectedHost = setup.model.selectedHost
  const activeHost = selectedHost ?? host
  const hostCfg = (setup.config?.hosts?.[activeHost] as
    | { theme?: HostTheme }
    | undefined) ?? null
  const selectedHostTheme: HostTheme | null = hostCfg?.theme ?? null

  const deployHref = `${buildHostPath(projectSlug, activeHost)}/deploy`
  const stepper = deriveHostSetupStepper({
    steps: setup.model.steps,
    activeStepId: setup.model.activeStepId,
  })
  const stepperSteps = stepper.steps
  const stepperActiveStepId = stepper.activeStepId
  const requiredSteps = stepperSteps.filter((s) => !s.optional)
  const requiredDone = requiredSteps.filter((s) => s.status === "done").length
  const continueFromStep = (from: SetupStepId) => {
    const currentIndex = SETUP_STEP_IDS.findIndex((stepId) => stepId === from)
    const next = currentIndex === -1 ? null : SETUP_STEP_IDS[currentIndex + 1]
    if (next) setup.setStep(next)
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 xl:max-w-6xl">
      <RunnerStatusBanner
        projectId={projectId as Id<"projects">}
        setupHref={`/${projectSlug}/runner`}
        runnerOnline={setup.runnerOnline}
        isChecking={setup.runnersQuery.isPending}
      />

      <SetupHeader
        title="Setup your first host"
        description="Runner setup is complete. Configure this first host so deploy and runtime operations can proceed for this project."
        selectedHost={activeHost}
        selectedHostTheme={selectedHostTheme}
        requiredDone={requiredDone}
        requiredTotal={requiredSteps.length}
        deployHref={deployHref}
      />

      {setup.model.showCelebration ? (
        <SetupCelebration
          title="Server installed"
          description="Bootstrap succeeded and setup queued post-bootstrap hardening. Next: install OpenClaw."
          primaryLabel="Install OpenClaw"
          primaryTo={`${buildHostPath(projectSlug, activeHost)}/openclaw-setup`}
          secondaryLabel="Go to host overview"
          secondaryTo={buildHostPath(projectSlug, activeHost)}
        />
      ) : null}

      <Stepper
        value={stepperActiveStepId}
        onValueChange={(value) => {
          const stepId = coerceSetupStepId(value)
          if (!stepId) return
          const step = stepperSteps.find((s) => s.id === stepId)
          if (!step) return
          setup.setStep(stepId)
        }}
        orientation="vertical"
        activationMode="manual"
        className="xl:grid xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start xl:gap-8"
      >
        <StepperList className="xl:sticky xl:top-6">
          {stepperSteps.map((step) => (
            <StepperItem
              key={step.id}
              value={step.id}
              completed={isStepCompleted(step.status)}
              disabled={step.status === "locked"}
            >
              <StepperTrigger className="not-last:pb-6">
                <StepperIndicator />
                <div className="flex flex-col gap-1">
                  <StepperTitle>{stepMeta(step.id).title}</StepperTitle>
                  <StepperDescription>{stepMeta(step.id).description}</StepperDescription>
                </div>
              </StepperTrigger>
              <StepperSeparator className="pointer-events-none absolute inset-y-0 top-5 left-4 z-0 -order-1 h-full -translate-x-1/2" />
            </StepperItem>
          ))}
        </StepperList>

        {stepperSteps.map((step) => (
          <StepperContent
            key={step.id}
            value={step.id}
            className={
              ["infrastructure", "connection", "creds", "secrets", "deploy"].includes(step.id)
                ? "text-card-foreground xl:col-start-2"
                : "rounded-lg border bg-card p-4 text-card-foreground xl:col-start-2"
            }
          >
            <StepContent
              stepId={step.id as SetupStepId}
              step={step}
              projectId={projectId as Id<"projects">}
              projectSlug={projectSlug}
              host={activeHost}
              setup={setup}
              onContinueFromStep={continueFromStep}
            />
          </StepperContent>
        ))}
      </Stepper>
    </div>
  )
}

function StepContent(props: {
  stepId: SetupStepId
  step: { id: string; status: SetupStepStatus }
  projectId: Id<"projects">
  projectSlug: string
  host: string
  setup: ReturnType<typeof useSetupModel>
  onContinueFromStep: (stepId: SetupStepId) => void
}) {
  const { stepId, step, projectId, projectSlug, host, setup } = props

  if (stepId === "infrastructure") {
    return (
      <SetupStepInfrastructure
        key={`${host}:${setup.config ? "ready" : "loading"}`}
        projectId={projectId}
        config={setup.config}
        host={host}
        deployCreds={setup.deployCreds}
        deployCredsPending={setup.deployCredsQuery.isPending}
        deployCredsError={setup.deployCredsQuery.error}
        stepStatus={step.status as SetupStepStatus}
        onContinue={() => props.onContinueFromStep(stepId)}
      />
    )
  }

  if (stepId === "connection") {
    return (
      <SetupStepConnection
        projectId={projectId}
        config={setup.config}
        host={host}
        stepStatus={step.status as SetupStepStatus}
        onContinue={() => props.onContinueFromStep(stepId)}
      />
    )
  }

  if (stepId === "creds") {
    return (
      <SetupStepCreds
        projectId={projectId}
        isComplete={step.status === "done"}
        onContinue={() => props.onContinueFromStep(stepId)}
      />
    )
  }

  if (stepId === "secrets") {
    return (
      <SetupStepSecrets
        projectId={projectId}
        host={host}
        isComplete={step.status === "done"}
        onContinue={() => props.onContinueFromStep(stepId)}
      />
    )
  }

  if (stepId === "deploy") {
    return (
      <SetupStepDeploy
        projectSlug={projectSlug}
        host={host}
        hasBootstrapped={setup.model.hasBootstrapped}
        onContinue={() => props.onContinueFromStep(stepId)}
      />
    )
  }

  if (stepId === "verify") {
    return (
      <SetupStepVerify
        projectSlug={projectSlug}
        projectId={projectId}
        host={host}
        config={setup.config}
      />
    )
  }

  return null
}
