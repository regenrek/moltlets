"use client";

import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import * as React from "react";
import { CheckIcon } from "@heroicons/react/24/solid";
import type { HostTheme } from "@clawlets/core/lib/host/host-theme";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";
import { RunnerStatusBanner } from "~/components/fleet/runner-status-banner";
import { SetupHeader } from "~/components/setup/setup-header";
import { SetupStepConnection } from "~/components/setup/steps/step-connection";
import { SetupStepCreds } from "~/components/setup/steps/step-creds";
import { SetupStepDeploy } from "~/components/setup/steps/step-deploy";
import { SetupStepInfrastructure } from "~/components/setup/steps/step-infrastructure";
import { SetupStepTailscaleLockdown } from "~/components/setup/steps/step-tailscale-lockdown";
import { LabelWithHelp } from "~/components/ui/label-help";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
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
import { singleHostCidrFromIp } from "~/lib/ip-utils";
import { projectsListQueryOptions } from "~/lib/query-options";
import { slugifyProjectName } from "~/lib/project-routing";
import { deriveEffectiveSetupDesiredState } from "~/lib/setup/desired-state";
import type { SetupStepId, SetupStepStatus } from "~/lib/setup/setup-model";
import {
  coerceSetupStepId,
  deriveHostSetupStepper,
} from "~/lib/setup/setup-model";
import { useSetupModel } from "~/lib/setup/use-setup-model";
import type {
  SetupDraftConnection,
  SetupDraftInfrastructure,
  SetupDraftNonSecretPatch,
} from "~/sdk/setup";
import { setupDraftSaveNonSecret } from "~/sdk/setup";

