# Sizes and signatures — `src/platform/windows/ffi*` and `preflight*`

Read-only hunt over `ffi.ts`, `ffi-core.ts`, `ffi-dialog.ts`, `ffi-abi.test.ts`, `preflight.ts` and
`preflight.test.ts`, cross-checked against every shim C definition. Scope: FFI arity, byte width,
type kind, and the two guards that are supposed to keep those honest.

Verification baseline: `bun test src/platform/windows/ffi-abi.test.ts
src/platform/windows/preflight.test.ts` is green (17 pass). An independent parse of all 115 FFI
declarations against the C definitions found **no live arity or byte-width mismatch** and no bad
module assignment in `PREFLIGHT`. Every finding below is a hole that lets a *future* wrong size or
signature ship green — which is the point of a guard, so they are real defects.

**Count: 5 findings** (2 high, 2 medium, 1 low).

**Worst: F1 — the ABI test's binding walk never includes `ffi-core.ts` or `ffi-dialog.ts`, so 18 of
the 115 FFI declarations are unchecked; a wrong width in them passes the gate.**

---

## F1 (high, worst) — 18 declarations are invisible to the ABI test

- `src/platform/windows/ffi-abi.test.ts:22-24` — `bindings` keeps a file only when its name is
  `ffi.ts` or ends with `-ffi.ts`. `ffi-core.ts` and `ffi-dialog.ts` match neither, so they are
  dropped before any comparison.
- `src/platform/windows/ffi.ts:123-127` — both dropped tables are spread into the live `symbols`
  object via `...coreSymbols` / `...dialogSymbols`. They are part of the compiled shim, not dead code.
- Count: `ffi.ts` 80 declarations + `keychain-ffi.ts` 5 + `notify-tray-ffi.ts` 12 = 97 checked;
  `ffi-core.ts` 12 + `ffi-dialog.ts` 6 = **18 unchecked**.
- `src/platform/windows/ffi-abi.test.ts:39-43` — the "binding walk found every FFI module" test
  asserts only `ffi.ts` and `keychain-ffi.ts` are present, so the omission is baked into the test.

**Reached:** the tables were split out of `ffi.ts` at the 200-line cap (`ffi-core.ts:6-8`,
`ffi-dialog.ts:5-7` say so), but the test filter was not widened. Change `shim_os_uptime` from `F64`
to `I64` at `ffi-core.ts:36`, or `shim_dialog_error` from `u32` to `I32` at `ffi-dialog.ts:22`: both
are wrong on Windows (a `double` read as an integer; an unsigned `CommDlgExtendedError` read signed),
and `bun test` still passes because neither file is ever parsed. A caller then gets a garbage uptime
or a negative dialog error with no gate failure to trace it to.

---

## F2 (high) — even widening the file filter would still check zero symbols in those two files

- `src/platform/windows/c-abi.ts:92` — `ffiSymbols()` starts with
  `const start = source.indexOf("symbols: {"); if (start < 0) return [];`.
- `src/platform/windows/ffi-core.ts:17` and `ffi-dialog.ts:15` — the tables are exported as
  `coreSymbols = {` and `dialogSymbols = {`; neither file contains the literal `symbols: {`.

**Reached:** the obvious one-line fix to F1 (add the two file names to `bindings`) parses both files
to an empty symbol list. The test goes green with the same coverage as before, so a maintainer
reasonably concludes the gap is closed when it is not. Fixing F1 requires changing the parser's entry
point too, not just the file filter.

---

## F3 (medium) — the width comparison cannot see a same-width type or sign swap

- `src/platform/windows/ffi-abi.test.ts:74-89` — the only signature check compares
  `cWidth(...)` to `ffiWidth(...)`. The file header at `:6-8` admits widths alone miss ABI shape
  errors, but the sole special case is the RECT by-value test at `:94-103`; there is no general kind
  or signedness comparison.
- `src/platform/windows/c-abi.ts:128-152` — `ffiWidth` maps `ptr`, `cstring`, `i64`, `u64` and `f64`
  all to 8, and `i32`, `u32`, `f32` all to 4.
- `src/platform/windows/c-abi.ts:108-125` — `cWidth` maps `double` to 8 and `unsigned int` to 4,
  with no category returned.

**Reached:** `shim_webview_put_bounds` takes two `double`s (`ffi.ts:130`, C at `shim/42_webview.c:31`);
changing either FFI arg from `F64` to `I64` keeps width 8, so the test passes while WebView2 receives
an integer bit pattern as a float. Likewise `shim_dialog_error` (`ffi-dialog.ts:22`) is unsigned in C
(`shim/49_dialog.c:87`); changing `u32` to `I32` keeps width 4 and passes, but a real
`CommDlgExtendedError` with the high bit set is reported negative. No test in the suite reads
signedness.

---

## F4 (medium) — the arm64 test never checks the x64 branch it was written to protect

- `src/platform/windows/ffi-abi.test.ts:97-102` — asserts an `__aarch64__` branch exists, matches a
  by-value call inside it, and checks only that the part *before* `#else` contains no `&r`.
- `src/platform/windows/shim/34_slots.c:30-34` — the `#else` (x64) branch is what passes `&r`; the
  test never asserts that `&r` is present there.

**Reached:** deleting the `&` from the x64 branch (`(ctrl, r)` instead of `(ctrl, &r)`) leaves the
arm64 assertions untouched, so the test stays green. On Windows x64 the 16-byte `RECT` is then
passed by value where the method expects a pointer, and `put_Bounds` reads garbage bounds — exactly
the class of defect the test's own header says it exists to catch.

---

## F5 (low) — the preflight guard recognises only two binding shapes, and one live bind escapes it

- `src/platform/windows/preflight.test.ts:69-74` — `expected` is built from
  `SHIM_BIND(g_\w+, ...)` plus a single `GetProcAddress(loader, "...")`.
- `src/platform/windows/shim/46_material.c:15-20` — `DwmSetWindowAttribute` is resolved with a local
  module variable: `GetProcAddress(dwm, "DwmSetWindowAttribute")`. It matches neither regex, so it
  is absent from `expected` and from `PREFLIGHT`.
- `src/platform/windows/preflight.test.ts:76-80` — despite the claim "covers every entry point the
  shim calls", the equality assertion compares two sets that both omit this symbol.

**Reached:** a new entry point bound through any variable name other than `g_*` or `loader` is
silently outside the table; the guard cannot fail. `DwmSetWindowAttribute` is already such a case —
it degrades to a named `-4` rather than crashing (`46_material.c:21`), so it is low severity today,
but the completeness claim is false and a future bind without a graceful fallback would crash with
no preflight error.
