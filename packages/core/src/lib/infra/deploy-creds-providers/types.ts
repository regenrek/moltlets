export type DeployCredsKeySpec<K extends string = string> = {
  key: K;
  secret: boolean;
  defaultValue: string;
};

export function defineDeployCredsKeySpecs<const T extends readonly DeployCredsKeySpec[]>(specs: T): T {
  return specs;
}
