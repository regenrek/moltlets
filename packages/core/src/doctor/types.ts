export type DoctorCheck = {
  scope: "repo" | "deploy";
  status: "ok" | "warn" | "missing";
  label: string;
  detail?: string;
};

export type DoctorPush = (c: DoctorCheck) => void;

