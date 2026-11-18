# Does the page resize with the window on Windows and Linux?

Scope: whether the macOS defect — a webview pinned at its initial size while the window grows — also
exists on Windows and Linux. **Nothing here was measured at runtime.** This machine is macOS: no
Windows and no GTK, so every Windows and Linux conclusion is read from the shim C and the TypeScript.
The only evidence is the quoted code.

## Verdicts

- **Windows: resizes correctly** (read from code — the `WM_SIZE` handler updates the controller from the
  client rect on every size message).
- **Linux: resizes correctly, with one unrelated window-geometry defect** — the page fills the window
  through `gtk_container_add`, but the window's *minimum height* is pinned to its opening height
  whenever `minWidth` is configured, and `minHeight` is ignored entirely.
- **Platform-neutral: no defect** — the only shared path that re-applies a size (`window-state`
  restore) has no adapter on either platform, so it cannot write a stale size back.
- macOS: out of scope here; another lane is fixing `src/platform/darwin/window-create.ts`, whose
  over-constraint is visible at lines 94–101 (four edge constraints plus `shim_constraint_simple(web,
  7n, …, width)` and `8n, …, height`, a fixed width and height on top of the edges).

## Ranked findings

### 1. Linux — window cannot be shrunk vertically once `minWidth` is set (defect, medium)

`src/platform/linux/shim/40_window.c:73`

```c
	if (min_w > 0) shim_set_size_request(win, min_w, h);
```

The size request is applied to the **window** with two numbers, and the second is the *initial*
height `h`, not a minimum. A window opened 900×600 with `minWidth: 400` therefore has a 400×**600**
floor: the user can drag it narrower but never shorter than the height it happened to open at. It is
not the macOS failure (the page still fills the window at whatever size it reaches), it is a stuck
dimension in the other direction.

Second half of the same line: `minHeight` never reaches the shim.
`src/platform/linux/backend.ts:102-107` passes `options.minWidth ?? 0` as the fourth argument and has
no height parameter, so a configured `minHeight` is silently dropped on Linux — the opposite of
Windows, which applies both (`src/platform/windows/window-open.ts:87`).

Smallest fix: pass `minHeight` as a fifth argument and call
`shim_set_size_request(win, min_w > 0 ? min_w : -1, min_h > 0 ? min_h : -1)` — `-1` is GTK's "no
request on this axis", which is what removes the accidental height floor when only a width is
configured. No page-sizing change is needed.

### 2. Windows — `WM_DPICHANGED` is not handled (latent, low; not a defect today)

`src/platform/windows/shim/20_class.c:23-31` handles `SHIM_WM_SIZE` only, and `rg 'SHIM_WM_|DPI'` over
`src/platform/windows/shim/` finds no `0x02E0` handler and no `SetProcessDpiAwareness` call anywhere.
An unaware process gets no `WM_DPICHANGED` at all (the OS bitmap-scales it), which matches
`src/platform/windows/shim/47_screen.c:6` ("`scale` is 1.0: per-monitor DPI needs …"). So there is no
mis-sized page today. If DPI awareness is ever turned on, the suggested rect must be applied **and**
the bounds re-read, because that is the one case where the client rect and `LPARAM` disagree — the
comment at line 24 already records that, which is why the handler ignores `LPARAM`.

No fix required now. If awareness lands, add a `WM_DPICHANGED` case that does `SetWindowPos` to
`((RECT *)lp)` and then re-runs the same `GetClientRect` + `shim_webview_put_bounds` pair.

### 3. No platform-neutral re-apply (correct)

`window-state` restore is the only shared code that sets a size after creation:
`src/plugins/window-persist.ts:139-142` calls `setSize` then `setPosition`, and
`frames()` refuses an adapter missing any of the four members (lines 119-125). That adapter is created
only in the darwin branch — `src/runtime-plugins.ts:176`
`createWindowStatePlugin({ native: windowAdapter })`. On Windows and Linux
`src/runtime-non-darwin.ts:49` registers the bare `windowStatePlugin`, and
`src/plugins/window-persist.ts:192` builds it with no `native`, so every command answers
`missingWindow` (`src/plugins/window-state.ts:24`). Nothing on either platform can restore a stale
size, so the macOS class of bug cannot reappear through this path.

