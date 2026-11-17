# The test suite as a gate — what the tests do NOT prove

## Findings

### 1. The FFI arity guard checks one of 28 binding files — HIGH
`src/platform/darwin/arity.test.ts:99-115`

`bindingSource()` returns a single file — the first `.ts` alphabetically that contains both `symbols: {` and `shim_window_new`, i.e. `index.ts`. `declaredArities()` then reads only `source.indexOf("symbols: {")`, the first block in that one file. The C side is gathered from every `.c` file under the directory, but only index.ts's ~74 `args:` arrays are ever compared. Twenty-seven other binding files declare C symbols with `args:` arrays and are never checked — `status-bar-ffi.ts` (21), `menu-ffi.ts` (17), `navigation-unit.ts` (14), `clipboard.ts` (6), plus `screen.ts`, `single.ts`, `dock-ffi.ts`, `network-ffi.ts`. Those are real `shim_*` functions in the gathered C source: `shim_clipboard_read` takes 2 args at `src/platform/darwin/shim/90_clipboard.c:61`, declared as `{ args: [P, I64] }` at `src/platform/darwin/clipboard.ts:52`.

**Breaks:** Changing a C signature and forgetting the matching `args:` update in any non-index binding shifts arguments silently — the exact modal-file-picker bug the test's own header describes — and the gate stays green.

**Evidence:** `if (source.includes("symbols: {") && source.includes("shim_window_new")) return source;` and `const blockStart = source.indexOf("symbols: {");` — while the docstring claims "Both sides may be split across files, so the test finds them instead of naming one path."

### 2. Always-true assertion under a test name whose case is never built — HIGH
`src/platform/darwin/dialog.test.ts:143-146`

The test is named "the default dialogPlugin stays the adapter-less one" and its comment says "the exported default must not smuggle AppKit into a headless process." The body never imports or reads `dialogPlugin` (the default export, listed in the barrel at `src/plugins/barrel.test.ts:73`). It asserts `expect(createDialogPlugin).toBeDefined()`, and `createDialogPlugin` is an imported function binding (line 3) — defined in every run regardless of behavior.

**Breaks:** If the default `dialogPlugin` were changed to import AppKit or construct a panel at module load, this test still passes; a headless process would load native code with no gate failure.

**Evidence:** `expect(createDialogPlugin).toBeDefined();` — the only assertion in the test.

### 3. The whole status-bar TypeScript adapter family has zero tests — MEDIUM
`src/platform/darwin/status-bar-item.ts:57` (153 lines)

No `.test.ts` under `src/` imports `status-bar-item.ts`, `status-bar-args.ts`, `status-bar-readback.ts`, `status-bar-symbols.ts` or `status-bar-types.ts` — 406 lines total. `src/plugins/tray.test.ts:11-35` compiles the C unit and asserts symbol presence; `tray-fake.ts` drives the plugin. Neither calls `createStatusBar()`. The module's enforced invariants are therefore untested: the one-live-bar rule (`if (live !== undefined) throw`), the `requireLive` destroyed guards, the title readback check, and the single click trampoline routing through `clickRoute`.

**Breaks:** A regression in the single-item invariant or the destroyed guard surfaces as misrouted tray clicks or a SIGABRT crossing into AppKit, with no test failure. The real adapter can throw (`status-bar-item.ts:58-90,75-80`); every tray test uses a fake whose methods always succeed, and the one throwing-adapter test (`src/plugins/tray-failures.test.ts:50`) exercises the plugin, not the adapter.

**Evidence:** `export function createStatusBar(): StatusBar { if (live !== undefined) { throw new Error("crust: one status bar per process; ...") } }` with no test importing the module.

## Coverage

Enumerated all 172 `*.test.ts` files under `src/` and `scripts/` by path and line count. Ran targeted sweeps for: `skip`/`todo`/`only`, tautological `expect(literal)`, `toBeDefined`/`toBeTruthy`, broad regexes, `catch` blocks that swallow, fake/mock helper imports, and source modules with no matching test. Read in full: `dialog.test.ts`, `arity.test.ts`, `assets.test.ts`, `scripts/release/targets.test.ts`, `platform/linux/preflight.test.ts`, `plugins/single-instance.test.ts`, `plugins/fs-scope-tamper.test.ts`, `shell-fixture.ts`, `window-fake.ts`, `network-fake.ts`, `downloads-fake.ts`, `tray-fake.ts`, `updater-fake.ts`, `menu.test.ts`, `barrel.test.ts`, `validate-activate.test.ts`, `cli/doctor/build-assets.test.ts`, `cli/build.test.ts`, `cli/commands.test.ts`, `packaging/sign.test.ts`, `network-pattern.test.ts`, `platform/darwin/downloads.test.ts`, `platform/darwin/webview-target.test.ts`, `plugins/tray.test.ts`, `plugins/tray-failures.test.ts`, `plugins/findinpage-label.test.ts`, `packaging/extension-compile.test.ts`, `platform/darwin/shim.test.ts`, plus source context for `status-bar-item.ts`, `darwin/downloads.ts`, `window-create.ts`, `menu-ffi.ts`, `status-bar-ffi.ts`. Confirmed no test file lacks an `expect` entirely.

Did not read the remaining ~140 test files line by line; the sweeps above cover them for the named patterns. Next pass: the `platform/windows/*.test.ts` source-text assertions (several pin exact counts like `shim_slot_ok(vt, ` × 9, which can pass on cosmetic edits) and the `cli/doctor/*` suites for name/body gaps.
