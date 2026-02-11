# 00024 Deploy Fleet Key + OpenTofu Asset Hardening

Status: complete

## Scope
- Fix deploy/bootstrap failures caused by missing bundled OpenTofu asset resolution in bundled CLI runtime.
- Add bootstrap preflight detection for missing provider OpenTofu assets.
- Enforce dashboard deploy SSH readiness on `fleet.sshAuthorizedKeys` only.
- Add regression tests for resolver behavior, doctor checks, and web deploy SSH readiness.

## Task Checklist
- [x] Add canonical OpenTofu provider asset resolver in core infra.
- [x] Switch AWS OpenTofu provider flow to canonical resolver.
- [x] Switch Hetzner OpenTofu provider flow to canonical resolver.
- [x] Add bootstrap doctor check for provider OpenTofu assets and fail as `missing` when absent.
- [x] Enforce dashboard deploy SSH readiness on `fleet.sshAuthorizedKeys` only.
- [x] Update dashboard deploy messaging/help text to reflect fleet-key policy.
- [x] Add core unit tests for OpenTofu asset resolver (`bundled dist`, `repo fallback`, `missing`).
- [x] Extend doctor integration tests for OpenTofu asset check (`ok` + `missing`).
- [x] Update web SSH readiness unit tests for fleet-only policy.
- [x] Run focused tests for changed areas.
- [x] Run full workspace tests (`pnpm -r test`).
- [x] Run required core coverage (`cd packages/core && pnpm run coverage`).

## Key Files Changed
- `packages/core/src/lib/infra/opentofu-assets.ts`
- `packages/core/src/lib/infra/providers/aws/opentofu.ts`
- `packages/core/src/lib/infra/providers/hetzner/opentofu.ts`
- `packages/core/src/doctor/deploy-checks.ts`
- `packages/core/tests/opentofu-assets.unit.test.ts`
- `packages/core/tests/doctor.integration.test.ts`
- `apps/web/src/lib/setup/deploy-ssh-key-readiness.ts`
- `apps/web/src/components/deploy/deploy-initial-setup.tsx`
- `apps/web/src/lib/setup-field-help.ts`
- `apps/web/tests/deploy-ssh-key-readiness.test.ts`
