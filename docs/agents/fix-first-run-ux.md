# fix-first-run-ux (L6)

Files owned: `src/cli/index.ts`, `src/cli/usage.ts`, `src/cli/first-run.test.ts`. `src/cli/dev.ts` and `src/cli/build.ts` belong to F4; `src/config/load.ts` is not a CLI file.

- Missing-config text comes from `src/config/load.ts:44` (`no crust config in …`), not from the CLI. Since F4 owns `dev.ts`/`build.ts`, the guidance is added once in the top-level catch in `src/cli/index.ts`, matching the two prefixes `no crust config` and `crust config not found`. The hint mirrors `doctor`'s wording, so the two do not disagree.
- Do not change `parse()`'s `globalFlag` short-circuit: `parse.test.ts` pins that `--help`/`--version` suppress validation errors. Validate the command after parse in `index.ts` instead — that is where `bogus --help` used to return 0.
- `commandHelp()` in `usage.ts` derives one command's block and the shared options list from `USAGE` by string slicing, so help wording still has one home and `commands.test.ts`'s "every command is in USAGE" check keeps working. A hand-written second copy would drift.
- New test `src/cli/first-run.test.ts` spawns the real entry point (`Bun.spawn` of `src/cli/index.ts`) because `index.ts` sets `process.exitCode` at module load and cannot be imported twice in one process. Temp dirs are removed in `finally`.
- Full-suite state at handoff: `bun run test` = 1780 pass, 1 fail. The failure is `src/cli/init.test.ts:85` ("the standalone gate asserts these exact counts"), which expects `["--react", 6]` in `scripts/build-standalone.ts`; that file is modified by another lane. Not this lane's defect, not touched.
- `bun check` clean, `bun run check:lines` PASS, formatting clean on all three owned files.
