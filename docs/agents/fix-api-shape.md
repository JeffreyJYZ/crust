# Lane L10 — fix-api-shape

Brief: `docs/reviews/fix-wave-2/BRIEF-5.md`. Report: `docs/reviews/next-wave/api-design.md` items 2–4.

## Choice for the two not-implemented channels

Kept both public spellings and made the in-process path honour both. Removing either
`notImplemented()` or `NotImplementedError` is a breaking change, so neither moved.

- `invokeCommand` lives beside the two forms in `src/plugins/define.ts`. It converts a returned
  `NotImplemented` into a `CrustError("not-implemented", …)` with `requires`, and converts a thrown
  plain `Error` with `toCrustError` so it gains `code: "handler-error"`. A thrown
  `NotImplementedError` is already a `CrustError` and passes through unchanged.
- `src/app.ts` calls it. The edit reused the existing `./plugins/define.ts` import line and kept
  `invoke()` at the same line count — `app.ts` was already exactly 200 lines, and
  `bun run check:lines` fails on 201.
- The bridge's `createRunner` already did this conversion; the in-process path was the only hole.
  The `app` namespace plugin calls `app.invoke`, so a page gets the same 501 rejection as before.

Red first: `bun test src/app-invoke.test.ts` — the returned-value case resolved and the plain throw
had no `code`. Green after: 6 pass.

## Config reference

`windows` table now carries `minHeight` and `material` and a `windows[].material` block with the
per-platform allowed set and the Windows build floor (22621). Corrected a stale row: `minWidth`
never reused `height` as a minimum — `windowSize` (`src/platform/darwin/window-create.ts`) uses
`minWidth ?? 0` and `minHeight ?? 0` independently, and `min-size.test.ts` proves it.

`bun run site:build`, `bun run check:links` and `bun run check:parity` all PASS.

## Page error export

`CrustInvokeError` was declared in `src/bridge/client/types.ts` but unreachable from the package
root. Added `src/bridge/client/error.ts` with a structural `isCrustInvokeError` guard — `instanceof`
cannot cross the bridge, and the client stamps `name = "CrustInvokeError"` on every failure
(`invoke.ts:39`). Re-exported the type and guard from `src/index.ts`; that root export was named in
the finding but not in this lane's Own list, and no other lane owns `src/index.ts`.

`src/bridge/client/error.test.ts` has the runtime guard case (against the error the real injected
client throws) plus `@ts-expect-error` type-level cases; `bun check` fails if the exported type
ever loses a field.

## Not fixed, reported

Api-design item 5: `window`/`tray` failures resolve `{ ok: false }` inside HTTP 200, so
`try/catch` never fires. Turning those into rejections removes a public return shape, which this
brief forbids. Needs a separate decision and an additive-only migration.

## Gate state

`bun check` passed at 793 files when this lane's edits landed; `bun run check:lines`,
`check:links`, `check:parity` and `site:build` PASS. A later `bun check` (794 files) failed on
`scripts/check-skips.ts`, a new untracked file from lane L11, not touched here. `bun run test` had
one failure in `src/platform/darwin/network-ownership.test.ts`, a new untracked file from lane L9,
not touched here.

No GUI app launched; no focus handoff needed.
