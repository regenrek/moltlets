"use client";

import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as React from "react";
import { CheckIcon } from "@heroicons/react/24/solid";
import { z } from "zod";
import type { HostTheme } from "@clawlets/core/lib/host/host-theme";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner";
import { SetupCelebration } from "~/components/setup/setup-celebration";
import { SetupHeader } from "~/components/setup/setup-header";
import { SetupStepConnection } from "~/components/setup/steps/step-connection";
import { SetupStepDeploy } from "~/components/setup/steps/step-deploy";
import { SetupStepInfrastructure } from "~/components/setup/steps/step-infrastructure";
import { SetupStepTailscaleLockdown } from "~/components/setup/steps/step-tailscale-lockdown";
import { SetupStepVerify } from "~/components/setup/steps/step-verify";
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
} from "~/components/ui/stepper";
import { projectsListQueryOptions } from "~/lib/query-options";
import { buildHostPath, slugifyProjectName } from "~/lib/project-routing";
import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state";
import type { SetupStepId, SetupStepStatus } from "~/lib/setup/setup-model";
import {
  SETUP_STEP_IDS,
  coerceSetupStepId,
  deriveHostSetupStepper,
} from "~/lib/setup/setup-model";
import { useSetupModel } from "~/lib/setup/use-setup-model";
import type {
  SetupDraftConnection,
  SetupDraftInfrastructure,
} from "~/sdk/setup";

const SetupSearchSchema = z.object({
  step: z.string().trim().optional(),
});

export const Route = createFileRoute("/$projectSlug/hosts/$host/setup")({
  validateSearch: (search) => {
    const parsed = SetupSearchSchema.safeParse(search);
    return parsed.success ? parsed.data : {};
  },
  loader: async ({ context, params }) => {
    const projectsQuery = projectsListQueryOptions();
    const projects = (await context.queryClient.ensureQueryData(
      projectsQuery,
    )) as Array<any>;
    const project =
      projects.find(
        (item) =>
          slugifyProjectName(String(item?.name || "")) === params.projectSlug,
      ) || null;
    const projectId = project?._id ?? null;
    if (!projectId) return;
    if (project?.status !== "ready") {
      throw redirect({
        to: "/$projectSlug/runner",
        params: { projectSlug: params.projectSlug },
      });
    }
    await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.controlPlane.hosts.listByProject, {
          projectId: projectId as Id<"projects">,
        }),
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.controlPlane.runners.listByProject, {
          projectId: projectId as Id<"projects">,
        }),
      ),
    ]);
  },
  component: HostSetupPage,
});

const STEP_META: Record<string, { title: string; description: string }> = {
  infrastructure: {
    title: "Hetzner Setup",
    description: "Token and provisioning defaults",
  },
  connection: {
    title: "Server Access",
    description: "Network and SSH settings",
  },
  "tailscale-lockdown": {
    title: "Tailscale lockdown",
    description: "Enable safer SSH access path",
  },
  deploy: { title: "Install Server", description: "Final check and bootstrap" },
  verify: {
    title: "Secure and Verify",
    description: "Lock down SSH and verify",
  },
};

function stepMeta(id: string) {
  return STEP_META[id] ?? { title: id, description: "" };
}

function isStepCompleted(status: SetupStepStatus) {
  return status === "done";
}

type SetupPendingBootstrapSecrets = {
  adminPassword: string;
  tailscaleAuthKey: string;
  useTailscaleLockdown: boolean;
};

