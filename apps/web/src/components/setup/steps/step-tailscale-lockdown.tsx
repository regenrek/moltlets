import type { Id } from "../../../../convex/_generated/dataModel"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "~/components/ui/accordion"
import { ProjectTokenKeyringCard } from "~/components/setup/project-token-keyring-card"
import { LabelWithHelp } from "~/components/ui/label-help"
import { SettingsSection } from "~/components/ui/settings-section"
import { SetupSaveStateBadge } from "~/components/setup/steps/setup-save-state-badge"
import { Switch } from "~/components/ui/switch"
import { setupFieldHelp } from "~/lib/setup-field-help"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type { SetupDraftView } from "~/sdk/setup"

type TailscaleKeyringSummary = {
  hasActive: boolean
  itemCount: number
  items?: Array<{
    id: string
    label: string
    maskedValue: string
    isActive: boolean
  }>
}

export function SetupStepTailscaleLockdown(props: {
  projectId: Id<"projects">
  projectSlug: string
  stepStatus: SetupStepStatus
  setupDraft: SetupDraftView | null
  tailscaleKeyringSummary?: TailscaleKeyringSummary | null
  hasTailscaleAuthKey: boolean
  allowTailscaleUdpIngress: boolean
  useTailscaleLockdown: boolean
  onAllowTailscaleUdpIngressChange: (value: boolean) => void
  onUseTailscaleLockdownChange: (value: boolean) => void
  onProjectCredsQueued?: () => void
}) {
  const statusText = !props.useTailscaleLockdown
    ? "Disabled. Deploy keeps bootstrap SSH access until you run lockdown manually."
    : props.hasTailscaleAuthKey
      ? "Ready. Deploy will switch SSH access to tailnet and queue lockdown automatically."
      : "Missing active project Tailscale auth key."
  const saveState = props.setupDraft?.status === "failed"
    ? "error"
    : !props.useTailscaleLockdown || props.hasTailscaleAuthKey
      ? "saved"
      : "not_saved"

  return (
    <SettingsSection
      title="Tailscale lockdown"
      description="Prepare automatic post-bootstrap SSH lockdown via Tailscale."
      headerBadge={<SetupSaveStateBadge state={saveState} />}
      statusText={statusText}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Use tailscale + lockdown (recommended)</div>
            <div className="text-xs text-muted-foreground">
              Deploy sets tailnet mode, then switches SSH exposure to tailnet and runs lockdown.
            </div>
          </div>
          <Switch
            checked={props.useTailscaleLockdown}
            onCheckedChange={props.onUseTailscaleLockdownChange}
          />
        </div>
        {props.useTailscaleLockdown ? (
        <ProjectTokenKeyringCard
            projectId={props.projectId}
            kind="tailscale"
            setupHref={`/${props.projectSlug}/runner`}
            title="Tailscale API keys"
            description="Project-wide keyring. Add multiple keys and select the active one used during setup/deploy."
            runnerStatusMode="none"
            wrapInSection={false}
            showRunnerStatusBanner={false}
            showRunnerStatusDetails={false}
            statusSummary={{
              hasActive: props.tailscaleKeyringSummary?.hasActive === true,
              itemCount: Number(props.tailscaleKeyringSummary?.itemCount || 0),
              items: props.tailscaleKeyringSummary?.items ?? [],
            }}
            onQueued={props.onProjectCredsQueued}
          />
        ) : null}

        <Accordion className="rounded-lg border bg-muted/20">
          <AccordionItem value="advanced" className="px-4">
            <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 hover:no-underline">
              Advanced options
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="space-y-2 rounded-md border bg-muted/10 p-3">
                <LabelWithHelp
                  htmlFor="setup-tailscale-udp-ingress"
                  help={setupFieldHelp.hosts.hetznerAllowTailscaleUdpIngress}
                >
                  Allow Tailscale UDP ingress
                </LabelWithHelp>
                <div className="mt-1 flex items-center gap-3">
                  <Switch
                    id="setup-tailscale-udp-ingress"
                    checked={props.allowTailscaleUdpIngress}
                    onCheckedChange={props.onAllowTailscaleUdpIngressChange}
                  />
                  <span className="text-sm text-muted-foreground">
                    Default: enabled. Disable for relay-only mode.
                  </span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </SettingsSection>
  )
}
