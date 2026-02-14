skills: ~/.codex/skills

must
- prod-grade, maintainable, scalable
- fix root cause (no band-aids)
- no shims/wrappers/adapters/workarounds
- one canonical impl; ask always to delete dead/legacy paths in same change
- single source of truth for rules/config/validation/enums
- no legacy code ever

rules
- no destructive ops unless asked (rm/reset/clean/force-push)
- no live infra unless asked (bootstrap/lockdown/opentofu apply)
- avoid sindresorhus deps; implement small helpers in-house

never commit (secrets/instance)
- .clawlets/
- .env files (local tokens)
- age keys (operator or host)
- sops config/keys
- opentofu state
- ssh private keys
- any discord tokens/guild ids/api keys

docs
- entry: apps/docs/content/docs/index.mdx
- index: apps/docs/content/docs/meta.json

source of truth
- packages/cli/src and packages/core/src (not dist)
- infra lives in clawlets-template (project repos)
- apps/docs/content/docs/*.mdx and apps/docs/content/docs/meta.json

generated (do not edit)
- packages/*/dist

checks
- pnpm -r test
- cd packages/core && pnpm run coverage

commits
- Conventional Commits

## Coding Style
- Target <=500 LOC (hard cap 750; imports/types excluded).
- Keep UI/markup nesting <=3 levels; extract components/helpers when JSX/templating repeats, responsibilities pile up, or variant/conditional switches grow.
- Avoid cargo-cult: Default to the simplest idiomatic pattern. Do not copy patterns from other files unless you can state why they are needed here. Non-standard patterns (eg dynamic import, indirection, workarounds) are forbidden unless you add a local justification in the same diff: problem, why the standard approach fails, and evidence (repro error, cycle trace, perf or bundle data). If no justification, replace with the standard pattern (eg static import) and remove the workaround.
- The codebase must use domain-folder structure only and canonical imports only; do not add compatibility wrappers or legacy naming.