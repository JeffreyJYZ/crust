# L5 — fix-updater-platform

Finding: `docs/reviews/next-wave/packaging.md` §2. Updater registered on every platform; `install`
needs `.app`, `relaunch` runs `open -n`, so Windows/Linux had no working path — silent half-feature.

Choice: refuse by name off macOS instead of building platform adapters (smallest honest fix).

- `createUpdaterPlugin` gained 4th arg `platform: string = process.platform`. Both `install` and
  `relaunch` return `platformFailure()` first thing on non-darwin; no filesystem or launch is touched.
- `updater-args.ts`: new code `unsupported-platform` + `platformFailure(command, platform)`; message
  names the platform and says why (`open -n`, `.app` swap). Distinct code so a page can branch on it.
- `check`/`download` stay cross-platform: network + hashing only, no macOS assumption.
- Separate param from `execPath` so a test proves both arms on this darwin host — `process.platform`
  alone would hide the win32/linux branch.
- Docs: `site/app/docs/limits/page.mdx` platform table row + Distribution note.

Proved: `bun test src/plugins/updater-platform.test.ts` 5 pass; `bun check` clean; `bun run
scripts/line-cap.ts` PASS; `bun run check:links` PASS; `bun run site:build` clean.

Not fixed: `bun run test` has one failure in `src/cli/init.test.ts` ("standalone gate asserts these
exact counts", expects `["--react", 6]`), another lane's file and WIP — not mine, not reverted.
