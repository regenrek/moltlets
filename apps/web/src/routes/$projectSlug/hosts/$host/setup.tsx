"use client"

import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { z } from "zod"
import type { HostTheme } from "@clawlets/core/lib/host/host-theme"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { api } from "../../../../../convex/_generated/api"
import { SetupCelebration } from "~/components/setup/setup-celebration"
import { SetupHeader } from "~/components/setup/setup-header"
import { SetupStepConnection } from "~/components/setup/steps/step-connection"
import { SetupStepCreds } from "~/components/setup/steps/step-creds"
import { SetupStepDeploy } from "~/components/setup/steps/step-deploy"
import { SetupStepHost } from "~/components/setup/steps/step-host"
import { SetupStepRunner } from "~/components/setup/steps/step-runner"
import { SetupStepSecrets } from "~/components/setup/steps/step-secrets"
import { SetupStepVerify } from "~/components/setup/steps/step-verify"
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert"
import { AsyncButton } from "~/components/ui/async-button"
import { Button } from "~/components/ui/button"
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
import { coerceSetupStepId } from "~/lib/setup/setup-model"
import { useSetupModel } from "~/lib/setup/use-setup-model"
import { projectRetryInit } from "~/sdk/project"
import { toast } from "sonner"

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

// ---------------------------------------------------------------------------
// Step descriptions for the stepper trigger labels
// ---------------------------------------------------------------------------

