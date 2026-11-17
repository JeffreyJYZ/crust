# E2E and smoke probes in scripts/

## Findings

### 1. Windows smoke "pump" proves Bun's timer, not the native message loop — HIGH
`scripts/windows-smoke.ts:163`
The assertion is `ticks >= 2` after one `platform.pump(16)`, but `Platform.ticks` is incremented
unconditionally on every JS timer tick; `shim_pump()`'s result is discarded. A stubbed or broken
`PeekMessageW` path still prints PASS with "N PeekMessageW slices".
**Breaks:** the only real-Windows pump proof goes green when the Win32 pump does nothing.
**Evidence:** `src/platform/windows/platform.ts:111-112` — `this.#shim?.shim_pump();` then
`this.#ticks++;` with no check of the call's return value.

### 2. Linux smoke "pump" has the same vacuous assertion — HIGH
`scripts/linux-smoke.ts:127`
`ticks >= 2` counts setTimeout firings; `backend.iterate()`'s result is ignored and `#ticks++`
runs regardless. The detail claims "g_main_context_iteration slices", which the value does not count.
**Breaks:** a GTK main-context that never iterates still produces a green smoke.
**Evidence:** `src/platform/linux/platform.ts:54-55` — `this.#backend.iterate(); this.#ticks++;`.

### 3. Windows smoke "still open" never calls the native liveness check it names — HIGH
`scripts/windows-smoke.ts:166`
The check is only `platform.window("smoke") !== undefined`, a lookup in the platform's own JS map;
`platform.window()` on Windows has no `shim_window_is_open` call and no pruning. The PASS detail
claims "shim_window_is_open still answers 1 after the pump", which was never executed here.
**Breaks:** a dead/destroyed HWND still tracked in the map reads as "still open".
**Evidence:** `src/platform/windows/platform.ts:146-148` —
`window(label: string): WindowHandle | undefined { return this.#windows.get(label)?.handle; }`.
The Linux twin is sound: `src/platform/linux/platform.ts:94` calls `this.#backend.isOpen(entry.win)`.

### 4. Parity e2e accepts stubbed surfaces as PASS while claiming the opposite — MEDIUM
`scripts/e2e-parity-patterns.ts:12`
`MENU` (line 8) accepts `read unavailable` and `SHORTCUT` accepts `seam unavailable` as passing proof lines,
and the probe app marks those surfaces `ok: true` without ever reading the menu or emitting a shortcut.
The file's own header says "a green line here never overstates what ran" — it does.
**Breaks:** the parity e2e prints PASS for surfaces whose behavior was never exercised.
**Evidence:** `examples/parity-probe/proofs-window.ts:88-89` —
`console.log("shortcut  seam unavailable — registered, but nothing can fire it here"); return mark("shortcut", true);`

### 5. Native e2e "direct ffi" detail is constant and claims an unasserted ordering — MEDIUM
`scripts/e2e-native.ts:97`
The PASS/FAIL detail is the fixed string "main.ts read the epoch from both dylibs before the window
opened" regardless of the boolean. The assertion only checks two regexes in stdout; it never checks
that either call happened before a window opened. A FAIL line reads as a success claim.
**Breaks:** a red run misreports the cause; a green run asserts an ordering it never measured.
**Evidence:** line 100 is the whole detail argument —
`"main.ts read the epoch from both dylibs before the window opened",` — with no `?`/`:` branch.

### 6. Notify e2e "no survivors" detail lies on failure — MEDIUM
`scripts/e2e-notify.ts:165`
The assertion is `(await survivorsOf(builtBinary)).length === 0` but the detail is always
"no process matches the binary path". A FAIL line and the summary's gap line both print that text.
**Breaks:** a leaked app process is reported as no surviving process.
**Evidence:**
```
(await survivorsOf(builtBinary)).length === 0,
"no process matches the binary path",
```

## Coverage
Read every file in the assigned set: `windows-smoke.ts`, all six `scripts/windows/*.ts`,
`linux-smoke.ts`, all 16 `e2e-*.ts` (including `e2e-parity-patterns.ts` and `e2e-harness.ts`).
Followed assertions into `scripts/harness/*`, `scripts/lib/*`, a few phase files, and the
`src/platform/{windows,linux}` `pump`/`window` implementations to verify what a detail line claims.
No probe was executed: the brief forbids the suite/build and the macOS-only probes need an Aqua
session. I did not audit the `package/`, `single/`, `dogear/`, `window/`, `dev-react/` and
`dev-binary/` phase directories in full, nor `scripts/release` (out of scope).
Next: the phase directories, where most top-level e2e assertions actually live.
