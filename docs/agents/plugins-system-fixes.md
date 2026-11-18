# plugins-system lane — wave 3 fix report

Source: `docs/reviews/defects-wave3/06-plugins-system.md`. Files owned: `src/plugins/{power,shortcuts,logging,crash-reporter,theme,accessibility}*.ts`.

## Fixed

1. **`power.sleepAllow` swallowed a failed native release** — `src/plugins/power.ts:153`.
   `SleepRelease.ok` is now checked the same way `sleepPrevent` checks `SleepAssertion.ok`. A
   refusal answers `{ ok: false, code: "handler-error", message: reason }`; the command's return type
   gained `PowerFailure`. `released: false` still means "nothing was held" when `ok` is true.

2. **`shortcut.unregister` discarded the native boolean** — `src/plugins/shortcuts.ts:134`.
   A `false` from `adapter.unregister` now answers `{ ok: false, code: "native-failed", part }` and
   leaves the accelerator in the plugin registry, so a retry reaches the OS again instead of
   forgetting a hot key that is still firing.

3. **Logging severity table was inverted** — `src/plugins/logging.ts:16`.
   `SEVERITY` is now `{ error: 0, warn: 1, info: 2, debug: 3, trace: 4 }`, matching the existing
   comment "higher is chattier" and the `SEVERITY[level] > SEVERITY[current]` filter.

4. **Crash-reporter uninstall hardcoded the native answer** — `src/plugins/crash-reporter.ts:81,153`.
   `UninstallResult` now carries `armed: boolean` and `status: number`, and `uninstall` propagates
   `native.disarm()` instead of hardcoding `armed: false`. A handler set the OS refused to disarm is
   reported as still armed, with the status and reason that named the refusal.

5. **`shortcut.onTrigger` unsubscribe was dead code** — `src/plugins/shortcuts.ts:90,167`.
   The adapter's unsubscribe is retained in `detachTrigger`. The returned plugin now has an
   idempotent `dispose()` that calls it, so a teardown can detach the press handler. The plugin
   remains frozen; `dispose()` is a method on the frozen wrapper.

6. **`theme.set` could not report an AppKit refusal** — `src/plugins/theme.ts:34,65`;
   `src/plugins/theme-types.ts:24`; `src/plugins/theme-fake.ts:36`.
   Added `ThemeFailure` (`{ ok: false, code: "handler-error", message }`) to `set`/`reset`. A local
   `apply()` wraps `native.set` and the read-back in `try`/`catch`; a throw becomes the typed failure,
   emits no `theme:changed` event and leaves the override unchanged. `theme-fake.refusing()` is a new
   fixture whose `set` throws like AppKit does, so the refusal path is exercised in tests.

7. **`power.state` stamped `ok: true` on a fabricated reading** — `src/plugins/power.ts:26,115,134`.
   `PowerState` gained optional `available`/`reason`, `idleSeconds` accepts a `PowerReadFailure`, and
   both commands answer `PowerFailure` when the adapter says the native read never happened. Faked
   battery and idle values can no longer reach a page as a real reading. **Adapter half was already
   fixed by the darwin lane — now pinned below.**

8. **`accessibility.prompt` had an untested throw path** — `src/plugins/accessibility.ts:49,89`.
   Added `PromptFailure`; `prompt()` wraps `adapter.prompt()` in `try`/`catch` and returns the typed
   failure with the adapter's message instead of a rejected invoke.

## Tests added

- `src/plugins/logging-level.test.ts` (3 cases) — trace is dropped at `info` and admitted at
  `trace`; `trace` admits all quieter levels; `error` survives every threshold while `debug` only
  survives from `debug` up. All three fail against the old table.
- `src/plugins/power-native-refusal.test.ts` (3 cases) — refused release, fabricated state read and
  refused idle read each produce `handler-error`. The old code returned `ok: true` for all three.
- `src/plugins/shortcuts-native-failure.test.ts` (2 cases) — a refused native unregister keeps the
  key in the registry and calls the OS twice; `dispose()` detaches the press handler exactly once.
  The old code had neither behaviour and no `dispose` method.
- `src/plugins/accessibility-prompt-refusal.test.ts` (1 case) — a throwing adapter becomes
  `handler-error`. The old code threw out of the command.
- `src/plugins/crash-reporter.test.ts` (1 new case + updated expectation) — a native disarm
  reporting `{ armed: true, status: 3 }` is propagated verbatim.
- `src/plugins/theme-set.test.ts` (2 new cases) — a refusing `set` and a refusing `reset` both
  answer `handler-error`, emit no event and leave the override alone.

`bun test` on the 12 plugin test files in this area: **70 pass, 0 fail**.

## Formerly "not fixed" — darwin half closed and pinned

- **Finding 4, darwin half — fixed, asserted by `src/platform/darwin/crash-disarm.test.ts`**:
  `disarmCrashHandlers()` does not discard `crust_crash_disarm()`'s return. `status` is the C answer
  (`-1` on compile failure), `armed` comes from `crashArmed()`, and the reason is `disarmed` or
  `crust_crash_disarm answered <n>`. The test replaces the C answer on the exported `unit()` seam
  (0 and 11) and forces a compile refusal in a child; a hardcoded `status: 0` / `armed: false`
  adapter fails both cases.
- **Finding 7, darwin half — fixed, asserted by `src/platform/darwin/power-unavailable.test.ts`**:
  both `state()` and `idleSeconds()` already answer `available: false, reason: unit` when the C unit
  will not compile, so fabricated readings never reach the plugin channel. The test forces that path
  with an isolated `TMPDIR`, then asserts the same compile reason on both channels and that the state
  is not a fabricated reading.

## Notes for the next lane

- Wrapping the `definePlugin({...})` call in a `const` removes the enclosing function's declared
  return type as a contextual type for command object literals. The `return { ok: true, ... }`
  literal widened `ok` to `boolean` and broke assignability; `as const` on that literal is the fix.
  Keep this in mind for any other plugin whose definition is stored before returning.
- Final `bun check`: clean, 627 files. `bun run check:lines` still fails on four other lanes' files
  (`src/packaging/extension-compile.test.ts`, `src/packaging/extension-bindings.test.ts`,
  `src/runtime-plugins.ts`, `src/platform/windows/frames.ts`); none of my files appear. All my files
  are at or under 200 lines.
- Re-read all eight findings after editing and checked each fix changes behaviour: every new test
  asserts the answer the pre-fix code could not produce.
