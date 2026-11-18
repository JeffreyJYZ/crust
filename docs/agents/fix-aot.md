# fix-aot

## Measured on stable 1.4.4+38afee6c8

- `bun build --compile --aot` exit 0, binary runs; `bun build --help` does NOT list `--aot`.
- `bun compile --help` exit 1 ("Script not found compile") — old probe tested a subcommand that does not exist, so AOT was dead code.
- examples/hello: 89,820,386 B with and without `--aot`. Stable gets zero size win; canary's 85.27 -> 53.10 MiB is not reproducible on stable. Kept flag: free, future toolchains benefit.
- Cross-compile `bun build --compile --aot --target=bun-linux-x64` works on stable; `--aot-allow-code-from-disk` also accepted.

## Changes

- `src/packaging/aot.ts`: scratch-probe exact command once, cache boolean; fall back on refused flag.
- `src/packaging/build.ts`: use `bun build --compile --aot`, not `bun compile`; shared argv array.
- `scripts/build-standalone.ts`: conditional `--aot` via same helper; split prove logic to `scripts/release/standalone-prove.ts` for the 200-line cap. `SCAFFOLD_COUNTS` literals stay in build-standalone.ts: `src/cli/init.test.ts:92` reads them from that file.
- `.github/workflows/release.yml`: `bun-version: 1.4.4` on all three `setup-bun@v2` steps; no canary since no size win.

## Verification

- `bun run check:lines` PASS; `bun run e2e:package` 22/22; `bun run build:standalone` PASS; new tests in `aot.test.ts` + `toolchain-pin.test.ts` pass.
- `bun run test` 1780 pass / 1 fail: `src/cli/assets.test.ts:9` expects 9 files in templates/next, another lane's untracked `templates/next/.github/workflows/release.yml` adds a 10th. Not mine; left untouched.

## Traps

- `rg -rn` is ripgrep's *replace* flag, not recursive+line numbers; it corrupted one search's output into `n`.
- `bun fmt` re-expands argv arrays past printWidth, so re-check `check:lines` after formatting.
