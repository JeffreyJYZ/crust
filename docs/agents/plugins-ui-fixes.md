# plugins-ui fix wave — report

Lane `plugins-ui`, report `docs/reviews/defects-wave3/08-plugins-ui.md`.
Files owned: `src/plugins/{window,single-instance,menu}*.ts`.

## fixed

1. **Closed window became `unknown-window` — HIGH** — `src/plugins/window-args.ts:145`
   `knownWindow` no longer decides existence from `list()` alone. macOS prunes a
   closed window from `list()`, so a label absent there is probed with the
   adapter's own `isOpen`: it answers `false` for a closed-but-tracked label and
   throws `unknown-window` for one never held. The probe is caught inside the
   gate so it cannot throw past it. `window.isOpen` now answers `{open:false}`
   and a second `window.close` stays idempotent.
   Same gate unified in `src/plugins/window-persist.ts:34,105` — `WindowFrameNative`
   gained an optional `isOpen` and `save` calls `knownWindow`, so `window-state.save`
   reaches a just-closed window. Adapters without `isOpen` keep the old list-only
   behavior (existing tests unchanged).

2. **Two waiters could both win a stale single-instance lock — MEDIUM** —
   `src/plugins/single-instance-lock.ts` (new), `src/plugins/single-instance.ts`
   The lock-file half moved out of `single-instance.ts` (which had hit the 200-line
   cap) into `single-instance-lock.ts`. `acquire` now uses `dropIfUnchanged(path,
   raw)`: it unlinks only when the file still holds the exact bytes that named the
   dead pid. A waiter that replaced the stale lock with its own live pid is no
   longer deleted, so the loser re-reads that live pid and returns
   `{acquired:false, pid:<winner>}`. Attempts raised 2 → 3. Public exports
   (`AcquireResult`, `ReleaseResult`, `defaultLockDir`, `MAX_PID`) are re-exported
   from `single-instance.ts` so barrels and runtime callers are unchanged.
   `beforeTakeover` is an optional test seam that forces the interleave; no
   production caller passes it.

3. **`__proto__` label lost its saved frame — MEDIUM** —
   `src/plugins/window-persist-store.ts:41`
   `readState` now returns a null-prototype state map (`emptyState()`) for every
   path (missing, corrupt, empty and populated files). Assigning `state["__proto__"]`
   creates an own property instead of invoking the inherited setter. Every writer
   (`save`, `saveAll`, `forget`) starts from `readState`, so one change fixes the
   whole surface: the JSON now contains the label and `restore` sees a real frame.

4. **Protocol-relative URL escaped "own document" — MEDIUM** —
   `src/plugins/window-create.ts:51`
   `own` is false for a scheme OR two leading slash/backslash characters, so
   `//evil.example/x`, `\\evil.example/x`, `/\evil.example/x` and `\/evil.example/x`
   pass through untouched. Measured with `new URL(url, "http://app.local/")`: all
   four resolve to `http://evil.example/x`. A single leading backslash stays a
   path (it resolves to the app's own origin) and still gets `?window=`.

5. **Menu test comment said three commands — LOW** — `src/plugins/menu.test.ts:61`
   Description corrected to "all five commands"; assertion was already correct.
   No behavior changed, so there is no behavior test for this finding.

## tests added

- `src/plugins/window-closed-label.test.ts` — adapter whose `list()` filters closed
  windows like `WindowRegistry.labels()`: `isOpen` answers `false`, `close` twice
  stays a value, a never-held label is still `unknown-window`, and
  `window-state.save` reaches the closed label.
- `src/plugins/window-proto-label.test.ts` — a `__proto__` label writes an own JSON
  key, restores its frame, and `readState` returns a null-prototype map.
- `src/plugins/window-create-origin.test.ts` — all four authority-relative forms
  pass through with no `?window=`; single-backslash and ordinary relative controls
  still carry the label.
- `src/plugins/single-instance-stale.test.ts` — forced two-waiter interleave: the
  fresh lock survives and the loser reports the live winner; `dropIfUnchanged`
  refuses bytes it did not read.

Red-then-green: with all four source fixes temporarily reverted, 6 of the 9 new
assertions fail; restored, all 9 pass. The three that still fail-free in red are
the two controls and the direct `dropIfUnchanged` unit (its call site was reverted,
not the helper).

## not fixed

None. No finding needed another lane's file.

## durable notes

- The platform owns liveness: `WindowRegistry.labels()` filters closed windows,
  `WindowRegistry.number()` returns `0` for a closed-but-tracked one. A plugin's
  `list()`-based existence gate is wrong by construction on macOS; probe `isOpen`.
- `single-instance` compare-and-delete closes the wide race, but `readFileSync`
  then `unlinkSync` still has a two-syscall TOCTOU between processes. Eliminating
  it needs kernel compare-and-delete (no such primitive in `node:fs`); revalidation
  is the standard best-effort and is what the finding asks for.
- `new URL` treats `\` as `/` for special schemes, so the authority-escape check
  must cover any two leading slash-or-backslash characters, not just `//`.
- A null prototype on a state map is safe with `JSON.stringify`, `Object.entries`
  and Bun's `toEqual` (the existing `window-persist` suites stayed green).

## checks run

- `bun check` — clean (whole tree; other lanes' errors cleared while this ran).
- `bun test <11 window/single/menu suites>` — 62 pass, 0 fail, 209 assertions.
- `bun fmt <changed files>` then `bun fmt --check` — all formatted.
- `bun run check:lines` — my files all under 200 (largest: `window-args.ts` 169).
  The four reported oversized files belong to `packaging`, `windows` and `runtime`
  lanes, not this one.
- No full suite, e2e or build run, per the shared brief.
