# State across show, hide and close — `src/platform/windows/window*.ts`

Read-only hunt over the window adapter and its state/style/fullscreen/cursor/positioner splits.
Scope: what the adapter remembers, and whether that memory survives a window being minimised,
maximised, made fullscreen, closed, or recreated.

**Count: 4 findings** (2 high, 1 medium, 1 low).

**Worst: F1 — the fullscreen record is keyed by `HWND` and never cleared on close, so a reused handle
lets a dead window's saved style and frame be applied to a brand-new window.**

---

## F1 (high, worst) — stale fullscreen record survives close and clobbers a reused `HWND`

- `src/platform/windows/window-fullscreen-adapter.ts:39` — `const fullscreen = new Map<number, Saved>()`
  is the only persistent state in the whole adapter, keyed by native handle.
- `src/platform/windows/window-fullscreen-adapter.ts:77-80` — the exit path is ungated: `if
  (saved === undefined) return; writeStyle(native, label, saved.style); setFrame(native, label,
  saved.frame); fullscreen.delete(hwnd)`. It checks only whether *a* record exists at this key, never
  whether this record belongs to the current window.
- `src/platform/windows/window-adapter.ts:105-108` — `close(label)` only calls `require(label)` then
  `attached().destroy(label)`. No adapter-state cleanup runs.
- `src/platform/windows/destroy.ts:3,16-19` — `destroyWindow` closes the webview and destroys the
  window; it touches neither the map nor any adapter. The file's own header says "Win32 reuses a freed
  handle."
- `src/platform/windows/window-fullscreen-adapter.ts:34-38` — the comment explicitly anticipates "a
  record left behind by a closed window" and guards only `isFullscreen` (`:82-85`) with the `WS_POPUP`
  read. The exit path was missed.

**Reached:** `setFullscreen("a", true)` stores `{style, frame}` at key `hwnd=100`; `close("a")` destroys
the native window but leaves the record. A later `create("b")` reuses `hwnd=100` (the reuse the code
itself documents). `isFullscreen("b")` correctly reads false — the new window has no `WS_POPUP` bit —
but `setFullscreen("b", false)` sees `saved !== undefined` and writes window A's saved `GWL_STYLE` and
rect onto window B: B loses its current decorations/style and jumps to A's old position and size.
Repeating open/fullscreen/close grows the map without bound. No title-bar-close path
(`shim/20_class.c:60-66`) clears it either.

---

## F2 (high) — fullscreen saves the raw window rect, so minimise/maximise state is lost on exit

- `src/platform/windows/window-fullscreen-adapter.ts:71` — entry saves `frame: frameOf(native, label)`.
  `frameOf` (`src/platform/windows/window-style-calls.ts:35-47`) is plain `GetWindowRect`: the iconic
  off-screen rect (`-32000,-32000`) for a minimised window, the whole monitor for a maximised one.
- `src/platform/windows/window-fullscreen-adapter.ts:79` — exit puts that saved rect back with
  `setFrame`.
- Contrast `src/platform/windows/window-state-adapter.ts:9-14,91-102` — the sibling state adapter
  already fixed exactly this bug with `normalFrameOf` / `WINDOWPLACEMENT.rcNormalPosition` for reads
  and writes on minimised/maximised windows. The fullscreen path never uses it.

**Reached:** `minimize("a")` then `setFullscreen("a", true)` saves `(-32000,-32000,…)`;
`setFullscreen("a", false)` later restores that rect, so the window is moved off-screen where the user
cannot find it. With `maximize("a")` instead, the monitor-sized rect is saved and restored with a
normal style, leaving a monitor-filling window whose `isMaximized()` is now false. A fullscreen toggle
is a show/hide-style mode change; toggling it from a non-normal window state corrupts the frame the
window returns to.

---

## F3 (medium) — a half-completed fullscreen entry cannot be repaired by retrying it

- `src/platform/windows/window-fullscreen-adapter.ts:71-74` — entry writes the record, then
  `writeStyle` (POPUP bit), then `setFrame` (monitor rect). Each is fallible.
- `src/platform/windows/window-fullscreen-adapter.ts:69` — the idempotence guard is
  `if (saved !== undefined && (styleOf(native, label) & POPUP) !== 0) return;` — it infers "fully
  fullscreen" from record + POPUP bit alone, without checking that the frame write ever succeeded.
- `src/platform/windows/window-fullscreen-adapter.ts:7-9` — the header claims the record is retained
  "so a refused `SetWindowPos` can be retried instead of losing the frame." The guard makes that
  retry impossible.
- `src/platform/windows/window-fullscreen-adapter.test.ts:92-96` — the "monitor is read before the
  style is written" test uses `failFrameRead: true`, which throws at `frameOf` (`:71`) *before* the
  style write; the `setFrame`-fails-after-style case is untested.

**Reached:** `setFullscreen("a", true)` with `failFrame` set: `writeStyle` succeeds (POPUP set,
`GWL_STYLE` rewritten), then `setFrame` throws. The record stays and POPUP is set — deliberately, for
retry — but a second `setFullscreen("a", true)` hits the guard at `:69` and returns without issuing
the missing `setFrame`. The window is stuck borderless at its original size, and only
`setFullscreen("a", false)` can clear it. A refused move during entry is thus unrecoverable by the
obvious retry.

---

## F4 (low) — leaving fullscreen restores the whole style DWORD, discarding changes made while fullscreen

- `src/platform/windows/window-fullscreen-adapter.ts:78` — exit calls `writeStyle(native, label,
  saved.style)` with the pre-fullscreen `GWL_STYLE` captured at `:70-71`.
- `src/platform/windows/shim/45_style.c:52-59` — `shim_window_set_decorated` mutates `GWL_STYLE`
  (`WS_FRAME`/`WS_CAPTION`), so it writes the same DWORD the fullscreen restore overwrites.

**Reached:** `setFullscreen("a", true)` (saves style S); `setDecorations("a", true)` while fullscreen
writes S′ into `GWL_STYLE`; `setFullscreen("a", false)` writes S back wholesale, silently reverting the
decoration change. `setAlwaysOnTop` is unaffected (it uses `GWL_EXSTYLE`, `shim/45_style.c`), so this
is limited to style-DWORD members, with `setDecorations` the concrete one. The state is remembered at
entry rather than merged on exit, which violates the module's own "never remembered instead of read"
neighbours (`window-style-adapter.ts:6-9`).
