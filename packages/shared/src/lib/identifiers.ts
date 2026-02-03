import { z } from "zod";

import { detectKnownToken } from "./token-patterns.js";

const SAFE_HOSTNAME_RE = /^[a-z][a-z0-9-]*$/;
const SAFE_GATEWAY_ID_RE = /^[a-z][a-z0-9_-]*$/;
const SAFE_SKILL_ID_RE = SAFE_GATEWAY_ID_RE;
const SAFE_PERSONA_NAME_RE = SAFE_GATEWAY_ID_RE;
const SAFE_SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SAFE_OPERATOR_ID_RE = /^[a-zA-Z0-9._-]+$/;
const SAFE_ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

function looksLikePastedToken(value: string): boolean {
  const s = value.trim();
  if (detectKnownToken(s)) return true;
  if (s.length < 40) return false;
  const hasLetter = /[A-Za-z]/.test(s);
  const hasDigit = /\d/.test(s);
  if (!hasLetter || !hasDigit) return false;
  // Heuristic: long identifier with no underscores is almost always a pasted token.
  if (!s.includes("_")) return true;
  // Heuristic: "prefix_<verylongalnum>" looks like GitHub tokens, etc.
  const match = s.match(/^([A-Za-z]{2,8})_([A-Za-z0-9]{24,})$/);
  return Boolean(match);
}

export const HostNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_HOSTNAME_RE.test(v), { message: "invalid host name (use [a-z][a-z0-9-]*)" });

export const GatewayIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_GATEWAY_ID_RE.test(v), { message: "invalid gateway id (use [a-z][a-z0-9_-]*)" });

export const SkillIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_SKILL_ID_RE.test(v), { message: "invalid skill id (use [a-z][a-z0-9_-]*)" });

export const PersonaNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_PERSONA_NAME_RE.test(v), { message: "invalid persona name (use [a-z][a-z0-9_-]*)" });

export const SecretNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_SECRET_NAME_RE.test(v), { message: "invalid secret name (use [A-Za-z][A-Za-z0-9_-]*)" })
  .refine((v) => !looksLikePastedToken(v), {
    message: "invalid secret name (looks like a token; expected identifier like brave_api_key)",
  });

export const EnvVarNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_ENV_VAR_NAME_RE.test(v), { message: "invalid env var name (use [A-Z_][A-Z0-9_]*)" });

export const OperatorIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => SAFE_OPERATOR_ID_RE.test(v), { message: "invalid operator id (use [a-zA-Z0-9._-]+)" })
  .refine((v) => v !== "." && v !== "..", { message: "invalid operator id" });

export function assertSafeHostName(hostName: string): void {
  void HostNameSchema.parse(hostName);
}

export function assertSafeSecretName(secretName: string): void {
  void SecretNameSchema.parse(secretName);
}

export function assertSafePersonaName(personaName: string): void {
  void PersonaNameSchema.parse(personaName);
}

export function assertSafeOperatorId(operatorId: string): void {
  void OperatorIdSchema.parse(operatorId);
}

export function sanitizeOperatorId(raw: string): string {
  const cleaned =
    String(raw || "operator")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_") || "operator";
  if (cleaned === "." || cleaned === "..") return "operator";
  return cleaned;
}
