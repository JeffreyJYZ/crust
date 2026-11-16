# Changelog

Newest first, one line per entry. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow semver.

`0.1.21` is the last published package version and the last `chore:` release commit; the last git tag is `v0.1.9`, so every version heading below is read from the release commit rather than a tag. The wave after `0.1.21` has no version and no tag, so it stays under `Unreleased` until the owner cuts one.

## Unreleased

### Added

- `theme` plugin — `current`/`set`/`reset` plus a `theme:changed` event for light, dark or system, read back from the app rather than remembered.
- `dock` plugin — `badge`, `badgeLabel`, `bounce` and `progress` (a determinate bar, not a spinner).
- `power` plugin — `state` (battery, AC, low-power flag), `idleSeconds`, and `sleepPrevent`/`sleepAllow` with the assertion released on exit.
- `accessibility` plugin — `trusted` (the AX trust read), `prompt` (the one system prompt) and `elementCount` over the app's own tree.
- `navigation` plugin — `start`/`stop`/`state`/`reload`/`goBack`/`goForward` and four `navigation:*` delegate events, which need `start` before they fire.
- `findinpage` plugin — `search`/`next`/`previous` over `WKWebView` find.
- `downloads` plugin — `list`/`start`/`cancel`/`directory`/`setDirectory` over `WKDownloadDelegate`, four `download:*` events, and a destination confined to the app's data root.
- `network` plugin — `rules`/`setRules`/`log`/`clearLog` over a `WKURLSchemeHandler` with a 100-entry log, first rule wins, no match allows, one metacharacter (`*`) so no regular expression reaches the main thread.
- `crash-reporter` plugin — `last`/`list`/`clear`/`install`/`uninstall`, with records written by a second guard process from a fixed 84-byte little-endian layout.
- `i18n` plugin — `locale`/`setLocale`/`messages`/`translate` with `{name}` interpolation and `_one`/`_other` plurals.
- `store` plugin — `get`/`set`/`delete`/`keys`/`clear`/`save` over one atomic `0600` JSON file, with a corrupt file quarantined instead of overwritten.
- `stronghold` plugin — `open`/`set`/`get`/`delete`/`keys`/`close`, PBKDF2-SHA256 at 600 000 iterations plus AES-256-GCM, and no plaintext in the file.
- `fs.scope` — `list`/`allow`/`revoke` with grants persisted in `scope.json`, so a page can be granted a folder for longer than one launch.
- `window` chrome commands — `setOpacity` and `setDecorations` alongside size, position, always-on-top, fullscreen, minimize, maximize and cursor.
- `menu` plugin — `setAppMenu`/`showContext`/`reset`, plus `read()` which answers what `NSApp.mainMenu` actually holds.
- `positioner` plugin — nine presets: center, four corners and four edge midpoints, each read from the screen the window is on.
- `window-state` plugin — `save`/`restore`/`forget` plus `saveAll`/`restoreAll`/`forgetAll` across every tracked window.
- `updater` plugin — `check`/`download`/`install`/`relaunch` with sha256 and Ed25519 verification, an atomic bundle swap and an `open -n` relaunch.
- `single-instance` plugin — `acquire`/`release`/`activate`, with the runtime locking `app.id` at launch.
- `deep-link` plugin — `scheme`/`url`, `build.urlScheme` written into `CFBundleURLTypes`, and the launch URL claimed in `app.start()`.
- `autostart` plugin — `enable`/`disable`/`isEnabled` over a launch agent.
- `clipboard` image half — `readImage`/`writeImage` carrying PNG bytes, round-tripped through `readObjectsForClasses:[NSImage]`.
- `opener` plugin — `openPath`/`openUrl`/`revealItem`.
- `os` plugin — `info` (family, arch, version, uptime, executable extension), `locale` and `paths`.
- `shortcuts` plugin — `register`/`unregister`/`unregisterAll`/`isRegistered`/`list` over Carbon hot keys.
- `shell` plugin — `spawn`/`output`/`write`/`close`/`kill`/`list`, a stdin pipe, `shell-output` events bounded at 500 lines per stream, and a config allowlist.
- `logging` plugin — `setLevel`/`level`/`write`/`tail` with a trace level and rotation at 1 MiB into `app.log.1`.
- `dialog.save` — a save panel beside the open panel, shown as a sheet so an invoke issued while it is up is still answered.
- Linux platform — `src/platform/linux/` drives GTK3 and WebKitGTK through `bun:ffi`, resolving every symbol by hand-written prototype through C-side `dlopen`/`dlsym`, with `createPlatform(config, backend)` injecting a fake for tests.
- Windows platform — `src/platform/windows/` drives Win32 and WebView2 through seven C units joined in load order, with a named C helper per COM slot because a bare function pointer cannot reach one.
- `loadPlatform` now dispatches `darwin`, `linux` and `win32`, each arm importing its own barrel, with a named error for anything else.
- TypeScript extensions — an `extensions` config key, `crust/extension` and `crust/extensions` exports, `crust build` embedding the imports plus `registry.register(…)` into the generated entry, and `crust dev` loading them from disk so the dev server runs the same files a build embeds.
- `crust package --format dmg|appimage|nsis` and `crust notarize` — one line per format, exit 1 for a missing tool without throwing, so the other formats still build.
- `crust doctor` extensions block, reusing the same `describeExtensions` report the extensions command prints.
- `examples/parity-probe` and `bun run e2e:parity` — a built app that proves twenty native surfaces with twenty-seven assertions, printing each surface's real answer.
- `bun run check:parity` — pins Tauri's official feature names against the parity rows, so a surface cannot vanish from the matrix unnoticed.
- CI gained `gate (ubuntu)` and `gate (windows)` jobs: each installs or finds the real libraries and runs a smoke that opens a real window and pumps twice.
- `bun run e2e:linux` — a host-side driver that asks the OrbStack `ubuntu-sandbox` machine what it has, installs only the gap, streams the layer in, then runs the unit suite and the real-GTK smoke under `xvfb-run`.
- Docs — fifteen surface guides, `reference/platforms`, and the parity matrix at 42 rows.

