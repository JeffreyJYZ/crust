# Defects: System plugins (wave 3)

Area: `src/plugins/` — notification, power, tray, dock, theme, autostart, shortcuts, opener, os, accessibility, logging, crash-reporter.

Hunt targets:
- honesty of a returned status (`{delivered}` / `{activated}` reporting success the OS never confirmed)
- native call whose failure is swallowed
- listener registered but never removed
- darwin/linux/windows branches disagreeing on the answer's shape
- fake adapter diverging from the real one so a test passes where the platform would fail

## Findings

### 1. `power.sleepAllow` swallows a failed native release — HIGH
`src/plugins/power.ts:139-140`
The adapter's `SleepRelease.ok` exists precisely to report a refused release, and the darwin adapter sets it false when the C unit fails to compile or `crust_power_allow_sleep()` returns a negative status. `sleepAllow` ignores `answer.ok` and always answers `{ ok: true, released: ... }`, so a release that never happened reads as success. `sleepPrevent` right above it checks the matching `ok` flag.
**Breaks:** a caller holding a sleep assertion is told it released one that is still held; it stops retrying, and the machine never sleeps until process exit.
**Evidence:** `const answer = await adapter.allowSleep(); return { ok: true, released: answer.released };` vs darwin adapter `if (typeof unit === "string") return { ok: false, released: false, reason: unit };`

### 2. `shortcut.unregister` discards the native boolean and reports success — HIGH
`src/plugins/shortcuts.ts:133-135`
`ShortcutAdapter.unregister` answers a boolean; the darwin adapter returns false when Carbon's `shortcut_unregister` refuses or throws. The plugin ignores that value, returns `{ ok: true }` and deletes the accelerator from its registry. A hot key that is still registered in the OS is then forgotten by the plugin.
**Breaks:** after a refused native unregister, `isRegistered` says false and a later register of the same key goes to the OS again while the original hot key keeps firing.
**Evidence:** `adapter.unregister(parsed); live.delete(parsed.accelerator); return { ok: true, accelerator: parsed.accelerator };` vs darwin `return Number(shortcutUnit().symbols.shortcut_unregister(id) ?? 0) === 1;`

### 3. Logging severity table puts `trace` below `error`, inverting the level filter — HIGH
`src/plugins/logging.ts:16`
`SEVERITY = { trace: 0, error: 1, warn: 2, info: 3, debug: 4 }` treats `trace` as the least chatty level, but `trace` is the most chatty. `write` drops a line when `SEVERITY[level] > SEVERITY[current]`, so at the default `info` level a `trace` line is written while `debug` is dropped, and configuring `trace` drops every `error`, `warn`, `info` and `debug` line. The test only writes `trace` at level `trace`, so it cannot catch cross-level behaviour.
**Breaks:** the filter admits the noisiest level at every threshold and silences all real logs when set to the most verbose setting.
**Evidence:** `const SEVERITY: Record<LogLevel, number> = { trace: 0, error: 1, warn: 2, info: 3, debug: 4 };` with `if (SEVERITY[level] > SEVERITY[current]) return { written: false, reason: "below-level" };`

### 4. Crash-reporter `uninstall` ignores the native disarm status — MEDIUM
`src/plugins/crash-reporter.ts:149-150`
`CrashNative.disarm` answers a `CrashArmResult` carrying `armed` and `status`, and the darwin adapter discards `crust_crash_disarm()`'s return entirely, hardcoding `status: 0`. The plugin then hardcodes `armed: false` whatever the native half reports. A handler set that failed to disarm is reported as fully restored.
**Breaks:** after a failed disarm a page is told fault handlers are gone when they may still be installed; the reason string is the only honest field.
**Evidence:** `const arm = native.disarm(); return { armed: false, reason: arm.reason };` vs darwin `compiled.symbols.crust_crash_disarm(); return { armed: false, status: 0, reason: reasonOf(...) };`

