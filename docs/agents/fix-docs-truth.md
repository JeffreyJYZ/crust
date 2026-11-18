# fix-docs-truth — traps worth keeping

- Docs that quote a tuned constant can disagree with the literal the shipped code passes: `site/app/docs/design` said "0.25 ms slices" while `shim/50_app.c` passes `0.004` (4 ms deadline) and `0.002` (2 ms fallback). Check the literal, never the comment or the research conclusion beside it.
- Keep the measurement honest when correcting the claim: the `research/runloop` sweep really measured 0.25 ms at 186/187 ticks and 4 ms at 82.4%. Label it as sweep evidence, not as the shim's setting, instead of deleting it.
- A doc page and a sibling page can contradict each other and both be stale: `guides/logging` said four levels and an unbounded file while `reference/api-app` said five and 1 MiB rotation. The plugin (`src/plugins/logging.ts`) has `LogLevel` of five, `ROTATE_BYTES` 1 MiB, `ROTATED_NAME` `app.log.1`. Diff against the exported type/constant, not against the other page.
- Signature tables drift after feature work while guides stay current: `reference/api` listed two `app.on` events after `AppEvent` grew to six. Diff the signature against `AppEvent` in `src/app-types.ts`.
- Commands can exist and be tested while both doc pages omit them: `logging.configure` (`src/plugins/logging.ts:143`, `logging-configure.test.ts`) was absent from guide and api-app. Check the `commands` map, not only the guide's sections.
- Optional interface members hide in "implements X — N methods and nothing more" prose: `Platform` now has `windowLabels?()` and `lifecycle?()` (`src/app-types.ts:38,44`).
- A doctor check list is a literal sequence: `sourceSection` is pushed between `window` and `assets` (`src/cli/doctor.ts:76`), so the `reference/cli` ordered list needs it.
- Perf numbers age: `evidence` had 85.27 MiB binary and 101-102 MiB footprint from 0.1.12-0.1.20; re-measured 0.1.26 gives 86.18 MiB and 120.7 MiB (`docs/reviews/next-wave/perf.md`). Mark re-measured rows with version and date, and leave the old sweep row labelled as a sweep.
- Proof commands for this lane: `bun run site:build`, `bun run check:links`, and `bun test` on the files from `rg -l truth src scripts`. A docs-only lane cannot make a red src test green; prove with build/links plus the existing truth tests.

## Not fixed (owned by other lanes)

- `src/platform/darwin/shim/50_app.c:72` comment still says "one 0.25 ms slice" while passing `0.004`; `src/app-types.ts:94` comment says "0.25 ms slice". The measured optimum (0.25 ms) is a one-line src change, but this lane owns `site/app/docs/**` only.
- `evidence/page.mdx` cold-start worst case (790.1 ms window, 1.70 s invoke) is still stale against perf.md's 1,322.5 ms / 1,600.1 ms cold launch; the brief named only binary size and idle footprint.
- `README.md:57` "~85 MB" is outside this lane's files.