### Changed

- `src/plugins/index.ts` split into `barrel-{core,platform,data,system}.ts`; all 81 value exports are preserved and `barrel.test.ts` lists every one, because an ambiguous `export *` drops a name from the namespace silently.
- `src/cli/index.ts` reduced to dispatch; `parse.ts`, `usage.ts` and `commands.ts` now own argv, help text and the name-to-handler map, and a test asserts every command appears in `--help`.
- `src/runtime.ts` split — `StartAppOptions` moved to `src/runtime-options.ts`, and extensions are registered in `startBridgeFor` so they land in the same table the bridge serves.
- `navigation`, `findinpage`, `downloads`, `network`, `crash-reporter` and `i18n` moved from module-only to registered by the macOS runtime and exported from the split barrels; no parity row carries "module only" any more.
- `fs` rewritten around `fs-scope.ts`; `shell` rewritten around `shell-args.ts`, `shell-stdin.ts` and `shell-stream.ts`; `updater` split into manifest, signature, node and install modules.
- `menu` now reads back through `menu-read.ts` and `98_menu_read.c`, so the command answers AppKit's state rather than the request it sent.
- `shortcuts` maps accelerators to Carbon key codes in `shortcut-keycodes.ts` and exposes a `dispatch` seam, which is what the parity probe fires.
- The parity page went from 32 to 42 rows; the ten Tauri-less surfaces print as `unlisted 10` rather than failing the check.
- `crust build` embeds extensions in the generated entry, and a build with no extensions stays byte-identical to the pre-change wrapper.
- Single-file mode now refuses a project that has extensions, naming the file it found and the `crust dev --dir <project>` command that can carry it, instead of dropping the extension silently.
- `examples/parity-probe` proofs split by area (`proofs-window`, `proofs-keypress`, `proofs-system`, `proofs-update`, `proofs-data`, `proofs-io`, `proofs-state`), so a proof is a file rather than a growing `main.ts`.

### Fixed

- The crash record is written through a variadic `open` declaration; the fixed three-argument prototype made TinyCC drop the mode, so the file landed `0000` and the guard read it as `EACCES`.
- `store.save` writes a temporary file and renames it, so a crash mid-write leaves the previous `store.json` intact instead of a truncated one the next read would quarantine.
- `startCrashGuard` truncates the record before arming, so an earlier run's crash cannot be reported as this one's.
- `downloads` and `fs.scope` resolve a destination before the containment check, so a sibling whose name merely starts with the data root is refused instead of accepted.
- `crash-reporter` catches the guard's refusal at registration, so a compiled app answers its own named refusal instead of dying before a window exists.
- `dock.setBadge("")` no longer throws `bun:ffi cannot convert argument to 'ptr'`: `bytesOf` answers `{ address: 0, length: 0 }` for an empty label instead of handing `ptr()` a zero-length buffer, and the probe now prints `dock badge="…" read="…" cleared=true`.
- A crust window now appears in AppKit's accessibility tree for other processes. AppKit lists only windows on the active Space, and a window joins that Space only when its app is active — while `-[NSApplication activate]` is silently refused for a process LaunchServices did not launch, which is how `crust dev` and the parity harness run. `window-create.ts` sends `-activateIgnoringOtherApps:` when the app is not already active, guarded on `isActive` so a second window does not pull the app forward; a directly-executed app cannot become active through `activate`, which is why the pre-14 call is the one used. Measured on the same window from a separate trusted process: `external=windows:0,children:-1` before, `external=windows:1,children:4` after.
- The generated extension entry registered `undefined` — it emitted a default import and then passed `extension0.default` to `registry.register`; it now passes `extension0`, and a test executes the generated entry against the real registry so the shape cannot regress.