const STEP_META: Record<string, { title: string; description: string }> = {
  runner: { title: "Connect Runner", description: "Install CLI and start a runner" },
  host: { title: "Add First Host", description: "Configure a host entry" },
  connection: { title: "Server Access", description: "Network and SSH settings" },
  creds: { title: "Provider Tokens", description: "Cloud and deploy credentials" },
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

// ---------------------------------------------------------------------------
// Creating state — minimal stepper with runner step only
// ---------------------------------------------------------------------------

function CreatingView(props: {
  projectId: Id<"projects">
  projectSlug: string
  host: string
  runnerOnline: boolean
  runners: Array<{ runnerName: string; lastStatus: string; lastSeenAt: number }>
  projectRunnerRepoPath: string | null
}) {
  const router = useRouter()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Setting up project</h2>
        <p className="text-sm text-muted-foreground">Connect a runner to initialize the project repo.</p>
      </div>

      <Stepper defaultValue="runner" orientation="vertical" nonInteractive>
        <StepperList>
          <StepperItem value="runner">
            <StepperTrigger className="not-last:pb-6">
              <StepperIndicator />
              <div className="flex flex-col gap-1">
                <StepperTitle>Connect Runner</StepperTitle>
                <StepperDescription>Install CLI and start a runner</StepperDescription>
              </div>
            </StepperTrigger>
            <StepperSeparator className="absolute inset-y-0 top-5 left-3.5 -z-10 -order-1 h-full -translate-x-1/2" />
          </StepperItem>
          <StepperItem value="init" disabled>
            <StepperTrigger className="not-last:pb-6">
              <StepperIndicator />
              <div className="flex flex-col gap-1">
                <StepperTitle>Initialize Project</StepperTitle>
                <StepperDescription>Scaffold repo files on the runner</StepperDescription>
              </div>
            </StepperTrigger>
          </StepperItem>
        </StepperList>

        <StepperContent
          value="runner"
          className="rounded-lg border bg-card p-4 text-card-foreground"
        >
          <SetupStepRunner
            projectId={props.projectId}
            projectRunnerRepoPath={props.projectRunnerRepoPath}
            host={props.host}
            stepStatus="active"
            isCurrentStep={true}
            runnerOnline={props.runnerOnline}
            repoProbeOk={false}
            repoProbeState="idle"
            repoProbeError={null}
            runners={props.runners}
            onContinue={() => {
              void router.navigate({
                to: "/$projectSlug/setup/",
                params: { projectSlug: props.projectSlug },
              } as any)
            }}
          />
        </StepperContent>
      </Stepper>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main setup page
// ---------------------------------------------------------------------------

function HostSetupPage() {
  const { projectSlug, host } = Route.useParams()
  const search = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const setup = useSetupModel({ projectSlug, host, search })
  const projectId = setup.projectId
  const latestProjectInitRun = (setup.projectInitRunsPageQuery.data as any)?.page?.find?.((run: any) => run?.kind === "project_init") ?? null
  const latestProjectInitHost = String(latestProjectInitRun?.host || "").trim() || host
  const retryProjectInit = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("project not found")
      return await projectRetryInit({
        data: {
          projectId: projectId as Id<"projects">,
          host: latestProjectInitHost,
        },
      })
    },
    onSuccess: () => {
      toast.success("Project init retry queued")
      void queryClient.invalidateQueries({ queryKey: projectsListQueryOptions().queryKey })
      void router.navigate({
        to: "/$projectSlug/hosts/$host/setup",
        params: { projectSlug, host },
        search: { step: "runner" },
      } as any)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

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
    return (
      <CreatingView
        projectId={projectId as Id<"projects">}
        projectSlug={projectSlug}
        host={host}
        runnerOnline={setup.runnerOnline}
        runners={(setup.runners as any[]).map((runner: any) => ({
          runnerName: String(runner.runnerName || ""),
          lastStatus: String(runner.lastStatus || "offline"),
          lastSeenAt: Number(runner.lastSeenAt || 0),
        }))}
        projectRunnerRepoPath={(setup.projectQuery.project as any)?.runnerRepoPath ?? null}
      />
    )
  }

  if (setup.projectStatus === "error") {
    const latestInitError = String(latestProjectInitRun?.errorMessage || "").trim()
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
          <AlertTitle>Project setup failed</AlertTitle>
          <AlertDescription>
            {latestInitError || "Project init failed. Check runs for details."}
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <AsyncButton
            type="button"
            size="sm"
            pending={retryProjectInit.isPending}
            pendingText="Retrying..."
            onClick={() => retryProjectInit.mutate()}
          >
            Retry project init
          </AsyncButton>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void router.navigate({
                to: "/$projectSlug/runs",
                params: { projectSlug },
              } as any)
            }}
          >
            Open runs
          </Button>
        </div>
      </div>
    )
  }

  const requiredSteps = setup.model.steps.filter((s) => !s.optional)
  const requiredDone = requiredSteps.filter((s) => s.status === "done").length
  const runnerStep = setup.model.steps.find((step) => step.id === "runner") ?? null
  const selectedHost = setup.model.selectedHost
  const holdRunnerUntilContinue = String(search.step || "").trim() === "runner"

  if (!selectedHost && runnerStep?.status === "done" && holdRunnerUntilContinue) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <SetupHeader
          selectedHost={null}
          selectedHostTheme={null}
          requiredDone={requiredDone}
          requiredTotal={requiredSteps.length}
          deployHref={null}
        />
        <div className="rounded-lg border bg-card p-4 text-card-foreground">
          <SetupStepRunner
            projectId={projectId as Id<"projects">}
            projectRunnerRepoPath={(setup.projectQuery.project as any)?.runnerRepoPath ?? null}
            host={host}
            stepStatus="done"
            isCurrentStep={true}
            runnerOnline={setup.runnerOnline}
            repoProbeOk={setup.repoProbeOk}
            repoProbeState={setup.repoProbeState}
            repoProbeError={setup.repoProbeError}
            runners={(setup.runners as any[]).map((runner: any) => ({
              runnerName: String(runner.runnerName || ""),
              lastStatus: String(runner.lastStatus || "offline"),
              lastSeenAt: Number(runner.lastSeenAt || 0),
            }))}
            onContinue={() => {
              void router.navigate({
                to: "/$projectSlug/hosts/$host/setup",
                params: { projectSlug, host },
                search: { step: "host" },
              } as any)
            }}
          />
        </div>
      </div>
    )
  }

  // No host configured yet, show "Add First Host" in stepper
  if (!selectedHost && runnerStep?.status === "done") {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <SetupHeader
          selectedHost={null}
          selectedHostTheme={null}
          requiredDone={requiredDone}
          requiredTotal={requiredSteps.length}
          deployHref={null}
        />
        <Stepper defaultValue="host" orientation="vertical" nonInteractive>
          <StepperList>
            <StepperItem value="runner" completed>
              <StepperTrigger className="not-last:pb-6">
                <StepperIndicator />
                <div className="flex flex-col gap-1">
                  <StepperTitle>Connect Runner</StepperTitle>
                  <StepperDescription>Runner connected</StepperDescription>
                </div>
              </StepperTrigger>
              <StepperSeparator className="absolute inset-y-0 top-5 left-3.5 -z-10 -order-1 h-full -translate-x-1/2" />
            </StepperItem>
            <StepperItem value="host">
              <StepperTrigger className="not-last:pb-6">
                <StepperIndicator />
                <div className="flex flex-col gap-1">
                  <StepperTitle>Add First Host</StepperTitle>
                  <StepperDescription>Configure a host entry</StepperDescription>
                </div>
              </StepperTrigger>
            </StepperItem>
          </StepperList>
          <StepperContent
            value="host"
            className="rounded-lg border bg-card p-4 text-card-foreground"
          >
            <SetupStepHost
              projectId={projectId as Id<"projects">}
              config={setup.config}
              onSelectHost={(nextHost) => {
                const clean = String(nextHost || "").trim()
                if (!clean) return
                void router.navigate({
                  to: "/$projectSlug/hosts/$host/setup",
                  params: { projectSlug, host: clean },
                  search: { step: "connection" },
                } as any)
              }}
            />
          </StepperContent>
        </Stepper>
      </div>
    )
  }

  const activeHost = selectedHost ?? host

  const hostCfg = (setup.config?.hosts?.[activeHost] as
    | { theme?: HostTheme }
    | undefined) ?? null
  const selectedHostTheme: HostTheme | null = hostCfg?.theme ?? null

  const deployHref = `${buildHostPath(projectSlug, activeHost)}/deploy`
  const visibleSteps = setup.model.steps.filter((s) => s.status !== "locked")

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <SetupHeader
        selectedHost={activeHost}
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
          primaryTo={`${buildHostPath(projectSlug, activeHost)}/openclaw-setup`}
          secondaryLabel="Go to host overview"
          secondaryTo={buildHostPath(projectSlug, activeHost)}
        />
      ) : null}

      <Stepper
        value={setup.model.activeStepId}
        onValueChange={(value) => {
          const stepId = coerceSetupStepId(value)
          if (!stepId) return
          const step = setup.model.steps.find((s) => s.id === stepId)
          if (!step || step.status === "locked") return
          setup.setStep(stepId)
        }}
        orientation="vertical"
        activationMode="manual"
      >
        <StepperList>
          {visibleSteps.map((step) => (
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
              <StepperSeparator className="absolute inset-y-0 top-5 left-3.5 -z-10 -order-1 h-full -translate-x-1/2" />
            </StepperItem>
          ))}
        </StepperList>

        {visibleSteps.map((step) => (
          <StepperContent
            key={step.id}
            value={step.id}
            className="rounded-lg border bg-card p-4 text-card-foreground"
          >
            <StepContent
              stepId={step.id as SetupStepId}
              step={step}
              projectId={projectId as Id<"projects">}
              projectSlug={projectSlug}
              host={activeHost}
              setup={setup}
            />
          </StepperContent>
        ))}
      </Stepper>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step content dispatcher — renders the right step component