### 5. `shortcut.onTrigger`'s unsubscribe is never retained or called — MEDIUM
`src/plugins/shortcuts.ts:89`
`ShortcutAdapter.onTrigger` returns `() => void`, and both the darwin adapter and the test fake implement a real unsubscribe that clears their handler. The plugin discards the returned function. No plugin teardown hook exists in `define.ts` or `registry.ts`, so the native handler is registered for the process lifetime and the unsubscribe contract has no consumer.
**Breaks:** the adapter's unsubscribe is dead code; any future plugin teardown cannot detach a press handler because the handle was thrown away at registration.
**Evidence:** `adapter?.onTrigger((accelerator) => sink?.("shortcut", { accelerator }));` with darwin `return () => { if (handler === next) handler = undefined; };`

### 6. `theme.set` cannot report an AppKit refusal, and its fake cannot produce one — MEDIUM
`src/plugins/theme.ts:72`
The real `darwinThemeAdapter.set()` throws when `-[NSApplication setAppearance:]` refuses, but `theme.set` calls it outside any `try` and its return type has no failure variant, so a native refusal becomes a rejected invoke rather than a typed result. `theme-fake.ts`'s `set` never throws, so the whole `theme-set.test.ts` suite passes while the platform's refusal path is never exercised.
**Breaks:** an app that cannot apply the requested appearance gets a bridge rejection instead of the `{ ok: false }` shape every other system plugin returns; the suite gives no coverage of that path.
**Evidence:** `native.set(appearance);` vs darwin `if (Number(unit.symbols.crust_theme_set(CODES[appearance]) ?? 0) !== 1) { ... throw new Error(...); }` and fake `set: (appearance) => { applied.push(appearance); ... }`

### 7. `power.state` stamps `ok: true` on a reading the OS never gave — MEDIUM
`src/plugins/power.ts:101-109`
When the darwin C unit fails to compile, `darwinPowerAdapter().state()` fabricates `{ onAc: false, batteryPercent: null, lowPowerMode: false }` and `idleSeconds()` fabricates `0`. The plugin has no failure channel in `PowerStateResult` and answers both as `ok: true`, so a machine actually on wall power is reported as running on battery.
**Breaks:** callers branch on a fabricated power state with no way to tell it from a real reading.
**Evidence:** plugin `return { ok: true, onAc: answer.onAc, ... };` vs darwin `if (typeof unit === "string") { return { onAc: false, batteryPercent: null, lowPowerMode: false }; }`

### 8. `accessibility.prompt` has the same untested throw path as `theme.set` — LOW
`src/plugins/accessibility.ts:84-85`
`darwinAccessibilityAdapter.prompt()` throws when the C unit will not compile, but `prompt` neither catches nor types that failure; its only documented answers are `PromptResult` and `NotImplemented`. The test fake's `prompt` simply returns `false`, so no test covers the real adapter's refusal.
**Breaks:** a machine whose AX unit cannot compile gets a rejected invoke from `accessibility.prompt` instead of a branchable failure.
**Evidence:** `const trusted = await adapter.prompt(); return { ok: true, trusted, prompted: true };` vs darwin `if (typeof unit === "string") throw new Error(unit);`

## Coverage
Read all system-plugin sources and their fakes in `src/plugins/` (notification, power, tray, dock, theme, autostart, shortcuts, opener, os, accessibility, logging, crash-reporter), their tests, `define.ts`, `registry.ts`, and the darwin adapters for power, shortcuts, crash, status bar, crash install shim, theme, accessibility, opener, os-info and notifications. Confirmed tray `show`/`hide`/`destroy` are honest in practice: `TrayNative` returns void, but the darwin adapter throws on a failed `tray_set_visible`, and `tray.ts` converts a throw to a typed failure. Confirmed notification, opener and dock map OS status codes to success only for status 0 / `ok: true`. Checked `runtime-plugins.ts` wiring only to confirm adapter sources; found no per-OS branch that changes an answer's shape for these plugins (each is wired only on darwin, with the adapter-less default elsewhere). Not covered: the C shims behind each adapter, and other hunters' areas.