### Security

- `network` matching folds both sides to lower case on darwin and win32, where the filesystem compares case-insensitively, so a `block` rule cannot be dodged by changing the case of a host or path; Linux keeps the byte-wise compare, because `/Etc/Hosts` and `/etc/hosts` are two files there.
- A request URL at or over the handler's 2047-byte buffer is blocked and logged rather than matched on a truncated prefix.
- `shell.spawn` matches the allowlist as basenames and requires a path-form program and every `cwd` to resolve inside the configured root, answering `program-outside-root` or `cwd-not-allowed` before any process exists.
- `stronghold` refuses a store whose recorded KDF iteration count is not a positive integer before a key is derived from it.

### Removed

- The page-serving `crust://` scheme on Linux — `35_scheme.c`, `scheme-page.ts` and the backend `registerScheme`/`register` member are deleted, because darwin never had one and `urlScheme` belongs to the app's own deep links.
- The page-serving `crust://` scheme on Windows — removed the same way, so a window navigates on the URL it was created with, which is the value darwin hands to `-loadRequest:`.

### Limits

- Linux is proven on real GTK: `bun run e2e:linux` on `ubuntu-sandbox` (Ubuntu 25.10 arm64) prints `e2e:linux: PASS 8/8 assertions` — both sonames load, `gtk_init_check` returns 1, a real `GtkWindow` and `WebKitWebView` are created and shown, seven `g_main_context_iteration` slices run, C-side liveness still reads 1, and `quit()` ends the process with 0; the unit suite in that VM is `30 pass, 1 skip, 0 fail`.
- What Linux still does not prove: no document is rendered (`about:blank`), so no page JS and no `invoke`; window-close pruning, multi-window and packaging are untested there.
- Windows remains unproven on Win32: every test injects a fake backend, and no `user32`, `ole32` or WebView2 call in this tree has executed.
- On Windows every vtable index is read from `WebView2.h`'s declaration order and none has been checked against a live object, and the hand-written `WNDCLASSEXW`/`MSG` sizes have no header to agree with.
- The Windows CI smoke proves the window opens and pumps twice; it does not read a loaded document, run page JS or cross `invoke`, and it prints that in its own output.
- Notarization is code-complete but unproven: it needs a Developer ID Application certificate and a `notarytool` credential, and it refuses before any bundle lookup rather than pretending.
- `network` intercepts only requests under its own `crust-net` scheme; a page served from the bridge URL is not intercepted, and a `WKURLSchemeHandler` has no pass-through.
- `findinpage.matches` is 0 or 1, never a total, because `WKFindResult` carries only `-matchFound`; `clear()` refuses naming the private `-_clearFindIndicator`.
- `crash-reporter` refuses inside a compiled binary — the guard is a second Bun process needing a readable copy of its own file, so `startCrashGuard` answers `not-implemented` naming "a source checkout".
- A physical key press reaching a Carbon hot key is unproven: the probe fires the adapter's `dispatch` seam, which proves the grab was accepted and the process-side chain, not the window server's table.
- `downloads`, `findinpage` and `navigation` resolve their webview from `windowLabels()[0]`, so they act on the first window only; a second window is not covered.
- `i18n.setLocale` is in-memory because macOS owns the language list; a single-file build carries no extensions, and now says so instead of dropping them.
- `minWidth`/`minHeight` do nothing on Windows (`WM_GETMINMAXINFO` is unhandled), and no DPI-awareness declaration exists in that layer, so bounds come from `GetClientRect` in physical pixels.

## [0.1.21] — 2026-11-15

### Added

- Single-file `.html` mode — `crust dev page.html` and `crust build page.html` copy the document verbatim as `index.html` instead of treating it as a module entry.
- A docs site under `site/`, built on `@ui-sdk/react` and deployed at `crust.jyz.land`.

### Changed

- The install page pins `bunx crust@v0.1.21` rather than a floating version.
