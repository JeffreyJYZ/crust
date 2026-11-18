# fix-binary-size (F9) — measured facts and traps

Measured 2026-11-18, crust 0.1.26, Bun 1.4.4, M4 Air / macOS 27. Full report: `docs/reviews/next-wave/perf.md`.

- AOT is unreachable on this machine: `/Users/jyz/.bun/bin/bun` and `/opt/homebrew/bin/bun` are both
  `1.4.4+38afee6c8`, and `bun compile --help` exits 1 with `error: Script not found "compile"`.
  No other Bun is on PATH, so the AOT branch at `src/packaging/build.ts:64-102` always falls through
  to `bun build --compile --trim`. Forcing that branch fails with `bun compile failed (exit 1)`.
- Direct measurement (`bun run src/cli/index.ts build --dir <tmp>` + `stat -f '%z'`, with
  `node_modules/crust -> <repo>` symlinked in the temp project): compiled binary 90,381,794 B
  (~86.20 MiB), signed bundle binary 89,856,480 B (~85.68 MiB). The perf lane measured
  90,365,282 B compiled earlier in the day; the ~16 KiB drift is other lanes' source changes.
- Result: changed nothing. There is no smaller binary available via AOT here, and a toolchain swap
  is out of scope without the user's say-so. A measured "not available / not worth it" is the result.
- `bun run e2e:package` PASS 22/22 with the unchanged tree; the compiled app runs.
- While this wave was in flight, `bun run test` was red from other lanes' intermediate edits
  (F1/F2/F6/F7). None of those failures were in `src/packaging/build.ts` or `scripts/build-standalone.ts`.
- Hand the measured numbers to F5 (`fix-docs-truth`): it owns the stale binary size on the docs site.