function HostSetupPage() {
  const { projectSlug, host } = Route.useParams();
  const search = Route.useSearch();
  const [pendingInfrastructureDraft, setPendingInfrastructureDraft] =
    React.useState<SetupDraftInfrastructure | null>(null);
  const [pendingConnectionDraft, setPendingConnectionDraft] =
    React.useState<SetupDraftConnection | null>(null);
  const [pendingBootstrapSecrets, setPendingBootstrapSecrets] =
    React.useState<SetupPendingBootstrapSecrets>({
      adminPassword: "",
      tailscaleAuthKey: "",
      useTailscaleLockdown: true,
    });

  const pendingNonSecretDraft = React.useMemo(
    () => ({
      infrastructure: pendingInfrastructureDraft ?? undefined,
      connection: pendingConnectionDraft ?? undefined,
    }),
    [pendingConnectionDraft, pendingInfrastructureDraft],
  );

  const setup = useSetupModel({
    projectSlug,
    host,
    search,
    pendingNonSecretDraft,
    pendingBootstrapSecrets: {
      tailscaleAuthKey: pendingBootstrapSecrets.tailscaleAuthKey,
      useTailscaleLockdown: pendingBootstrapSecrets.useTailscaleLockdown,
    },
  });
  const projectId = setup.projectId;

  React.useEffect(() => {
    setPendingInfrastructureDraft(null);
    setPendingConnectionDraft(null);
    setPendingBootstrapSecrets({
      adminPassword: "",
      tailscaleAuthKey: "",
      useTailscaleLockdown: true,
    });
  }, [host]);

  React.useEffect(() => {
    const activeProjectKey = setup.activeTailscaleAuthKey?.trim() || "";
    if (!activeProjectKey) return;
    setPendingBootstrapSecrets((prev) => {
      if (prev.tailscaleAuthKey.trim()) return prev;
      return {
        ...prev,
        tailscaleAuthKey: activeProjectKey,
      };
    });
  }, [setup.activeTailscaleAuthKey]);

  if (setup.projectQuery.isPending) {
    return <div className="text-muted-foreground">Loading…</div>;
  }
  if (setup.projectQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {String(setup.projectQuery.error)}
      </div>
    );
  }
  if (!projectId) {
    return <div className="text-muted-foreground">Project not found.</div>;
  }

  const selectedHost = setup.model.selectedHost;
  const activeHost = selectedHost ?? host;
  const hostCfg =
    (setup.config?.hosts?.[activeHost] as { theme?: HostTheme } | undefined) ??
    null;
  const selectedHostTheme: HostTheme | null = hostCfg?.theme ?? null;

  const stepper = deriveHostSetupStepper({
    steps: setup.model.steps,
    activeStepId: setup.model.activeStepId,
  });
  const stepperSteps = stepper.steps;
  const stepperActiveStepId = stepper.activeStepId;
  const requiredSteps = stepperSteps.filter((s) => !s.optional);
  const requiredDone = requiredSteps.filter((s) => s.status === "done").length;
  const sectionRefs = React.useRef<
    Partial<Record<SetupStepId, HTMLElement | null>>
  >({});
  const [visibleStepId, setVisibleStepId] =
    React.useState<SetupStepId>(stepperActiveStepId);
  const stepSignature = React.useMemo(
    () => stepperSteps.map((step) => `${step.id}:${step.status}`).join("|"),
    [stepperSteps],
  );

  React.useEffect(() => {
    setVisibleStepId(stepperActiveStepId);
  }, [stepperActiveStepId]);

  const scrollToStep = React.useCallback((stepId: SetupStepId) => {
    const section = sectionRefs.current[stepId];
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  React.useEffect(() => {
    const sections = stepperSteps
      .map((step) => sectionRefs.current[step.id as SetupStepId])
      .filter((node): node is HTMLElement => Boolean(node));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting);
        if (visibleEntries.length === 0) return;
        visibleEntries.sort((a, b) => {
          if (b.intersectionRatio !== a.intersectionRatio)
            return b.intersectionRatio - a.intersectionRatio;
          return (
            Math.abs(a.boundingClientRect.top) -
            Math.abs(b.boundingClientRect.top)
          );
        });
        const stepId = coerceSetupStepId(
          (visibleEntries[0].target as HTMLElement).dataset.stepId,
        );
        if (!stepId) return;
        setVisibleStepId((prev) => (prev === stepId ? prev : stepId));
      },
      {
        threshold: [0.2, 0.35, 0.5, 0.75],
        rootMargin: "-12% 0px -58% 0px",
      },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [stepSignature, stepperSteps]);

  const continueFromStep = React.useCallback(
    (from: SetupStepId) => {
      const currentIndex = SETUP_STEP_IDS.findIndex(
        (stepId) => stepId === from,
      );
      const next =
        currentIndex === -1 ? null : SETUP_STEP_IDS[currentIndex + 1];
      if (!next) return;
      setVisibleStepId(next);
      setup.setStep(next);
      scrollToStep(next);
    },
    [scrollToStep, setup],
  );

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
        value={visibleStepId}
        onValueChange={(value) => {
          const stepId = coerceSetupStepId(value);
          if (!stepId) return;
          const step = stepperSteps.find((s) => s.id === stepId);
          if (!step || step.status === "locked") return;
          setVisibleStepId(stepId);
          setup.setStep(stepId);
          scrollToStep(stepId);
        }}
        orientation="vertical"
        activationMode="manual"
        className="xl:grid xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start xl:gap-8"
      >
        <div className="xl:sticky xl:top-16 xl:self-start">
          <StepperList className="xl:w-[280px] xl:shrink-0">
            {stepperSteps.map((step, stepIndex) => (
              <StepperItem
                key={step.id}
                value={step.id}
                completed={isStepCompleted(step.status)}
                disabled={step.status === "locked"}
              >
                <StepperTrigger className="not-last:pb-6">
                  <StepperIndicator>
                    {(state) =>
                      state === "completed" ? (
                        <CheckIcon aria-hidden className="size-4" />
                      ) : (
                        String(stepIndex + 1)
                      )
                    }
                  </StepperIndicator>
                  <div className="flex flex-col gap-1">
                    <StepperTitle>{stepMeta(step.id).title}</StepperTitle>
                    <StepperDescription>
                      {stepMeta(step.id).description}
                    </StepperDescription>
                  </div>
                </StepperTrigger>
                <StepperSeparator className="pointer-events-none absolute inset-y-0 top-5 left-4 z-0 -order-1 h-full -translate-x-1/2" />
              </StepperItem>
            ))}
          </StepperList>
        </div>

        <div className="space-y-4 xl:min-w-0 xl:flex-1">
          {stepperSteps.map((step) => (
            <StepperContent key={step.id} value={step.id} forceMount>
              <section
                id={`setup-step-${step.id}`}
                data-step-id={step.id}
                ref={(node) => {
                  sectionRefs.current[step.id as SetupStepId] = node;
                }}
                className="scroll-mt-20"
              >
                <StepContent
                  stepId={step.id as SetupStepId}
                  step={step}
                  projectId={projectId as Id<"projects">}
                  projectSlug={projectSlug}
                  host={activeHost}
                  setup={setup}
                  pendingInfrastructureDraft={pendingInfrastructureDraft}
                  pendingConnectionDraft={pendingConnectionDraft}
                  pendingBootstrapSecrets={pendingBootstrapSecrets}
                  hasActiveHcloudToken={setup.hasActiveHcloudToken}
                  hasActiveTailscaleAuthKey={setup.hasActiveTailscaleAuthKey}
                  hasProjectSopsAgeKeyPath={setup.hasProjectSopsAgeKeyPath}
                  activeTailscaleAuthKey={setup.activeTailscaleAuthKey}
                  onPendingInfrastructureDraftChange={(next) => {
                    setPendingInfrastructureDraft((prev) => ({
                      ...(prev ?? {}),
                      ...next,
                    }));
                  }}
                  onPendingConnectionDraftChange={setPendingConnectionDraft}
                  onPendingBootstrapSecretsChange={(next) => {
                    setPendingBootstrapSecrets((prev) => ({
                      ...prev,
                      ...next,
                    }));
                  }}
                  onContinueFromStep={continueFromStep}
                />
              </section>
            </StepperContent>
          ))}
        </div>
      </Stepper>
    </div>
  );
}

