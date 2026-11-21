# Lane A — typed IPC

**Shipped:** `src/bridge/typed.ts` (`InvokeMap`, `typedHost`, `typedClient`), exported from
`src/index.ts` and typed-only from `src/bridge/client/types.ts`; guide at
`site/app/docs/guides/typed-ipc/page.mdx` (nav + parity row).

**Design decisions.**
- `typedHost` wraps `app.command` and `typedClient.invoke` addresses the `app` namespace's `invoke`
  command explicitly (the same POST as the old two-argument form). Naming it keeps a string `input`
  from being read as a plugin name. No protocol change, no new wire format; `run()` ordering,
  duplicate refusal and the after-`run()` guard are untouched.
- A dotted map key can be an app command (`notes.create`, registered by `typedHost`) or a plugin
  command (`fs.readTextFile`, written by hand). The name alone cannot tell which, so `typedClient`
  never guesses: `invoke` is the app form, `invokePlugin` splits at the first dot into the client's
  plugin form. Hunt-21 #64 was the documented plugin key failing at runtime; both calls are now
  typed against the same map.
- `CommandHost.command` takes `(...args: any[]) => any`. Pinning `CommandHandler` there re-checks
  `App.command` contravariantly and rejects a one-parameter handler — the map is the check, not the host.
- The map must be a `type` alias of an object literal; an `interface` has no implicit index signature
  and fails `extends InvokeMap`.

**Trap: a type error cannot be asserted at runtime.** The negatives are `@ts-expect-error` directives
in `src/bridge/typed.test.ts` — an unused directive is itself a `TS2578` error, so `bun check` fails if
one stops being an error. A directive inside the handler *body* does not work: the error lands on the
call expression, so it must sit on the statement that registers or invokes.

**Proof:** `bun test src/bridge/typed.test.ts` — 6 pass. `bun check` clean except
`src/plugins/sidecar.ts:173` (another lane's file). `bun run check:lines` red on
`src/plugins/sidecar.ts` (207) only — mine are 89/85/40/73. `bun run check:parity` PASS (49 rows),
`check:links` PASS. `scripts/docs-reference.test.ts` fails on a missing `sidecars` build-key row — Lane B.
