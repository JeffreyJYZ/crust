# Lane P — `accessibility` announce/title/focus

- **Butter's `a11y:*` trio is command-shaped now, not a live region.** `announce`/`title`/`focus` post through the OS; nothing enters the DOM, so a page cannot recover Butter's 50 ms clear-and-set timing. Said so in the guide rather than faking it.
- **`announce` is not gated on `trusted`** — an untrusted process still posts and the OS drops it, so the answer is `{ announced: true, trusted: false, reason }`. Gating it would claim a policy the OS does not apply.
- **Windows is refused by name, deliberately.** `NotifyWinEvent EVENT_OBJECT_LIVEREGIONCHANGED` is a live-region change a screen reader reads on its own schedule, not a request to speak a string.
- **Linux names GTK 3, not GTK 4** — `gtk_widget_announce` is GTK 4 only and the shim loads `libgtk-3.so.0`, so `requires: "gtk_widget_announce"` with the version in `reason`.
- **`106_accessibility_page.c` cannot reference `shim_cstr_len`** — that lives in the AppKit shim, a different compilation unit, and TinyCC fails `unresolved reference`. A local `ax_len` is the fix (measured).
- **A short ASCII NSString must be built and consumed inside C** — every string here does, so no tagged pointer crosses `bun:ffi`.
- **`LP64` arity:** `crust_ax_announce(text, int)` / `crust_ax_title(text, label)` / `crust_ax_focus(label)` — all pointer+int, checked by `arity.test.ts`.
- **Files:** `src/plugins/accessibility{,-page,-trust,-types,-requires}.ts`, `src/platform/darwin/accessibility{,-page-ffi}.ts`, `shim/106_accessibility_page.c`; tests `src/plugins/accessibility-announce.test.ts` + `src/platform/darwin/accessibility-page.test.ts`.
- **`src/platform/darwin/platform.ts` is 205 lines and `src/runtime-plugins.ts` has a type error** — both belong to other lanes; nothing of mine touches them.
