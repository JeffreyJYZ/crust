# windows frames/preflight fix lane

Scope: findings 1 and 3 of `docs/reviews/defects-wave3/02-windows.md`.

## Finding 1 — frame scanner skipped non-bare declarators

- `src/platform/windows/frames.ts`: `declaration()` now returns `LocalArray[]`, not
  `LocalArray | undefined`. It strips initialisers, splits top-level commas, accepts pointer
  element types, multiplies every `[bound]` dimension, and drops leading
  `volatile|const|register|signed` before the `SIZES` lookup. `localArrays()` keeps an
  `initializer` depth so `buf[4096] = {0}` stays in the segment instead of being treated as a
  nested block.
- Measured after the fix: `void *p[512]` 4096, `char *p[4096]` 32768,
  `shim_wchar buf[64][64]` 8192, `unsigned char buf[4096] = {0}` 4096,
  `shim_wchar a[2048], b[2048]` two 4096 entries. All are offences now.
- Trap: the type/name separator must stay `\s+` in the regex. With `\s*`,
  `dst[n - 1] = 0` parses as type `d`, name `st`, bound `[n - 1]` and floods the unit with
  false offences. An array-element assignment test guards this.
- Known limit, not part of this finding: `offences()` still judges one declaration at a time;
  two separate 2048-byte arrays in one frame are not summed. `frames.ts` sits at the 200-line
  cap, so a per-frame sum needs a split by responsibility first.

## Finding 3 — preflight table and probe

- `src/platform/windows/preflight.ts`: added the four kernel32 binds the table was missing —
  `GetCurrentThreadId`, `GetTickCount64`, `VirtualQuery`, `LoadLibraryW` (21 -> 25 entries
  plus the WebView2 loader export, matching the shim's 25 `SHIM_BIND`s). Exported
  `SymbolResolver` and `missingEntryPoints(entries, resolves)`.
- `src/platform/windows/backend-default.ts`: `probe()` now sets `missing` by asking the OS
  loader about every entry. `osResolves` uses `dlopen` and returns false when the module or
  export is absent; it is a no-op off Windows, where user32 does not exist. `defaultBackend`
  takes an injectable resolver so the probe is testable anywhere.
- Trap: Bun's `dlopen(name, symbols)` takes the symbol map as its **second argument**, not
  `{ symbols: ... }`. Passing the wrapper throws `Expected an options object with symbol names`.
  A missing export throws `Symbol "X" not found in "lib"`, which is the signal used here.
- `src/platform/windows/preflight.test.ts`: coverage now derives the expected set from
  `readShimSource()` (`SHIM_BIND(g_*, Name)` plus the loader's `GetProcAddress`), so a new
  bind without a preflight entry fails the test. Added tests for `missingEntryPoints` and
  for the real backend running the table.

## Checks

- `bun check`: clean (630 files).
- `bun test` on `frame.test.ts`, `preflight.test.ts`, `imports.test.ts`: 24 pass, 0 fail.
- `bun run check:lines`: fails on `src/packaging/extension-compile.test.ts` (265) and
  `src/packaging/extension-bindings.test.ts` (222) — other lanes' files, untouched here.
  All files in this lane are at or under 200 lines (`frames.ts` is exactly 200).
