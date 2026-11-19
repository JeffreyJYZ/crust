# Displays — `src/plugins/screen*`, `src/plugins/positioner*`, `src/plugins/window-state*`

Read-only hunt. Scope: the three plugin families plus the seam that supplies their numbers (darwin/windows/linux screen shims and the runtime wiring). One scoped test run: 26 pass / 0 fail across the five plugin suites. No code changed, no GUI touched.

**Count: 5 findings** (1 high, 3 medium, 1 low).

**Worst: F1 — one display's height gates and defines the coordinates of every display in `screen.list()`.**

---

## F1 (high, worst) — the darwin flip depends on a single display read, and a failure there discards all displays

- `src/platform/darwin/screen.ts:136-140` — `listScreens()` reads `shim_screen_info(0, …)` before the loop and returns `[]` when that call fails or `first[3]` is not a positive finite height.
- `src/platform/darwin/screen.ts:141-148` — displays 1..n are enumerated only after that gate; they are never reported when the index-0 read fails.
- `src/platform/darwin/screen.ts:93-100` — the one number read from index 0 (`ceiling`) is the flip for **every** display's `bounds` and `workArea`, so a stale or wrong height shifts every display's `y`, not just the primary's.
- `src/platform/darwin/shim/97_screen.c:84-87` — `shim_screen_info` returns 0 when `crust_screen_at` finds no screen at the requested index, which is the transient state during a display reconfiguration; `:103-104` writes the primary flag from `index == 0`, tying "primary" to the same single index.

**Reached:** Two displays, one primary. A page calls `screen.list()` while the display set is being reconfigured (unplug/dock change). `shim_screen_count()` sees a count > 0, then index 0 resolves to no screen (or a zero frame) before the loop: the adapter returns `[]`. The page sees "no displays" although the secondary is live, and `screen.primary()` answers `handler-error: no usable display` (`src/plugins/screen.ts:159-165`). Even when index 0 is readable but its height is stale from before the reconfiguration, every display's `y` is flipped by the wrong ceiling, so a window placed from `workArea` lands on the wrong display.

**Smallest fix:** enumerate displays independently of the flip constant; derive the ceiling from any readable display (or from the frame union) and, if none is readable, refuse by name instead of answering an empty list. Stop deriving the primary flag from index 0 where the platform can answer it directly.

---

## F2 (medium) — one unusable number removes an otherwise valid display from `screen.list()`

- `src/plugins/screen.ts:80-85` — `usable()` requires both rectangles to have finite coordinates and positive width/height.
- `src/plugins/screen.ts:95` — `clean()` returns `undefined` when **either** `bounds` **or** `workArea` is unusable, so a display with perfectly good `bounds` disappears from `list()` because one number in its work area is 0 or non-finite.
- `src/platform/darwin/shim/97_screen.c:47-51` — `crust_read_nsrect` returns an all-zero rect when the display does not answer a selector, which is exactly the shape `usable()` rejects.
- `src/platform/darwin/screen.ts:103-124` — `record()` accepts the display anyway (it only checks the frame), so the loss happens silently in the plugin layer.

**Reached:** A secondary display whose `visibleFrame` cannot be read (or reports a zero rectangle) is absent from `screen.list()` with no refusal and no field marking it; callers enumerating displays to choose a target never see it. On a single-display machine this is indistinguishable from a headless process; with two displays it is a silent lie about the machine's display count.

**Smallest fix:** fall back to `bounds` when only `workArea` is unusable (as the Windows/Linux adapters already do at `src/platform/windows/screen.ts:31-36` and `src/platform/linux/screen.ts:31-36`), and keep the display with a flagged work area rather than dropping it.

---

## F3 (medium) — Windows caps the display list at 8 and silently drops the rest

- `src/platform/windows/shim/47_screen.c:10` — `#define SHIM_MONITOR_COUNT_MAX 8`.
- `src/platform/windows/shim/47_screen.c:52` — the `EnumDisplayMonitors` callback returns 0 for index >= 8, which **stops enumeration**; displays 9+ are never written.
- `src/platform/windows/shim/47_screen.c:66` — the primary flag is computed from a single coordinate pair, `rcMonitor.left == 0 && rcMonitor.top == 0`, i.e. one display's origin stands in for "the OS primary".
- `src/platform/windows/screen.ts:60-69` — the adapter loops to the shim's count and cannot report displays the shim never enumerated.

