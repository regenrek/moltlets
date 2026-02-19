import { DeployInitialInstall } from "~/components/deploy/deploy-initial"
import type { SetupStepStatus } from "~/lib/setup/setup-model"
import type { SetupDraftConnection, SetupDraftInfrastructure, SetupDraftView } from "~/sdk/setup"

type SetupPendingBootstrapSecrets = {
  adminPassword: string
  useTailscaleLockdown: boolean
}

export function SetupStepDeploy(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  stepStatus: SetupStepStatus
  setupDraft: SetupDraftView | null
  pendingInfrastructureDraft: SetupDraftInfrastructure | null
  pendingConnectionDraft: SetupDraftConnection | null
  pendingBootstrapSecrets: SetupPendingBootstrapSecrets
  hasProjectGithubToken: boolean
  hasActiveTailscaleAuthKey: boolean
}) {
  return (
    <DeployInitialInstall
      projectSlug={props.projectSlug}
      host={props.host}
      variant="setup"
      hasBootstrapped={props.hasBootstrapped}
      setupDraft={props.setupDraft}
      pendingInfrastructureDraft={props.pendingInfrastructureDraft}
      pendingConnectionDraft={props.pendingConnectionDraft}
      pendingBootstrapSecrets={props.pendingBootstrapSecrets}
      hasProjectGithubToken={props.hasProjectGithubToken}
      hasActiveTailscaleAuthKey={props.hasActiveTailscaleAuthKey}
      showRunnerStatusBanner={false}
    />
  )
}
