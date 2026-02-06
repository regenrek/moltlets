import { z, type RefinementCtx } from "zod";

export const AwsHostSchema = z
  .object({
    region: z.string().trim().default(""),
    instanceType: z.string().trim().default(""),
    amiId: z.string().trim().default(""),
    vpcId: z.string().trim().default(""),
    subnetId: z.string().trim().default(""),
    useDefaultVpc: z.boolean().default(false),
    allowTailscaleUdpIngress: z.boolean().default(true),
  })
  .default(() => ({
    region: "",
    instanceType: "",
    amiId: "",
    vpcId: "",
    subnetId: "",
    useDefaultVpc: false,
    allowTailscaleUdpIngress: true,
  }));

export type AwsHostConfig = z.infer<typeof AwsHostSchema>;

export function addAwsProvisioningIssues(params: {
  host: { aws: AwsHostConfig };
  ctx: RefinementCtx;
}): void {
  const aws = params.host.aws;
  if (!aws.region.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aws", "region"],
      message: "aws.region must be set when provisioning.provider is aws",
    });
  }
  if (!aws.instanceType.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aws", "instanceType"],
      message: "aws.instanceType must be set when provisioning.provider is aws",
    });
  }
  if (!aws.amiId.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aws", "amiId"],
      message: "aws.amiId must be set when provisioning.provider is aws",
    });
  }
  if (aws.useDefaultVpc) {
    if (aws.vpcId.trim() || aws.subnetId.trim()) {
      params.ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aws", "useDefaultVpc"],
        message: "aws.useDefaultVpc cannot be combined with aws.vpcId or aws.subnetId",
      });
    }
  } else if (!aws.vpcId.trim() && !aws.subnetId.trim()) {
    params.ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["aws", "vpcId"],
      message: "aws.vpcId or aws.subnetId must be set when provisioning.provider is aws",
    });
  }
}
