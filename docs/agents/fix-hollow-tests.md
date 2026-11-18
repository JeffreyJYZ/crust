# Lane F8 — fix-hollow-tests

Measured 2026-11-18 on darwin at `0e8d2c2`. Owned three test files; production code unchanged.

## Changes

- `scripts/release/targets.test.ts` — `withHost(platform, arch, check)` overrides `process.platform` and `process.arch` with `Object.defineProperty` and restores them in `finally`. The win32 test now asserts a fixed table of literal targets (`win32/x64 → bun-windows-x64`, `darwin/arm64`, `linux/x64`) instead of rebuilding `hostTarget()`'s own conditional.
- `src/packaging/extension-bindings-abi.test.ts` — the markerless-dylib test no longer does `if (CLANG === undefined) return;`; absence registers `test.skip`, matching its sibling. Added a coverage guard `expect(CLANG).toBeDefined()`.
- `src/platform/darwin/screen.test.ts` — screens are read once into `SCREENS`; empty list registers `test.skip` instead of a bare return, with a coverage guard `expect(SCREENS.length).toBeGreaterThan(0)`.

## Proof

- Scoped: `bun check <3 files>` → no type errors; `bun test <3 files>` → 18 pass / 46 expect() calls.
- Red, win32 mapping broken (`"win32" ? "win32"` in `scripts/release/targets.ts`): `Expected: "bun-windows-x64" Received: undefined`, 1 fail, 5 pass. Restored.
- Red, dylib answers 12 while test expects 11: `Expected: 11 Received: 12`, 1 fail. Restored.
- Red, primary assertion changed to `>= 2`: `Expected: >= 2 Received: 1`, 1 fail. Restored.
- Red absence probes (forced `CLANG = undefined` and `SCREENS = []`): 3 skip + 2 fail from the coverage guards, so an all-skip run cannot read green. Restored.
- `bun run check:lines` → PASS. No `TEMP` probe text left; `git diff -- scripts/release/targets.ts` empty.

## Found, not fixed (outside lane)

- Full `bun check` went red on `src/plugins/i18n.ts:82` — `Property 'dir' is missing ... required in type 'LocaleResult'`; lane F7 is editing that file in this tree.
- `bun run test` now collects 2334 tests / 405 files and fails 48 with 35 errors inside `research/electrobun/...`, after F2 widened `package.json:31` to bare `src examples`. Bun treats a bare `src` as a substring, so `research/electrobun/repo/package/src/**` is swept; the old `src/bridge src/plugins ...` prefixes did not match it. Owner: F2.
