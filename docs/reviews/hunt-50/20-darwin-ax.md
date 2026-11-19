# darwin accessibility AX hunt — 20

Scope: `src/platform/darwin/accessibility*.ts` (four files) and their C units
`src/platform/darwin/shim/106_accessibility*.c` (two files). Read-only source inspection. No app
was launched, no focus taken, no test run, no other hunter's report opened. The question asked was
which reads in this area can block and how a caller reaches them. Call chains into the plugin were
read in `src/plugins/accessibility{,-page,-trust}.ts`, `src/runtime-plugins.ts` and
`src/bridge/server/invoke.ts`; none of those files were changed.

## Inventory of native reads

| Read | Site | Can block? |
| --- | --- | --- |
| `AXIsProcessTrusted` | `shim/106_accessibility.c:70` (`crust_ax_trusted`) | No — local TCC state read. |
| `AXIsProcessTrustedWithOptions` | `shim/106_accessibility.c:87` (`crust_ax_prompt`) | No. Apple: "Prompting occurs asynchronously and does not affect the return value." Raises the TCC dialog. |
| `AXUIElementCreateApplication(getpid())` | `shim/106_accessibility.c:101`, `shim/106_accessibility_page.c:124,156` | Element construction, local. |
| `AXUIElementCopyAttributeValue(app, AXWindows)` | `shim/106_accessibility.c:107`, `shim/106_accessibility_page.c:159` | **Yes** — synchronous AX read. |
| `AXUIElementCopyAttributeValue(window, AXChildren)` | `shim/106_accessibility.c:124` | **Yes** — synchronous AX read. |
| `AXUIElementCopyAttributeValue(element, AXWindowNumber)` | `shim/106_accessibility_page.c:171`, inside the loop at `:168-179` | **Yes, once per window.** |
| AppKit reads in `ax_window` (`sharedApplication`, `windows`, `keyWindow`, `title`, `accessibilityLabel`) | `shim/106_accessibility_page.c:80-100` | Main-thread AppKit reads; stall if AppKit needs the runloop. |

Every `AXUIElement` here is built from `getpid()`, so the well-known cross-process hang of AX reads
is deliberately avoided. That removes one cause of blocking, not the mechanism: `bun:ffi` calls are
synchronous, so each of these reads runs inline on the Bun thread until it returns. The bridge
invokes handlers on that same thread (`src/bridge/server/invoke.ts:50-71`, `await handler(...)`), and
the darwin pump is a `setTimeout` chain on the same loop (`src/platform/darwin/platform.ts:65-79`,
`shim_pump`). The repo measures three 200 ms synchronous handlers at 600.2 ms wall
(`docs/reviews/next-wave/perf.md:33`): one blocking handler stalls every other invoke and every pump
tick. None of the reads below has a timeout or an off-thread path.

## Findings

### 1. HIGH (blocks the whole app) — `accessibility.focus` does N+1 unbounded synchronous AX reads

- where: `shim/106_accessibility_page.c:159` (`AXWindows`) and `:168-179` (the `AXWindowNumber`
  loop at `:171`); AppKit half at `:79-103`; adapter `src/platform/darwin/accessibility.ts:142-152`;
  command `src/plugins/accessibility-page.ts:140-155`.
- mechanism: `ax_window(label)` first walks every AppKit window, reading `title` and, when present,
  `accessibilityLabel` for each (`:92-101`) — up to two AppKit reads per window. It then issues one
  `AXUIElementCopyAttributeValue(AXWindows)` (`:159`) and one `AXUIElementCopyAttributeValue` per
  window looking for `AXWindowNumber` (`:171`), until a match is found. A label that matches the last
  window, or matches none, pays all of them. Every read is a synchronous FFI call on the JS thread,
  with no timeout and no worker, so a slow answer in any window's AppKit AX implementation holds the
  bridge, all timers and the Cocoa pump for the whole chain. `focus` is the one call in this area that
  combines the two read families, so it is the worst case.
- how reached: a page holding the `accessibility.focus` capability calls
  `crust.accessibility.focus({ label })` → `POST /_crust/invoke` → `createRunner`
  (`src/bridge/server/invoke.ts:50-71`) → `pageCommands.focus` (`accessibility-page.ts:140-155`) →
  `darwinAccessibilityAdapter().focus` (`accessibility.ts:142-152`) → `cstr(label ?? "")` →
  `crust_ax_focus`. The plugin is registered unconditionally on darwin
  (`src/runtime-plugins.ts:182`); the capability check at `invoke.ts:59-65` is the only gate.
