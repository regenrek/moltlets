import { DeployInitialInstall } from "~/components/deploy/deploy-initial"

export function SetupStepDeploy(props: {
  projectSlug: string
  host: string
  hasBootstrapped: boolean
  onContinue: () => void
}) {
  return (
    <DeployInitialInstall
      projectSlug={props.projectSlug}
      host={props.host}
      variant="setup"
      hasBootstrapped={props.hasBootstrapped}
      onBootstrapped={props.onContinue}
    />
  )
}
