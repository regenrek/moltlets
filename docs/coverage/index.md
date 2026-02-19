# Coverage

Canonical workspace coverage command:

```sh
pnpm coverage:all
```

What it runs:

1. `pnpm -r --if-present coverage`
2. `pnpm -C apps/web test -- --run`

Related focused commands:

- `pnpm -r test`
- `pnpm -C packages/core run coverage`