## What proves Windows is correct

Every resize cause — drag from any corner, maximise, restore — arrives as `WM_SIZE`; the handler does
not care which, and it reads the rectangle instead of trusting the message:

`src/platform/windows/shim/20_class.c:22-31`

```c
shim_i64 shim_wndproc(shim_h hwnd, unsigned int msg, shim_u64 wp, shim_i64 lp) {
	if (msg == SHIM_WM_SIZE) {
		// The client rect is the authority, not LPARAM: a DPI change reports a stale pair there.
		int rect[4];
		// A failed call leaves all four ints indeterminate; resizing to that garbage is worse
		// than skipping the resize. shim_window_client_num checks the same call below.
		if (!GetClientRect(hwnd, rect)) return 0;
		shim_webview_put_bounds(hwnd, (double)(rect[2] - rect[0]), (double)(rect[3] - rect[1]));
		return 0;
	}
```

- **Client rect, not window rect.** `GetClientRect` is what the page is sized from, so the page is not
  offset under the title bar nor short by the frame. The initial size agrees:
  `src/platform/windows/shim/42_webview.c:78-84` (`shim_webview_size`) reads the same two components
  via `shim_window_client_num(hwnd, 2|3)`, which is `rect[2]-rect[0]` / `rect[3]-rect[1]` at
  `src/platform/windows/shim/40_window.c:45-46`.
- **A size arriving before the controller exists is a no-op, not a null dereference.**
  `src/platform/windows/shim/42_webview.c:26-30`:

```c
int shim_webview_put_bounds(shim_h hwnd, double w, double h) {
	int i = find_window(hwnd);
	if (i < 0) return 0;
	return wv2_put_bounds(g_ctrl[i], w, h);
}
```

  The slot table only holds an hwnd after `shim_webview_bind` (lines 57-74), and
  `shim_window_new` shows the window (`ShowWindow` + `UpdateWindow`, `40_window.c:16-17`) *before*
  `window-open.ts:102` creates the controller — so the first `WM_SIZE` genuinely does arrive early and
  genuinely is skipped.
- **Same thread.** `shim_pump` (`10_prelude.c:168-178`) runs `PeekMessageW`/`DispatchMessageW` from the
  Bun-owned thread on a timer (`platform.ts:3`), which is the thread that created the controller, so
  `put_Bounds` from inside the window procedure is on the thread the controller is affine to
  (`40_window.c:50-52`).

## What proves Linux is correct

The webview is added as the window's child and GTK allocates it the full content area; no size request
is placed on the *webview* anywhere.

- `src/platform/linux/shim/40_window.c:92-98`:

```c
int shim_window_attach(void *win, void *child) {
	if (!win || !child || !shim_container_add) return 0;
	// GTK_CONTAINER is a cast macro and GtkWindow is a GtkContainer, so the
	// pointer is the same address with no wrapper built.
	shim_container_add(win, child);
	return 1;
}
```

  `GtkWindow` is a `GtkBin`, so its single child is allocated the window's content allocation on every
  resize — the same relationship macOS is supposed to have.
- The webview itself is created bare and never given a request: `src/platform/linux/shim/30_webview.c:140-150`
  (`shim_view_new()`, then two signal connections, and nothing else). `gtk_widget_set_size_request` is
  resolved at `40_window.c:20` and called at exactly one site, line 73 — the window, not the child
  (finding 1).
- No `gtk_window_set_resizable` call exists in `shim_gtk_resolve` (`40_window.c:15-25`), so the window
  keeps GTK's default resizable behaviour.

## Not determined

- Whether WebView2 actually honours `put_Bounds` at the sizes measured (a maximise to a very large
  client area) — that needs a Windows machine.
- Whether GTK 3's allocation reaches the webview on the first frame after a drag, or one frame late.
  Nothing in the code suggests a delay; nothing here proves the absence of one.
- Both platforms' behaviour under a compositor/window-manager that resizes asynchronously (Wayland
  tiling, Windows snapping) — same reason.
