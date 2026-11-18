# Lane L11 — fix-hollow-covers

Measured 2026-11-18 on darwin at `0e8d2c2`. Three new test files; production code unchanged.

## Changes

- `src/config/validate-fs.test.ts` — `fs.scope` had no test: absolute prefixes carried through, relative/empty/non-string entries and a non-array refused with `fs.scope[0]`/`fs.scope` paths, unknown key named.
- `src/extensions/registry.test.ts` — `extensionRegistry()` had no test: each call returns a fresh empty `PluginRegistry`; a registration does not leak into the next build.
- `src/single-detect.test.ts` — `detectSingle` refusals had no dedicated test: `--config`/`--entry` combination, unsupported extension, file beside `crust.config.ts`.

## Proof

- `bun test src/config/validate-fs.test.ts src/extensions/registry.test.ts src/single-detect.test.ts` → 9 pass / 21 expect() calls; `bun check <3 files>` → no type errors in 228 files.
- Red by temporary production mutation, each restored: fs absolute check disabled → `Expected: "fs.scope[0]" Received: undefined`; shared registry singleton → `Expected: 0 Received: 1`; config-beside guard disabled → `expected a refusal, got app`. Green again after each restore.
- `bun check` → no type errors in 792 files. Full `bun run test` red on four cases in `src/platform/darwin/native-ownership.test.ts` (`dl_pending_count undeclared`), L9's in-flight file, not mine.
- `bun run check:lines` → FAIL on that same 286-line file; all three new files are well under 200 lines.

## Skip vs pass (the F8 follow-up)

- `bun test` reports `1 pass / 1 skip / 0 fail` for `test.skip` and exits 0 — exit code alone cannot distinguish skip from pass. Probe: `bun test /private/var/folders/.../l11-skip.test.ts` → `1 pass, 1 skip`, `exit=0`.
- `bun test --reporter=junit --reporter-outfile=<file>` emits `skipped="1"` on `<testsuite>` and `<skipped />` inside the `<testcase>`. CI shape: run that reporter and fail a post-test script on any skip outside an explicit allowlist. F8's coverage guards already stop those two files reading green when their precondition is absent.