**Reached:** A machine with 9 or more monitors (common with docks and daisy-chained displays). `screen.list()` returns at most 8 with `ok: true`; `screen.primary()` picks among those 8, so if the marked primary is beyond the cap it is not reported at all and `find(primary) ?? listed[0]` answers the wrong display. No error indicates truncation.

**Smallest fix:** grow the table to a documented bound (or allocate dynamically) and return a typed refusal when the count exceeds capacity; derive the primary from `MONITORINFOEXW.dwFlags & MONITORINFOF_PRIMARY` instead of the origin.

---

## F4 (medium) — `window-state` restores an absolute frame with no display validation (disconnected-display case)

- `src/plugins/window-persist.ts:140-143` — `frames().apply` calls `setSize` then `setPosition` with the stored `{x,y,width,height}` verbatim.
- `src/plugins/window-persist.ts:161-169` — `restore` answers `restored: true` as soon as an entry exists.
- `src/plugins/window-persist-all.ts:87-102` — `restoreAll` does the same for every window, naming only labels with no stored entry.
- `src/plugins/window-persist-store.ts:36-41` — `readFrame` checks only that four numbers are finite and the size positive; there is no screen seam in either plugin.

**Reached:** Save a window on a secondary display at `x: 2000, y: 0`, quit, disconnect that display, relaunch and call `restore`/`restoreAll`. The absolute frame is applied on the remaining display; AppKit's `setFrame:display:` does not constrain to screen, so the window reopens where the user cannot reach it while the answer says `restored: true`. This is the display-count case that matters most: the number was valid with two displays and invalid with one.

**Overlap:** same defect as `docs/reviews/hunt-20/16-persistence.md` (Medium); reported here because it is the worst display-shaped defect in this scope. No fix landed in the tree for it.

**Smallest fix:** give the state plugin an injected screen-frame seam and intersect the saved frame with the union of current displays before applying, or answer `restored: false` when the frame lies wholly outside it.

---

## F5 (low) — every positioner placement measures against one hard-coded display

- `src/runtime-plugins.ts:176` — `createPositionerPlugin({ native: windowAdapter, screen: screen.mainScreenFrame })`.
- `src/platform/darwin/screen.ts:73-79` and `src/platform/darwin/shim/97_screen.c:56-70` — `mainScreenFrame` reads `crust_screen_at(crust_screens(), 0)`, i.e. index 0 only.
- `src/plugins/positioner.ts:161-181` — one `screen` frame is used by all nine placement commands; no command takes a display id.
- `src/platform/windows/window-positioner.ts:44-50,60-66` — the Windows half repeats the same rule (`primaryWorkArea`: marked primary or `displays[0]`).

**Reached:** A window dragged to an external display, then `positioner.center` (or any placement). The plugin computes the point from the primary's visible frame and calls `setPosition` with absolute coordinates, so the window jumps back to the primary display. A page that wants a secondary display must convert top-left `screen.list()` rectangles to the window's y-up frame itself.

**Smallest fix:** let a placement name a display id, resolve that display's work area through the screen plugin, and keep the main-screen frame only as the default for callers that do not name one.

---

## Checked and clean

- `src/plugins/screen.ts:156-168` — `primary()` uses the platform's `primary` flag and only falls back to the first listed display; the test `screen.test.ts:32-41` lists the secondary first to prove it does not blindly take `[0]`.
- `src/plugins/positioner.ts:93-129` — the nine placements' arithmetic is consistent for negative origins (displays left of/above the primary); `positioner.test.ts:93-118` pins the no-clamp rule for oversized windows.
- `src/platform/linux/shim/60_screen.c:89-90` — the primary flag comes from `gdk_display_get_primary_monitor` compared by pointer, not from index 0.
- `src/platform/darwin/screen.ts:93-100` — flipping by the primary's height is the correct AppKit model: a display above the primary gets a negative top-left `y`, and `darwin/screen.test.ts:80-108` proves the four sign cases.