function StepContent(props: {
  stepId: SetupStepId;
  step: { id: string; status: SetupStepStatus };
  projectId: Id<"projects">;
  projectSlug: string;
  host: string;
  setup: ReturnType<typeof useSetupModel>;
  pendingInfrastructureDraft: SetupDraftInfrastructure | null;
  pendingConnectionDraft: SetupDraftConnection | null;
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets;
  hasActiveHcloudToken: boolean;
  hasActiveTailscaleAuthKey: boolean;
  hasProjectSopsAgeKeyPath: boolean;
  activeTailscaleAuthKey: string;
  onPendingInfrastructureDraftChange: (next: SetupDraftInfrastructure) => void;
  onPendingConnectionDraftChange: (next: SetupDraftConnection) => void;
  onPendingBootstrapSecretsChange: (
    next: Partial<SetupPendingBootstrapSecrets>,
  ) => void;
  onContinueFromStep: (stepId: SetupStepId) => void;
}) {
  const {
    stepId,
    step,
    projectId,
    projectSlug,
    host,
    setup,
    pendingInfrastructureDraft,
    pendingConnectionDraft,
    pendingBootstrapSecrets,
    hasActiveHcloudToken,
    hasActiveTailscaleAuthKey,
    hasProjectSopsAgeKeyPath,
    activeTailscaleAuthKey,
  } = props;
  const desired = React.useMemo(
    () =>
      deriveEffectiveSetupDesiredState({
        config: setup.config,
        host,
        setupDraft: setup.setupDraft,
        pendingNonSecretDraft: {
          infrastructure: pendingInfrastructureDraft ?? undefined,
          connection: pendingConnectionDraft ?? undefined,
        },
      }),
    [
      host,
      pendingConnectionDraft,
      pendingInfrastructureDraft,
      setup.config,
      setup.setupDraft,
    ],
  );

  if (stepId === "infrastructure") {
    return (
      <SetupStepInfrastructure
        key={`${host}:${setup.config ? "ready" : "loading"}`}
        projectId={projectId}
        config={setup.config}
        setupDraft={setup.setupDraft}
        host={host}
        hasActiveHcloudToken={hasActiveHcloudToken}
        stepStatus={step.status}
        onDraftChange={props.onPendingInfrastructureDraftChange}
      />
    );
  }

  if (stepId === "connection") {
    return (
      <SetupStepConnection
        projectId={projectId}
        config={setup.config}
        setupDraft={setup.setupDraft}
        host={host}
        stepStatus={step.status}
        sopsAgeKeyPathReady={hasProjectSopsAgeKeyPath}
        onDraftChange={props.onPendingConnectionDraftChange}
        adminPassword={pendingBootstrapSecrets.adminPassword}
        onAdminPasswordChange={(value) =>
          props.onPendingBootstrapSecretsChange({ adminPassword: value })
        }
      />
    );
  }

  if (stepId === "tailscale-lockdown") {
    return (
      <SetupStepTailscaleLockdown
        projectId={projectId}
        stepStatus={step.status}
        tailscaleAuthKey={pendingBootstrapSecrets.tailscaleAuthKey}
        hasTailscaleAuthKey={hasActiveTailscaleAuthKey}
        allowTailscaleUdpIngress={desired.infrastructure.allowTailscaleUdpIngress}
        useTailscaleLockdown={pendingBootstrapSecrets.useTailscaleLockdown}
        onTailscaleAuthKeyChange={(value) =>
          props.onPendingBootstrapSecretsChange({ tailscaleAuthKey: value })
        }
        onAllowTailscaleUdpIngressChange={(value) =>
          props.onPendingInfrastructureDraftChange({
            allowTailscaleUdpIngress: value,
          })
        }
        onUseTailscaleLockdownChange={(value) => {
          props.onPendingBootstrapSecretsChange({ useTailscaleLockdown: value });
          if (value) {
            props.onPendingInfrastructureDraftChange({
              allowTailscaleUdpIngress: true,
            });
          }
        }}
      />
    );
  }

  if (stepId === "deploy") {
    return (
      <SetupStepDeploy
        projectSlug={projectSlug}
        host={host}
        hasBootstrapped={setup.model.hasBootstrapped}
        onContinue={() => props.onContinueFromStep(stepId)}
        stepStatus={step.status}
        setupDraft={setup.setupDraft}
        pendingInfrastructureDraft={pendingInfrastructureDraft}
        pendingConnectionDraft={pendingConnectionDraft}
        pendingBootstrapSecrets={pendingBootstrapSecrets}
        hasActiveTailscaleAuthKey={hasActiveTailscaleAuthKey}
        activeTailscaleAuthKey={activeTailscaleAuthKey}
      />
    );
  }

  if (stepId === "verify") {
    return (
      <SetupStepVerify
        projectSlug={projectSlug}
        projectId={projectId}
        host={host}
        config={setup.config}
        stepStatus={step.status}
      />
    );
  }

  return null;
}
