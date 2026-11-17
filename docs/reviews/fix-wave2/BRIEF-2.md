# Two fixes, one file set each

Read `../fix-wave/BRIEF.md` first for house rules. Both of these are behaviour changes the owner
asked for directly: they must not change what a user sees, only what the code guarantees.

## Lane A — the bridge token stops being served to anything that asks

`20-security.md` finding 1, left open by the bridge lane. Today `GET /` returns the document with
the bearer token inline, and any local process may fetch it. That makes the token decorative.

Nothing about the page changes. What changes:

- `windowUrl` (and the create path in `src/plugins/window-create.ts`) appends `?token=<token>` to
  the bridge-served URL, the same way it already appends `?window=<label>`.
- The document route requires that token before serving the document. A request with none, or a
  wrong one, answers `401`. A dev-server page (`dev.url`) is served by Vite, not the bridge, so it
  is untouched and the bridge still accepts it.
- The page reads its own `token` from `location.search` exactly as it already reads `window`, so
  `window.crust.invoke` keeps working with no change to any app's code.
- `BridgeFactory` must supply the token, not only the URL — `app.ts` can already defer the bridge
  and needs the handle rather than the url string.

Files you own: `src/app-loop.ts`, `src/app.ts`, `src/app-types.ts`, `src/bridge/server/handler.ts`,
`src/bridge/server/assets.ts`, `src/bridge/client/bootstrap.ts`, `src/bridge/window-identity.ts`,
`src/plugins/window-create.ts`, `src/runtime.ts`, and their tests.

Bring the limits-page Security section and `docs/agents/bridge.md` up to date — that section now
describes a boundary that will exist.

## Lane B — `minWidth`/`minHeight` on Windows

`02-windows.md` finding 5's neighbour: darwin honours `minWidth` (`shim_window_set_min_size`), and
`validate-windows.ts` accepts `minWidth` — but Windows ignores both, and `minHeight` is not in
`WindowConfig` at all, so there is no key for any platform to honour.

- Add `minHeight` to `WindowConfig` and to `WINDOW_KEYS`, validated as a positive integer.
- darwin: honour `minHeight` in `shim_window_set_min_size`.
- Windows: add `WM_GETMINMAXINFO` (`0x0024`) to the window procedure and set
  `ptMinTrackSize` from the window's configured minimum. The shim needs the minimum per HWND, so a
  `g_min[SHIM_MAX_WINDOWS]` pair beside `g_hwnd`, set by `shim_window_new` or a small setter.
- Clamp on create too: a configured `width` below `minWidth` must not open a window smaller than
  its own minimum.

Files you own: `src/config/types.ts`, `src/config/validate-windows.ts`,
`src/platform/windows/shim/*.c`, `src/platform/windows/window-open.ts`,
`src/platform/windows/platform.ts`, `src/platform/darwin/window-create.ts`,
`src/platform/darwin/shim/*.c`, and their tests.

The Windows shim has no machine here: prove the C compiles with the assembled-source trick in
`docs/agents/windows-fixes.md` (`clang -fsyntax-only` on the joined `shimSource`), and gate the
behaviour with a source assertion the way `shim-resources.test.ts` already does.
