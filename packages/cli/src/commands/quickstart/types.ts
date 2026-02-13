export type InstallNixMode = "auto" | "always" | "never";
export type UiMode = "dev" | "prod" | "none";
export type NixResultStatus = "already_installed" | "installed";
export type ConvexResultStatus = "configured" | "skipped";
export type UiResultStatus = "started" | "skipped";

export type QuickstartSummary = {
  ok: true;
  repoRoot: string;
  platform: string;
  nodeVersion: string;
  nix: {
    status: NixResultStatus;
    nixBin: string;
    nixVersion?: string;
  };
  convex: {
    status: ConvexResultStatus;
    convexDir: string;
    envFile?: string;
    deployment?: string;
    convexUrl?: string;
    convexSiteUrl?: string;
    siteUrl?: string;
  };
  ui: {
    status: UiResultStatus;
    mode: UiMode;
    url?: string;
    port?: number;
  };
};

export type NixEnsureResult = {
  status: NixResultStatus;
  nixBin: string;
  version: string;
};

export type ConvexBootstrapResult = {
  convexDir: string;
  envFilePath: string;
  deployment: string;
  convexUrl: string;
  convexSiteUrl: string;
  siteUrl: string;
};
