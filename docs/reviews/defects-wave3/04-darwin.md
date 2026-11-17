# Darwin platform (AppKit-over-bun:ffi driver and C shim)

## Findings

### 1. A closed window resurrects as open after Cmd+H — HIGH
`src/platform/darwin/windows.ts:118` (`#isOpen`), `src/platform/darwin/liveness.ts:17`, `src/platform/darwin/window-adapter.ts:101`

`#isOpen` feeds `appHidden` straight into `windowLiveness`, which is `visible || miniaturized || appHidden`. A window already closed has `visible=false, miniaturized=false`; hiding the app sets `appHidden=true`, so the OR returns true and the closed window is treated as open. The registry stops pruning its entry, `labels()`/`list()` show it again, and `number()` returns the stale raw `-windowNumber` (which never clears after -close) so `window.isOpen()` returns true and a later `window.create` with the same label is refused as duplicate.

**Breaks:** after a user closes a window and hides the app (Cmd+H), the closed window still appears in `window.list()` and `isOpen()`; reopening that label fails with "already open".
**Evidence:** `return state.visible || state.miniaturized || state.appHidden;` combined with `appHidden = S.b0(app, "isHidden")`. `platform.test.ts:19` asserts `windowLiveness({visible:false,miniaturized:false,appHidden:true}) === true`, so the gate enshrines the rule that cannot distinguish a hidden-app open window from a closed one.

### 2. Four NSWindow action selectors sent with wrong arity (missing sender) — MEDIUM
`src/platform/darwin/shim/92_window_state.c:57`, `:69`, `:74`, `:79`

`toggleFullScreen:`, `zoom:`, `miniaturize:` and `deminiaturize:` all take one `id sender` argument, so their objc_msgSend prototypes need three parameters (self, _cmd, sender). Every call uses the two-parameter cast `(void (*)(void *, void *))objc_msgSend` and passes no sender, leaving x2 with an undefined value that the IMP reads as `sender`. All four selectors are preflighted with the trailing colon (`preflight.ts:60-64`), confirming the colon form is intended.

**Breaks:** undefined behaviour on the four window state actions; works only because AppKit currently ignores `sender`, and can fault or misbehave if it does not.
**Evidence:** `((void (*)(void *, void *))objc_msgSend)(win, sel_registerName("toggleFullScreen:"));` (same shape for `zoom:`, `miniaturize:`, `deminiaturize:`).

## Coverage
Read: `objc.ts`, `index.ts`, `shim-symbols.ts`, `shim-source.ts`, `arity.test.ts`, `preflight.ts`, `appkit.ts`, `platform.ts`, `windows.ts`, `liveness.ts`, `window-adapter.ts`, `window-create.ts`, `window-state*.ts`, `window-chrome*.ts`, `activation.ts`, `webview-configuration.ts`, `network.ts`/`network-ffi.ts` + `shim/110,113`, `downloads.ts` + `shim/downloads/*`, `single.ts`, and the C shim parts under `shim/` (`10,20,30,40,50,55,92,97,99,100,101,103,104,105,108,110,113,114`), `notifications/*` and `status_bar/*`. Cross-checked every `sel_registerName` in C against `PREFLIGHT`, every `S.*` selector in JS against `PREFLIGHT`, and every `bun:ffi` declaration in `index.ts` against its C prototype (arity and width).

Did not: run any test, build or GUI probe (house rule); open other hunters' reports; trace the block/`JSCallback` thread affinity of WebKit delegate callbacks at runtime — the C code reads as nil-safe and guarded, but I could not prove the autorelease-pool-on-thread question without a running AppKit, so I report no finding there. Next I would check the `notifications`/`status_bar` selector guards at runtime and the `JSCallback` return-width handling in `113_network_serve.c` (`long` reading an i32 return) on a live arm64 process.