export const Route = createFileRoute("/$projectSlug/hosts/$host/setup")({
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
  creds: {
    title: "GitHub token",
    description: "Repo access and first push checks",
  },
  deploy: { title: "Install Server", description: "Final check and bootstrap" },
};

function stepMeta(id: string) {
  return STEP_META[id] ?? { title: id, description: "" };
}

function isStepCompleted(status: SetupStepStatus) {
  return status === "done";
}

type SetupPendingBootstrapSecrets = {
  adminPassword: string;
  useTailscaleLockdown: boolean;
};

type ProjectAdminCidrStatus = "idle" | "detecting" | "ready" | "error";

const NON_SECRET_AUTOSAVE_DEBOUNCE_MS = 500;

function readAdminCidr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSshAuthorizedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((row) => (typeof row === "string" ? row.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function normalizeNonSecretPatch(
  patch: SetupDraftNonSecretPatch | null | undefined,
): SetupDraftNonSecretPatch | null {
  const source = patch ?? {};
  const infrastructure = source.infrastructure
    ? {
        serverType: typeof source.infrastructure.serverType === "string"
          ? source.infrastructure.serverType.trim()
          : undefined,
        image: typeof source.infrastructure.image === "string"
          ? source.infrastructure.image.trim()
          : undefined,
        location: typeof source.infrastructure.location === "string"
          ? source.infrastructure.location.trim()
          : undefined,
        allowTailscaleUdpIngress:
          typeof source.infrastructure.allowTailscaleUdpIngress === "boolean"
            ? source.infrastructure.allowTailscaleUdpIngress
            : undefined,
        volumeEnabled:
          typeof source.infrastructure.volumeEnabled === "boolean"
            ? source.infrastructure.volumeEnabled
            : undefined,
        volumeSizeGb:
          typeof source.infrastructure.volumeSizeGb === "number"
            && Number.isFinite(source.infrastructure.volumeSizeGb)
            ? Math.max(0, Math.trunc(source.infrastructure.volumeSizeGb))
            : undefined,
      }
    : undefined;

  const connection = source.connection
    ? (() => {
        const hasSshKeys = Array.isArray(source.connection?.sshAuthorizedKeys);
        const normalizedSshKeys = normalizeSshAuthorizedKeys(
          source.connection?.sshAuthorizedKeys,
        );
        return {
          adminCidr: typeof source.connection.adminCidr === "string"
            ? source.connection.adminCidr.trim()
            : undefined,
          sshExposureMode:
            source.connection.sshExposureMode === "bootstrap"
            || source.connection.sshExposureMode === "tailnet"
            || source.connection.sshExposureMode === "public"
              ? source.connection.sshExposureMode
              : undefined,
          sshAuthorizedKeys: hasSshKeys ? normalizedSshKeys : undefined,
          sshKeyCount: hasSshKeys
            ? normalizedSshKeys.length
            : typeof source.connection.sshKeyCount === "number"
              && Number.isFinite(source.connection.sshKeyCount)
              ? Math.max(0, Math.trunc(source.connection.sshKeyCount))
              : undefined,
        };
      })()
    : undefined;

  if (!infrastructure && !connection) return null;
  return {
    ...(infrastructure ? { infrastructure } : {}),
    ...(connection ? { connection } : {}),
  };
}

function nonSecretPatchFingerprint(
  patch: SetupDraftNonSecretPatch | null | undefined,
): string {
  const normalized = normalizeNonSecretPatch(patch);
  if (!normalized) return "";

  const infrastructure = normalized.infrastructure
    ? {
        serverType: normalized.infrastructure.serverType || "",
        image: normalized.infrastructure.image || "",
        location: normalized.infrastructure.location || "",
        allowTailscaleUdpIngress:
          typeof normalized.infrastructure.allowTailscaleUdpIngress === "boolean"
            ? normalized.infrastructure.allowTailscaleUdpIngress
            : null,
        volumeEnabled:
          typeof normalized.infrastructure.volumeEnabled === "boolean"
            ? normalized.infrastructure.volumeEnabled
            : null,
        volumeSizeGb:
          typeof normalized.infrastructure.volumeSizeGb === "number"
            ? Math.max(0, Math.trunc(normalized.infrastructure.volumeSizeGb))
            : null,
      }
    : null;

  const connection = normalized.connection
    ? {
        adminCidr: normalized.connection.adminCidr || "",
        sshExposureMode: normalized.connection.sshExposureMode || "",
        sshAuthorizedKeys: normalizeSshAuthorizedKeys(
          normalized.connection.sshAuthorizedKeys,
        ),
        sshKeyCount:
          typeof normalized.connection.sshKeyCount === "number"
            ? Math.max(0, Math.trunc(normalized.connection.sshKeyCount))
            : null,
      }
    : null;

  return JSON.stringify({ infrastructure, connection });
}

function HostSetupPage() {
  const { projectSlug, host } = Route.useParams();
  const [pendingInfrastructureDraft, setPendingInfrastructureDraft] =
    React.useState<SetupDraftInfrastructure | null>(null);
  const [pendingConnectionDraft, setPendingConnectionDraft] =
    React.useState<SetupDraftConnection | null>(null);
  const [pendingBootstrapSecrets, setPendingBootstrapSecrets] =
    React.useState<SetupPendingBootstrapSecrets>({
      adminPassword: "",
      useTailscaleLockdown: true,
    });
  const [projectAdminCidr, setProjectAdminCidr] = React.useState("");
  const [projectAdminCidrStatus, setProjectAdminCidrStatus] =
    React.useState<ProjectAdminCidrStatus>("idle");
  const [projectAdminCidrError, setProjectAdminCidrError] = React.useState<
    string | null
  >(null);
  const projectAdminCidrAutoDetectAttemptedRef = React.useRef(false);
  const updatePendingInfrastructureDraft = React.useCallback(
    (next: SetupDraftInfrastructure) => {
      setPendingInfrastructureDraft((prev) => {
        const merged = {
          ...(prev ?? {}),
          ...next,
        };
        const prevFingerprint = nonSecretPatchFingerprint({
          infrastructure: prev ?? undefined,
        });
        const mergedFingerprint = nonSecretPatchFingerprint({
          infrastructure: merged,
        });
        return prevFingerprint === mergedFingerprint ? prev : merged;
      });
    },
    [],
  );
  const updatePendingConnectionDraft = React.useCallback(
    (next: SetupDraftConnection) => {
      const normalizedNext =
        normalizeNonSecretPatch({ connection: next })?.connection ?? next;
      setPendingConnectionDraft((prev) => {
        const merged = {
          ...(prev ?? {}),
          ...(normalizedNext ?? {}),
        };
        const prevFingerprint = nonSecretPatchFingerprint({
          connection: prev ?? undefined,
        });
        const mergedFingerprint = nonSecretPatchFingerprint({
          connection: merged,
        });
        return prevFingerprint === mergedFingerprint ? prev : merged;
      });
    },
    [],
  );

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
    pendingNonSecretDraft,
    pendingBootstrapSecrets: {
      useTailscaleLockdown: pendingBootstrapSecrets.useTailscaleLockdown,
    },
  });
  const projectId = setup.projectId;

  React.useEffect(() => {
    setPendingInfrastructureDraft(null);
    setPendingConnectionDraft(null);
    setPendingBootstrapSecrets({
      adminPassword: "",
      useTailscaleLockdown: true,
    });
  }, [host]);

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
  const queryClient = useQueryClient();
  const activeHostConfig = setup.config?.hosts?.[activeHost] as
    | { provisioning?: { adminCidr?: string } }
    | undefined;
  const hostCfg =
    (setup.config?.hosts?.[activeHost] as { theme?: HostTheme } | undefined) ??
    null;
  const selectedHostTheme: HostTheme | null = hostCfg?.theme ?? null;
  const pendingNonSecretPatch = React.useMemo(
    () =>
      normalizeNonSecretPatch({
        infrastructure: pendingInfrastructureDraft ?? undefined,
        connection: pendingConnectionDraft ?? undefined,
      }),
    [pendingConnectionDraft, pendingInfrastructureDraft],
  );
  const pendingNonSecretPatchFingerprint = React.useMemo(
    () => nonSecretPatchFingerprint(pendingNonSecretPatch),
    [pendingNonSecretPatch],
  );
  const persistedNonSecretPatchFingerprint = React.useMemo(
    () => nonSecretPatchFingerprint(setup.setupDraft?.nonSecretDraft),
    [setup.setupDraft?.nonSecretDraft],
  );
  const autosaveDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastQueuedFingerprintRef = React.useRef("");
  const lastSavedFingerprintRef = React.useRef("");

  const saveNonSecretDraftMutation = useMutation({
    mutationFn: async (patch: SetupDraftNonSecretPatch) =>
      await setupDraftSaveNonSecret({
        data: {
          projectId: projectId as Id<"projects">,
          host: activeHost,
          patch,
        },
      }),
    onSuccess: (draft, patch) => {
      const fingerprint = nonSecretPatchFingerprint(patch);
      if (fingerprint) {
        lastSavedFingerprintRef.current = fingerprint;
      }
      lastQueuedFingerprintRef.current = "";
      queryClient.setQueryData(["setupDraft", projectId, host], draft);
    },
    onError: () => {
      lastQueuedFingerprintRef.current = "";
    },
  });
  const saveNonSecretDraftPending = saveNonSecretDraftMutation.isPending;
  const saveNonSecretDraftMutate = saveNonSecretDraftMutation.mutate;

  React.useEffect(() => {
    if (persistedNonSecretPatchFingerprint) {
      lastSavedFingerprintRef.current = persistedNonSecretPatchFingerprint;
    }
  }, [persistedNonSecretPatchFingerprint]);

  React.useEffect(() => {
    lastQueuedFingerprintRef.current = "";
    lastSavedFingerprintRef.current = persistedNonSecretPatchFingerprint || "";
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }
  }, [activeHost, persistedNonSecretPatchFingerprint, projectId]);

  React.useEffect(() => {
    if (!pendingNonSecretPatch) return;
    if (!pendingNonSecretPatchFingerprint) return;
    if (saveNonSecretDraftPending) return;
    if (pendingNonSecretPatchFingerprint === lastSavedFingerprintRef.current) {
      return;
    }
    if (pendingNonSecretPatchFingerprint === lastQueuedFingerprintRef.current) {
      return;
    }

    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
    }
    autosaveDebounceRef.current = setTimeout(() => {
      lastQueuedFingerprintRef.current = pendingNonSecretPatchFingerprint;
      saveNonSecretDraftMutate(pendingNonSecretPatch);
    }, NON_SECRET_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
        autosaveDebounceRef.current = null;
      }
    };
  }, [
    pendingNonSecretPatch,
    pendingNonSecretPatchFingerprint,
    saveNonSecretDraftMutate,
    saveNonSecretDraftPending,
  ]);

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

  const detectProjectAdminCidr = React.useCallback(async () => {
    if (projectAdminCidrStatus === "detecting") return;
    setProjectAdminCidrStatus("detecting");
    setProjectAdminCidrError(null);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6_000);
    try {
      const res = await fetch("https://api.ipify.org?format=json", {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ip lookup failed (${res.status})`);
      const json = (await res.json()) as { ip?: unknown };
      const ip = typeof json.ip === "string" ? json.ip : "";
      const cidr = singleHostCidrFromIp(ip);
      if (!cidr) throw new Error("invalid public IP response");
      setProjectAdminCidr(cidr);
      setProjectAdminCidrStatus("ready");
      setProjectAdminCidrError(null);
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "CIDR detection timed out"
          : error instanceof Error
            ? error.message
            : String(error);
      setProjectAdminCidrStatus("error");
      setProjectAdminCidrError(message);
    } finally {
      clearTimeout(timeout);
      ctrl.abort();
    }
  }, [projectAdminCidrStatus]);

  React.useEffect(() => {
    const pendingAdminCidr = readAdminCidr(pendingConnectionDraft?.adminCidr);
    if (pendingAdminCidr) return;
    const draftAdminCidr = readAdminCidr(
      setup.setupDraft?.nonSecretDraft?.connection?.adminCidr,
    );
    if (draftAdminCidr) return;
    const configAdminCidr = readAdminCidr(activeHostConfig?.provisioning?.adminCidr);
    if (configAdminCidr) return;
    const sessionAdminCidr = readAdminCidr(projectAdminCidr);
    if (sessionAdminCidr) {
      setPendingConnectionDraft((prev) => {
        if (readAdminCidr(prev?.adminCidr)) return prev;
        return {
          ...(prev ?? {}),
          adminCidr: sessionAdminCidr,
        };
      });
      return;
    }
    if (projectAdminCidrAutoDetectAttemptedRef.current) return;
    projectAdminCidrAutoDetectAttemptedRef.current = true;
    void detectProjectAdminCidr();
  }, [
    activeHostConfig?.provisioning?.adminCidr,
    detectProjectAdminCidr,
    pendingConnectionDraft?.adminCidr,
    projectAdminCidr,
    setup.setupDraft?.nonSecretDraft?.connection?.adminCidr,
  ]);

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

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 xl:max-w-6xl">
      <RunnerStatusBanner
        projectId={projectId as Id<"projects">}
        setupHref={`/${projectSlug}/runner`}
        runnerOnline={setup.runnerOnline}
        isChecking={setup.runnersQuery.isPending}
      />

      {setup.sealedRunners.length > 1 ? (
        <div className="rounded-lg border bg-muted/20 px-4 py-3">
          <div className="space-y-2">
            <LabelWithHelp
              htmlFor="setupTargetRunner"
              help="Project credentials are runner-local. When multiple runners are online, choose the runner that owns your credentials."
            >
              Target runner
            </LabelWithHelp>
            <NativeSelect
              id="setupTargetRunner"
              value={setup.selectedRunnerId}
              onChange={(event) => setup.setSelectedRunnerId(event.target.value)}
            >
              <NativeSelectOption value="">Select runner...</NativeSelectOption>
              {setup.sealedRunners.map((runner) => (
                <NativeSelectOption key={runner._id} value={String(runner._id)}>
                  {runner.runnerName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      ) : null}

      <SetupHeader
        title="Setup your first host"
        description="Runner setup is complete. Configure this first host so deploy and runtime operations can proceed for this project."
        selectedHost={activeHost}
        selectedHostTheme={selectedHostTheme}
        requiredDone={requiredDone}
        requiredTotal={requiredSteps.length}
      />

      <Stepper
        value={visibleStepId}
        onValueChange={(value) => {
          const stepId = coerceSetupStepId(value);
          if (!stepId) return;
          const step = stepperSteps.find((s) => s.id === stepId);
          if (!step || step.status === "locked") return;
          setVisibleStepId(stepId);
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
                  isVisible={
                    visibleStepId === step.id || stepperActiveStepId === step.id
                  }
                  step={step}
                  projectId={projectId as Id<"projects">}
                  projectSlug={projectSlug}
                  host={activeHost}
                  setup={setup}
                  pendingInfrastructureDraft={pendingInfrastructureDraft}
                  pendingConnectionDraft={pendingConnectionDraft}
                  pendingBootstrapSecrets={pendingBootstrapSecrets}
                  projectAdminCidr={projectAdminCidr}
                  projectAdminCidrStatus={projectAdminCidrStatus}
                  projectAdminCidrError={projectAdminCidrError}
                  hasActiveHcloudToken={setup.hasActiveHcloudToken}
                  hasProjectGithubToken={setup.hasProjectGithubToken}
                  hasActiveTailscaleAuthKey={setup.hasActiveTailscaleAuthKey}
                  tailscaleKeyringSummary={setup.deployCredsSummary?.projectTokenKeyrings?.tailscale ?? null}
                  onPendingInfrastructureDraftChange={
                    updatePendingInfrastructureDraft
                  }
                  onPendingConnectionDraftChange={updatePendingConnectionDraft}
                  onPendingBootstrapSecretsChange={(next) => {
                    setPendingBootstrapSecrets((prev) => ({
                      ...prev,
                      ...next,
                    }));
                  }}
                  onDetectProjectAdminCidr={detectProjectAdminCidr}
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
  isVisible: boolean;
  step: { id: string; status: SetupStepStatus };
  projectId: Id<"projects">;
  projectSlug: string;
  host: string;
  setup: ReturnType<typeof useSetupModel>;
  pendingInfrastructureDraft: SetupDraftInfrastructure | null;
  pendingConnectionDraft: SetupDraftConnection | null;
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets;
  projectAdminCidr: string;
  projectAdminCidrStatus: ProjectAdminCidrStatus;
  projectAdminCidrError: string | null;
  hasActiveHcloudToken: boolean;
  hasProjectGithubToken: boolean;
  hasActiveTailscaleAuthKey: boolean;
  tailscaleKeyringSummary: {
    hasActive: boolean;
    itemCount: number;
  } | null;
  onPendingInfrastructureDraftChange: (next: SetupDraftInfrastructure) => void;
  onPendingConnectionDraftChange: (next: SetupDraftConnection) => void;
  onPendingBootstrapSecretsChange: (
    next: Partial<SetupPendingBootstrapSecrets>,
  ) => void;
  onDetectProjectAdminCidr: () => Promise<void>;
}) {
  const {
    stepId,
    isVisible,
    step,
    projectId,
    projectSlug,
    host,
    setup,
    pendingInfrastructureDraft,
    pendingConnectionDraft,
    pendingBootstrapSecrets,
    projectAdminCidr,
    projectAdminCidrStatus,
    projectAdminCidrError,
    hasActiveHcloudToken,
    hasProjectGithubToken,
    hasActiveTailscaleAuthKey,
    tailscaleKeyringSummary,
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
        projectSlug={projectSlug}
        config={setup.config}
        setupDraft={setup.setupDraft}
        host={host}
        hasActiveHcloudToken={hasActiveHcloudToken}
        hcloudKeyringSummary={
          setup.deployCredsSummary?.projectTokenKeyrings?.hcloud ?? null
        }
        stepStatus={step.status}
        onDraftChange={props.onPendingInfrastructureDraftChange}
        onProjectCredsQueued={setup.refreshDeployCredsStatus}
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
        onDraftChange={props.onPendingConnectionDraftChange}
        adminPassword={pendingBootstrapSecrets.adminPassword}
        projectAdminCidr={projectAdminCidr}
        projectAdminCidrError={projectAdminCidrError}
        adminCidrDetecting={projectAdminCidrStatus === "detecting"}
        onDetectAdminCidr={() => {
          void props.onDetectProjectAdminCidr();
        }}
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
        projectSlug={projectSlug}
        stepStatus={step.status}
        setupDraft={setup.setupDraft}
        tailscaleKeyringSummary={tailscaleKeyringSummary}
        hasTailscaleAuthKey={hasActiveTailscaleAuthKey}
        allowTailscaleUdpIngress={desired.infrastructure.allowTailscaleUdpIngress}
        useTailscaleLockdown={pendingBootstrapSecrets.useTailscaleLockdown}
        onProjectCredsQueued={setup.refreshDeployCredsStatus}
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

  if (stepId === "creds") {
    return (
      <SetupStepCreds
        projectId={projectId}
        projectSlug={projectSlug}
        projectRunnerRepoPath={setup.projectQuery.project?.runnerRepoPath ?? null}
        hasProjectGithubToken={hasProjectGithubToken}
        stepStatus={step.status}
        isVisible={isVisible}
        onProjectCredsQueued={setup.refreshDeployCredsStatus}
      />
    );
  }

  if (stepId === "deploy") {
    return (
      <SetupStepDeploy
        projectSlug={projectSlug}
        host={host}
        hasBootstrapped={setup.model.hasBootstrapped}
        stepStatus={step.status}
        setupDraft={setup.setupDraft}
        pendingInfrastructureDraft={pendingInfrastructureDraft}
        pendingConnectionDraft={pendingConnectionDraft}
        pendingBootstrapSecrets={pendingBootstrapSecrets}
        hasProjectGithubToken={hasProjectGithubToken}
        hasActiveTailscaleAuthKey={hasActiveTailscaleAuthKey}
      />
    );
  }

  return null;
}