- smallest fix: replace the per-window loop with one
  `AXUIElementCopyMultipleAttributeValues` on the app element, or do the window match off the JS
  thread behind a bounded timeout. At minimum cap the number of windows walked.

### 2. MEDIUM (blocks a probe callers are told to use) — `elementCount` is two unbounded synchronous AX reads

- where: `shim/106_accessibility.c:107` (`AXWindows`) and `:124` (`AXChildren`); adapter
  `src/platform/darwin/accessibility.ts:114-120`; command
  `src/plugins/accessibility-trust.ts:75-92`.
- mechanism: two sequential `AXUIElementCopyAttributeValue` calls on the JS thread, no timeout. The
  self-process caveat is reported honestly (empty AXWindows while a window is on screen,
  `106_accessibility.c:95-99`), but that is a correctness note, not a bound on time. This call is
  presented as a cheap read — "reads that answer typed values" in `src/plugins/accessibility.test.ts:175`
  and the guides — so a page or test that polls it stalls the pump for the full duration of each read.
- how reached: `crust.accessibility.elementCount()` over the bridge → `trustCommands.elementCount`
  (`accessibility-trust.ts:75-92`) → `darwinAccessibilityAdapter().elementCount`
  (`accessibility.ts:114-120`) → `crust_ax_element_count`. Capability-gated at `invoke.ts:59-65`.
- smallest fix: batch the two reads or move them off the JS thread; failing that, document the call as
  blocking in `site/app/docs/guides/accessibility/page.mdx`.

### 3. LOW (inverse of a blocking read) — the dialog-raising call is page-reachable behind a comment only

- where: `src/platform/darwin/accessibility.ts:109-113` (`prompt`), `shim/106_accessibility.c:77-91`
  (`crust_ax_prompt` → `AXIsProcessTrustedWithOptions` at `:87`), command
  `src/plugins/accessibility-trust.ts:55-67`, declared at `src/plugins/accessibility.ts:73-80`.
- mechanism: the "never called by a test or a probe, only by a command a person invoked" rule is
  prose in `accessibility.ts:6-7` and `accessibility-page.test.ts:5-6`, not code. The Apple docs check
  above confirms this call does **not** block on the user, so it is not a blocking-read defect — it is
  the opposite: the one call in this area that puts a real system dialog on the user's screen, exposed
  as an ordinary bridge command. A page granted `accessibility.prompt` can raise it repeatedly.
- how reached: same bridge chain as finding 2, with `trustCommands.prompt` →
  `darwinAccessibilityAdapter().prompt`. The in-process `app.invoke` route named at
  `src/bridge/server/invoke.ts:38-39` bypasses the capability check entirely.
- smallest fix: require an explicit app-side opt-in, or expose `prompt` only through a native path.

### 4. LOW — objects created in the two page paths are never released

- where: `shim/106_accessibility_page.c:110,113-115,122-132` (`message`, `priority`, dictionary),
  `:142-145` (`name` in `crust_ax_title`), `:171-173` (`number_value` on a non-OK copy).
- mechanism: `ax_nsstring` returns `alloc`-owned NSStrings and `NSNumber numberWithInteger:` returns
  an owned object. `CFDictionaryCreate` with both callback arguments `NULL` is documented as all-NULL
  callbacks, so the dictionary does not retain its values; after `CFRelease(info)` at `:131` both
  objects leak. `crust_ax_title` likewise never releases `name`. Each page call with distinct text
  therefore grows memory, and `cstr`'s permanent per-string cache in
  `src/platform/darwin/objc.ts:9-21` keeps the input bytes too. Not a blocking read; listed because
  it is reached by the same commands.
- how reached: `accessibility.announce`, `accessibility.title`, via finding 1's bridge chain.

## Count

Four findings: 1 HIGH, 1 MEDIUM, 2 LOW. Two of the four (findings 1 and 2) are the blocking-read
defects asked about. Checked and explicitly **not** reported: `AXIsProcessTrusted` (`106_accessibility.c:70`)
and `AXIsProcessTrustedWithOptions` (`:87`) — the latter raises a dialog but returns immediately per
Apple's documentation; `AXUIElementCreateApplication` builds an element locally; `CFArrayGetCount` /
`CFArrayGetValueAtIndex` are plain reads.

## Worst finding

Finding 1: `src/platform/darwin/shim/106_accessibility_page.c:159,168-179`. One `AXWindows` read plus
one `AXWindowNumber` read per AppKit window, on top of up to two AppKit label reads per window, all
synchronous on the JS thread with no timeout. A page with the `accessibility.focus` grant can reach it
through `crust.accessibility.focus({ label })`, and a label that matches late or not at all makes it
stall the bridge and the window pump for every read.