// ---------------------------------------------------------------------------

function StepContent(props: {
  stepId: SetupStepId
  step: { id: string; status: SetupStepStatus }
  projectId: Id<"projects">
  projectSlug: string
  host: string
  setup: ReturnType<typeof useSetupModel>
}) {
  const { stepId, step, projectId, projectSlug, host, setup } = props

  if (stepId === "runner") {
    return (
      <SetupStepRunner
        projectId={projectId}
        projectRunnerRepoPath={(setup.projectQuery.project as any)?.runnerRepoPath ?? null}
        host={host}
        stepStatus={step.status as SetupStepStatus}
        isCurrentStep={setup.model.activeStepId === step.id}
        runnerOnline={setup.runnerOnline}
        repoProbeOk={setup.repoProbeOk}
        repoProbeState={setup.repoProbeState}
        repoProbeError={setup.repoProbeError}
        runners={(setup.runners as any[]).map((runner: any) => ({
          runnerName: String(runner.runnerName || ""),
          lastStatus: String(runner.lastStatus || "offline"),
          lastSeenAt: Number(runner.lastSeenAt || 0),
        }))}
        onContinue={setup.advance}
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
        onContinue={setup.advance}
      />
    )
  }

  if (stepId === "creds") {
    return (
      <SetupStepCreds
        projectId={projectId}
        isComplete={step.status === "done"}
        onContinue={setup.advance}
      />
    )
  }

  if (stepId === "secrets") {
    return (
      <SetupStepSecrets
        projectSlug={projectSlug}
        projectId={projectId}
        host={host}
        isComplete={step.status === "done"}
        onContinue={setup.advance}
      />
    )
  }

  if (stepId === "deploy") {
    return (
      <SetupStepDeploy
        projectSlug={projectSlug}
        host={host}
        hasBootstrapped={setup.model.hasBootstrapped}
        onContinue={setup.advance}
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
