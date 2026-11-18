# Changelog

Newest first, one line per entry. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow semver.

`0.1.21` was the last published package version and the last git tag before this one. `0.1.22` is the wave that made Windows work, proved the three installers by artefact, and shipped the standalone release pipeline.

## [0.1.26] — 2026-11-18

### Added

- **Every Butter capability, closed and driven.** Typed IPC over a shared `InvokeMap`, `build.sidecars`, window material (vibrancy/mica/acrylic/tabbed), Svelte and Vue scaffolds, plain-HTML hot reload, lifecycle events with `app.info()`, screen listing, all six power events, devtools behind a dev-only flag, a page-facing SQLite surface, the OS keychain, `i18n.load(directory)`, and `app.icon` applied to the dock. Two premises in the parity briefs were wrong and are stated rather than papered over: dock badges are text-only in Butter too, and tray rows already replaced in place.
- `accessibility.announce`/`title`/`focus` post `NSAccessibility` announcements and move assistive focus — platform accessibility was a namesake before, able to read whether the tree was exposed but unable to speak through it. Linux and Windows refuse `announce` by name rather than pretending `NotifyWinEvent` is speech.
- `network.status`/`onChange` answer connectivity through `SCNetworkReachability`, beside the URL-scheme interceptor that answers a different question.
- `crash-reporter.report`/`configure`: a caught error in the page now writes a record through the guard's own store, tagged `webview`. Butter's `crash:configure` also takes an upload URL and crust deliberately does not — a crash reporter that uploads is the app's privacy decision.
- `sidecar.write`/`list`/`kill` with a real stdin pipe and a SIGTERM-then-SIGKILL grace; `fs.readBinary`/`writeBinary`/`mkdir` through the same scope check; `tray.setTooltip`; `store` named stores; `logging.configure({ file?, level? })`.
- **A CSP nonce.** The bridge mints 16 random bytes per document and stamps its own bootstrap and any authored inline `<script>` with it, so `script-src` is `'self'` plus that nonce and an injected tag is refused. `style-src` keeps `'unsafe-inline'`: inline styles are not the script-injection door.
- **A capability grant in every scaffold.** Each template's `crust.config.ts` grants its own `app:invoke`, and the test derives that from the page's own `invoke(…)` calls, so a template cannot drift from what it ships.
- **A content world for the token.** The credential and the invoke implementation live in a `WKContentWorld` the page cannot read or replace; the page gets one function, `window.crustInvoke`. Linux, Windows and Vite keep the fetch path.

### Changed

- Live parity evidence replaces the table as the proof: 101 of 110 mapped commands are driven against the real darwin platform, and the nine that remain each carry a written reason a headless runner cannot act on them.
- The parity page states the two settled differences outright — the loopback transport and the isolation pattern — with the reasoning that decided them.

### Fixed

- **`shim_keychain_get` never worked.** It built the class/service/account query and then a second dictionary holding only `kSecReturnData` and `kSecMatchLimit`, and searched with the second — a query naming no class says nothing about what to look for, so every read answered `-3` and a secret written by `set` could never be read back. The plugin suite passed because its fake adapter never ran the C.
- **`shim_keychain_list` killed the process.** Without `kSecReturnAttributes` the result is an array of item refs, and `CFDictionaryGetValue` on a non-dictionary is not an error code but a C++ exception. `CFArrayGetCount` was also declared `void*`, truncating a `long` on any caller that reads it.
- **`platform.quit()` left the process alive with every window gone for 40 s.** `applicationShouldTerminate:` defers with `NSTerminateLater` for a `before-quit` watcher — right for a user's Cmd-Q, wrong for a deliberate quit — so `quit()` now marks the termination deliberate and AppKit answers `NSTerminateNow`.
- **The sidecar manifest sat in `Contents/MacOS`**, where it is nested code to `codesign`, so every packaged build failed the ad-hoc sign with "code object is not signed at all". It now lands in `Contents/Resources`; Linux and Windows keep the flat path.
- **`tray.setTooltip` and `navigation.loadUrl` answered not-implemented on macOS** — both rows said `same` once the plugin half existed while the native setter did not.
- **The page could not hear `app:activate` or `app:before-quit`** — nothing emitted them through the bridge; the lifecycle drain now publishes `app:*` to every armed sink from the same loop that awaits the backend listeners.
- **The dev-react probe sent no window label**, so with templates declaring capabilities the bridge refused it as `app:invoke is not granted to a request with no window label`. That refusal was the gate working — a real dev page loads `?window=main` — so the probe now sends the field and the gate stayed as strict as it was.
- Four defects the e2e runs caught and the unit suite could not: the bootstrap was passed a whole `<script>` element to a function that already wraps its snippet, so the document shipped `<script><script>` and the page threw before `window.crust` existed (0 of 61 answers); `webviewConfiguration()` is one shared object whose controller WebKit copies into each webview, so the content-world bridge installed twice and the second copy scrubbed the token the first needed (a 401 race); and single-file mode's dev poller called `location.reload()`, which now loses `?token=`, so it re-imports the rebuilt module cache-busted instead.

## [0.1.25] — 2026-11-17

### Added

- **A permission model.** `security.capabilities` names a set of actions (`fs:*`, `dialog:openPanel`, `shell:spawn`), `security.grants` gives those capabilities to window labels, and the bridge checks before a handler runs — so a plugin cannot forget the gate and a third-party extension inherits it. Absent config allows every command, which is the one compatibility guarantee; present config denies by default, and a window label with no grant holds nothing. A refusal is a new `forbidden` (403) naming the action, the window, and the capability that would have allowed it. This is authorisation, not a sandbox: a label holding `fs:*` may reach every path the `fs` plugin can.
- New guide at `/docs/guides/permissions`, and the parity page gains six framework-guarantee rows.

### Changed

- **The bridge token is no longer served in the document.** It used to sit in the inline bootstrap of a token-free route, so any local process could `GET /` and read the credential the token exists to protect. It now rides the navigation URL the platform hands to the webview, the page reads it from `location.search` the way it already read its window label, and the document route answers `401` without it. The served HTML contains no token at all, which `server-document.test.ts` asserts directly.
- A page-created window naming an absolute URL on the app's own bridge now receives the token too — a page that builds one from `location.origin` names a path, not a different app, and the document route refuses it without the credential. A foreign origin is untouched, so the token never leaves the app's own origin.

### Fixed

- `minWidth`/`minHeight` constrain the window on every platform: `minHeight` was not a config key at all, and Windows ignored both because `WM_GETMINMAXINFO` was unhandled. The drag floor is the configured minimum, not the create size.

## [0.1.24] — 2026-11-17

### Fixed

- **Asset route traversal on Windows** — the guard split on `/` only, so a `%5c` segment decoded after the URL parser ran and `join(root, "..\\secret")` read outside the frontend root with no token. Both separators are now refused, and the resolved path is bounded against the root.
- **Script injection through a window label** — the injected bootstrap passed the label through `JSON.stringify`, which leaves `</script>` intact, so `?window=</script><script>…` ran in the bridge origin. `<`, `>`, U+2028 and U+2029 are escaped before the script body.
- **`crust.ready` never settled after a failed first invoke** — the handshake resolved only on success, so a wrong token, an unknown command or a non-JSON reply left `await crust.ready` pending forever.
- **Reserved JSON keys corrupted results** — a handler returning `__crustBytes` as data was turned into a `Uint8Array`, and a `__proto__` field changed the object's prototype instead of surviving as a field.
- **Every SSE disconnect leaked a cleanup** — `detached()` never removed itself, retaining a controller and subscriber per reload for the process lifetime.
- **The Windows frame scanner skipped the arrays it exists to catch** — pointer elements, 2-D bounds, initialisers and multiple declarators all returned no offence, each of them the 4096-byte `__chkstk` frame that crashes at 0xFFFF…F.
- **A failed window create burned a WebView2 slot permanently** — the error path never called `shim_webview_close`, so eight retries bricked window creation for the process.
- **The Windows and Linux pumps counted JS timer ticks as native iterations**, so a smoke that never pumped printed PASS.
- **A closed window resurrected as open after Cmd+H** — `appHidden` was ORed into liveness, and `-windowNumber` never clears after `-close`.
- **Four NSWindow action selectors were sent without their sender argument.**
- **A dangling symlink escaped both path scopes** — `realpath` failed on the missing target, the fallback re-appended the link's own name, and `Bun.write` followed it outside the sandbox.
- **A refused native call was reported as success** — `sleepAllow`, `shortcut.unregister`, `crash-reporter.uninstall`, `theme.set`, `power.state` and `accessibility.prompt` each had a working failure channel and ignored it.
- **Log levels were inverted** — `trace` was the lowest severity, so at `info` the chattiest line was written and `debug` was dropped.
- **A value flag consumed a following `--help` as its value** — `crust init --dir --help` created a directory named `--help`; help and version now short-circuit before validation.
- **`crust doctor` false-failed `.html`/`.ts`/`.js` single-file apps.**
- **Single-file React mounting accepted React 17** and then called the React 18 API.
- **A throwing `window-all-closed` listener left the app running with every window gone.**
- **Crash handlers never armed at launch**, so an app that did not call `crash-reporter.install` recorded nothing.
- **`store.json` ignored `app.id`** — every crust app shared one file.
- **`spctl -t install` assessed an `.app`** and reported a stapled, notarized bundle as failed.
- **NSIS shipped all of `dist`** — the macOS `.app`, stray AppImages and earlier installers went into a Windows install.
- **A failed release build left a public, partial release** — now a draft until every leg builds and `verify` passes.
- **The updater hashed only basenames**, so two different bundles could share one tree digest; the zip reader trusted attacker-controlled lengths; `download` followed redirects and never bounded the body.
- **Native extensions hardcoded macOS** — `.dylib` naming and `clang -dynamiclib` on all three platforms, `findTool` blind to `.exe`, and no ABI check before binding a dylib.
- **`shell.cwdRoot` accepted a relative path** and `app.id` accepted separators, each resolved against a different base by different consumers.

### Added

- `bun run test` covers the release tooling and the docs-reference truth tests, which were unreachable from the gate before.

## [0.1.23] — 2026-11-17

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
- `window.label` — answers which window the calling request came from, carried as `?window=<label>` on the window's URL and handed to the handler as `ctx.window`, so two pages on one bridge each read their own label and a page with no identity is refused by name.
- `app.activate` config — `always` (the default), `first` or `never`, deciding whether a window create brings the app forward, which is what puts a window on the active Space and therefore into AppKit's accessibility tree.
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
- Windows platform — `src/platform/windows/` drives Win32 and WebView2 through ten C units joined in load order, with a named C helper per COM slot because a bare function pointer cannot reach one. The shim links nothing: TinyCC's PE import thunk jumped to `0xFFFFFFFFFFFFFFFF` on the first DLL call, so `12_win32.c` loads `kernel32`, `user32` and `ole32` with `LoadLibraryA` and binds twenty-five entry points with `GetProcAddress`, leaving only `_LoadLibraryA` and `_GetProcAddress` unresolved, and `shim_win32_ready()` names a missing export instead of calling a null pointer. The WebView2 loader is resolved the same way, so a machine without it costs one symbol rather than the whole shim.
- `loadPlatform` now dispatches `darwin`, `linux` and `win32`, each arm importing its own barrel, with a named error for anything else.
- TypeScript extensions — an `extensions` config key, `crust/extension` and `crust/extensions` exports, `crust build` embedding the imports plus `registry.register(…)` into the generated entry, and `crust dev` loading them from disk so the dev server runs the same files a build embeds.
- Zig, Rust and C extensions — `extensions/*.{zig,rs,c}` compiled to a dylib with `zig build-lib`, `rustc --crate-type cdylib` or `clang -dynamiclib`, emitted under the name `bun:ffi` later opens, with generated typed bindings and a `crust doctor` block naming a missing toolchain.
- `bun run e2e:native` — compiles a Zig and a Rust extension with the real toolchain, loads both in `crust dev`, and waits for the page's `window.crust.invoke` to reach each dylib and come back, so a dylib that fails to dlopen shows as a missing answer instead of a passing argv assertion.
- `crust package --format dmg|appimage|nsis`, `crust sign` and `crust notarize` — one line per format, exit 1 for a missing tool or certificate without throwing, so the other formats still build; `sign` refuses before reading the bundle rather than signing something it cannot verify.
- `crust doctor` extensions block, reusing the same `describeExtensions` report the extensions command prints.
- `examples/parity-probe` and `bun run e2e:parity` — a built app that proves each native surface at runtime, printing the surface's real answer rather than that it links.
- `bun run check:parity` — pins Tauri's official feature names against the parity rows, so a surface cannot vanish from the matrix unnoticed.
- CI gained `gate (ubuntu)` and `gate (windows)` jobs: each installs or finds the real libraries and runs that platform's own smoke against them, so a missing symbol is a job failure rather than a claim.
- `bun run e2e:linux` — a host-side driver that asks the OrbStack `ubuntu-sandbox` machine what it has, installs only the gap, streams the layer in, then runs the unit suite and the real-GTK smoke under `xvfb-run`.
- `bun run e2e:package` — builds a real `.dmg` from a compiled app, mounts it, checks the one-drag `Applications` link, verifies the checksum with `hdiutil verify`, and proves `crust sign` refuses without a certificate while leaving the bundle's hash and seal untouched.
- `bun run e2e:appimage` — builds a real AppImage on Linux and asserts the artefact rather than the line it prints: an ELF with the AppImage type-2 magic, an executable bit, a size floor, and the AppDir `--appimage-extract` gives back — `AppRun`, the binary it names, the desktop entry and the icon; `gate (ubuntu)` installs `appimagetool` and runs it.
- `bun run e2e:package:nsis` — builds a real installer on Windows, runs it silently with `/S` into a temp directory, and asserts the installed executable and uninstaller, in its own `package (windows)` job so the WebView2 smoke can neither mask it nor be masked by it.
- Docs — fifteen surface guides, `reference/platforms`, and the parity matrix at 42 rows.

### Changed

- `src/plugins/index.ts` split into `barrel-{core,platform,data,system}.ts`; all 81 value exports are preserved and `barrel.test.ts` lists every one, because an ambiguous `export *` drops a name from the namespace silently.
- `src/cli/index.ts` reduced to dispatch; `parse.ts`, `usage.ts` and `commands.ts` now own argv, help text and the name-to-handler map, and a test asserts every command appears in `--help`.
- `src/runtime.ts` split — `StartAppOptions` moved to `src/runtime-options.ts`, and extensions are registered in `startBridgeFor` so they land in the same table the bridge serves.
- `navigation`, `findinpage`, `downloads`, `network`, `crash-reporter` and `i18n` moved from module-only to registered by the macOS runtime and exported from the split barrels; no parity row carries "module only" any more.
- `fs` rewritten around `fs-scope.ts`; `shell` rewritten around `shell-args.ts`, `shell-stdin.ts` and `shell-stream.ts`; `updater` split into manifest, signature, node and install modules.
- `menu` now reads back through `menu-read.ts` and `98_menu_read.c`, so the command answers AppKit's state rather than the request it sent.
- `shortcuts` maps accelerators to Carbon key codes in `shortcut-keycodes.ts` and exposes a `dispatch` seam, which is what the parity probe fires.
- The parity page went from 32 to 42 rows — 32 same, 8 via Bun, 2 partial, none module-only — because crash reporting became `same`: the runtime starts the guard and a compiled binary re-runs its own executable in guard mode, so an app takes no step. The ten Tauri-less surfaces print as `unlisted 10` rather than failing the check.
- `crust build` embeds extensions in the generated entry, and a build with no extensions stays byte-identical to the pre-change wrapper.
- Single-file mode now refuses a project that has extensions, naming the file it found and the `crust dev --dir <project>` command that can carry it, instead of dropping the extension silently.
- `examples/parity-probe` proofs split by area (`proofs-window`, `proofs-keypress`, `proofs-system`, `proofs-update`, `proofs-data`, `proofs-io`, `proofs-state`), so a proof is a file rather than a growing `main.ts`.

### Fixed

- The crash record is written through a variadic `open` declaration; the fixed three-argument prototype made TinyCC drop the mode, so the file landed `0000` and the guard read it as `EACCES`.
- `store.save` writes a temporary file and renames it, so a crash mid-write leaves the previous `store.json` intact instead of a truncated one the next read would quarantine.
- `startCrashGuard` truncates the record before arming, so an earlier run's crash cannot be reported as this one's.
- `downloads` and `fs.scope` resolve a destination before the containment check, so a sibling whose name merely starts with the data root is refused instead of accepted.
- `crash-reporter` catches the guard's refusal at registration, so an app answers a named refusal instead of dying before a window exists.
- `dock.setBadge("")` no longer throws `bun:ffi cannot convert argument to 'ptr'`: `bytesOf` answers `{ address: 0, length: 0 }` for an empty label instead of handing `ptr()` a zero-length buffer, and the probe now prints `dock badge="…" read="…" cleared=true`.
- A crust window now appears in AppKit's accessibility tree for other processes. AppKit lists only windows on the active Space, and a window joins that Space only when its app is active — while `-[NSApplication activate]` is silently refused for a process LaunchServices did not launch, which is how `crust dev` and the parity harness run. `window-create.ts` sends `-activateIgnoringOtherApps:` when the app is not already active, guarded on `isActive` so a second window does not pull the app forward; a directly-executed app cannot become active through `activate`, which is why the pre-14 call is the one used. Measured on the same window from a separate trusted process: `external=windows:0,children:-1` before, `external=windows:1,children:4` after. Because that activation takes focus whenever the app is not frontmost, the policy is now `app.activate`, defaulting to `always`.
- The generated extension entry registered `undefined` — it emitted a default import and then passed `extension0.default` to `registry.register`; it now passes `extension0`, and a test executes the generated entry against the real registry so the shape cannot regress.
- `crash-reporter` works inside a compiled binary, which is the only place it matters: `import.meta.path` is `/$bunfs/root/…` there, so the guard is now the app's own executable relaunched with `CRUST_CRASH_GUARD` in the environment, recognised before the single-instance lock touches argv. A real `SIGSEGV` produced `last-crash.json` with signal, code and address, both artefacts `0600`.
- The single-file wrapper runs the guard check before importing the user's module, so a guard launch of a `crust build page.html` binary exits 0 having written nothing instead of evaluating the app a second time.
- `updater.install` replaces only the bundle this process is running, resolved from `process.execPath`, and refuses a symlink even to its own bundle: `rename` replaces the link and leaves the app in place, so the old code answered `ok:true` having updated nothing. `relaunch` still accepts that symlink, because starting it does start the bundle.
- `updater` can install a real update again: `download` verifies the archive's sha256 and signature, extracts it, and records both digests, so `install` compares the tree instead of trusting a path; zip only, by magic bytes, with zip-slip refused over the whole directory before a byte is written.
- The Windows COM handler's vtable was a static initialiser holding code addresses, which an unrelocated read turns into `0xFFFFFFFFFFFFFFFF`; it is filled at run time now, because an assignment is not a relocation.
- Windows slot 37 was documented as `Navigate`, but against the published `ICoreWebView2` declaration order `Navigate` is the fifth method and 37 is `GetBrowserProcessId`, so navigation wrote a process id over the URL. Every index is a named `SHIM_SLOT_*` with the order it was checked against, and a test re-derives each one from a transcribed method list.
- The Windows controller is created inside the environment's completion callback, because `UI_E_WRONG_THREAD` (`0x802A000C`) is what `CreateCoreWebView2Controller` answers on any thread but the one that created the object — the frame that owns it is the callback, not the export that started the environment.
- Every Windows vtable call was declared to return a 64-bit value while the method returns an `HRESULT`, so the undefined top half of RAX could read `S_OK` as a failure; the six calls that answer an `HRESULT` are `int` now, widened only where stored.
- The shim's `cc()` answer — `{ symbols, close }` — was cast straight to the platform type, so every call was `undefined` and the smoke died on `shim_com_init`; one unwrap reads it now, and a test drops a symbol from the map to prove the guard bites.
- `crust build` signed with `codesign` on every platform, so every Linux build died `Executable not found in PATH: codesign`; signing is darwin-only now, and the icon goes through `sips` only there, so a Linux artefact carries the PNG instead of a `.icns` only an Apple bundle reads.
- The installer looked for its tool with `which`, which Windows does not have, so an installed NSIS was never found; it asks `where` on win32.
- The NSIS script installed under `$PROGRAMFILES64` while requesting the user execution level, so no elevation ever happened and `SetOutPath` would fail for every real user; it installs under `LOCALAPPDATA` Programs now, the per-user shape VS Code and Discord use.
- The installer's size line shelled out to `du -sk`, and a machine without `du` answers ENOENT, which killed the build; it falls back to a recursive logical sum.
- `crust build` stat'd `dist/crust-app` while Bun appends `.exe` on Windows, so a successful compile read as a missing binary.
- `put_Bounds` takes the `RECT` by reference — the signature says `put_Bounds(RECT bounds)` and a 16-byte struct crosses x64 by pointer, so the parameter is declared as a pointer and the address is passed, which is the call the ABI already makes; by value would leave the sequence to TinyCC's struct codegen.
- A completion handler's out-parameter is borrowed and the shim never AddRef'd it: WebView2 drops its reference when `Invoke` returns, so the environment was freed under it and the controller read `0xffffffff` where its vtable belongs; `handler_invoke` AddRefs through the guarded vtable before storing, and stores nothing when the refcount is 0 or -1.
- `shim_wchar target[2048]` is 4096 bytes of local, which with TinyCC's 32-byte scratch makes a 4128-byte frame — and at 4096 TinyCC stops emitting the inline prologue and emits `call __chkstk`, which nothing in this unit's link set defines, so the call landed in a relocation filled with `-1`. The crash reports named WebView2's DLL twice because of a shared `.pdata` record; the function that died was crust's own, at its first instruction. `frame.test.ts` now fails the gate for any local array that reaches 4096 bytes.
- `CoInitializeEx` was declared to return 64 bits while an `HRESULT` is 32, so the undefined top half of RAX could read `S_OK` as a failure and `start()` could refuse a healthy machine; the widening stays at the export, and a test asserts a width verdict for every declared entry point.

### Security

- The bridge's origin gate admits a request that carries the right token and no `Origin` at all, because WebKitGTK's `EventSource` sends none on a same-origin GET and refusing a null one killed the whole event stream on Linux; the token is the credential, a foreign `Origin` is still 403, and a missing token is still 401.
- `network` matching folds both sides to lower case on darwin and win32, where the filesystem compares case-insensitively, so a `block` rule cannot be dodged by changing the case of a host or path; Linux keeps the byte-wise compare, because `/Etc/Hosts` and `/etc/hosts` are two files there.
- A request URL at or over the handler's 2047-byte buffer is blocked and logged rather than matched on a truncated prefix, and the darwin adapter reads `NETWORK_URL_LIMIT + 1` bytes so the check sees every byte the handler holds — until then it compared an already-truncated string, so the fail-closed branch could never fire.
- `shell.spawn` canonicalises the allow list once, so _what_ may run is decided by that list as an absolute real path and a `/tmp/echo` the page planted no longer satisfies `echo`; only a relative path is also held inside `cwdRoot`, and `program-not-allowed` or `cwd-not-allowed` answers before any process exists. Containment was tested first, which refused a program the host had allowed wherever it lives.
- The `fs` scope store is not addressable from a page — the store's own canonical path is refused by name before the file is read — and `fs.scopeAllow` refuses unless the host built the plugin with `grants: "page"`, because the store is exactly where a page may write and a page-reachable grant is a page-reachable boundary.
- `updater` installs only an artifact verified in the same run, takes the Ed25519 key from config rather than the page, restricts schemes to https with `file:` an explicit opt-in, and pins `install` and `relaunch` to this app's own bundle.
- `stronghold` refuses a store whose recorded KDF iteration count is not a positive integer before a key is derived from it, and refuses one above `KDF_MAX_ITERATIONS` — the floor was there and the ceiling was not, so a crafted file could pin a derivation for as long as it liked.

### Removed

- The page-serving `crust://` scheme on Linux — `35_scheme.c`, `scheme-page.ts` and the backend `registerScheme`/`register` member are deleted, because darwin never had one and `urlScheme` belongs to the app's own deep links.
- The page-serving `crust://` scheme on Windows — removed the same way, so a window navigates on the URL it was created with, which is the value darwin hands to `-loadRequest:`.

### Limits

- Linux is proven end to end on real GTK3 + WebKitGTK 4.1 under Xvfb: `bun run e2e:linux` on `ubuntu-sandbox` (Ubuntu 25.10 arm64) prints `e2e:linux: PASS` with both sonames loading, `gtk_init_check` returning 1, a real `GtkWindow` and `WebKitWebView` shown, the document reaching `FINISHED` with its title read back through `webkit_web_view_get_title`, page JS running, `window.crust.invoke` answering through the app's own bridge, the event stream and `crust:ready` arriving, a failed load reported rather than swallowed, and `quit()` exiting 0; the unit suite is green on that machine.
- What Linux still does not prove: window-close pruning, multi-window and packaging are untested there.
- Windows is green on CI: `gate (windows)` compiles the shim, creates the window, class, environment and controller on one thread, navigates to `about:blank` and pumps, and `package (windows)` proves the installer, so the hand-built COM object is exercised rather than asserted.
- On Windows every vtable index is derived from the published `ICoreWebView2` declaration order and is now exercised against a live object, and the hand-written `WNDCLASSEXW`/`MSG` sizes still have no header to agree with.
- The Windows smoke prints every stage with its own `HRESULT` and the calling thread, so a failure names the call; it has not yet reached a loaded document, page JS or `invoke`.
- All three installers are proven by artefact: `e2e:package` builds a `.dmg` on macOS, `e2e:appimage` an AppImage on Linux, and `e2e:package:nsis` an installer on Windows that installs silently and asserts the tree it leaves. NSIS writes no icon here, so the installer carries the stock one.
- Notarization is code-complete but unproven: it needs a Developer ID Application certificate and a `notarytool` credential, and both `crust sign` and `crust notarize` exit 1 before any bundle lookup rather than pretending, `sign` naming `CRUST_SIGNING_IDENTITY` as the variable to set.
- `network` intercepts only requests under its own `crust-net` scheme; a page served from the bridge URL is not intercepted, and a `WKURLSchemeHandler` has no pass-through.
- `findinpage.matches` is 0 or 1, never a total, because `WKFindResult` carries only `-matchFound`; `clear()` refuses naming the private `-_clearFindIndicator`.
- `crash-reporter` is registered only on macOS: the handler that writes the record is `platform/darwin/crash.ts`, and the runtime's non-darwin plugin list omits it, so a page on Linux or Windows has no `crash-reporter` command at all.
- A physical key press reaching a Carbon hot key is unproven: the probe fires the adapter's `dispatch` seam, which proves the grab was accepted and the process-side chain, not the window server's table.
- `downloads`, `findinpage` and `navigation` resolve their webview from `windowLabels()[0]`, so they act on the first window only; a second window is not covered.
- `i18n.setLocale` is in-memory because macOS owns the language list; a single-file build carries no extensions, and now says so instead of dropping them.
- `minWidth`/`minHeight` do nothing on Windows (`WM_GETMINMAXINFO` is unhandled), and no DPI-awareness declaration exists in that layer, so bounds come from `GetClientRect` in physical pixels.
- On Windows the shim keeps one global webview pointer beside its per-window table, so `Navigate` drives the last-attached webview, and closing a window neither decrements the count nor clears it, so eight closes end all attaching.
- `crust build` has no native compile step, so a standalone binary looks for its Zig or Rust dylib under `$bunfs/root` and dies; native extensions are a `crust dev` feature until the bundle learns to carry them.

## [0.1.21] — 2026-11-15

### Added

- Single-file `.html` mode — `crust dev page.html` and `crust build page.html` copy the document verbatim as `index.html` instead of treating it as a module entry.
- A docs site under `site/`, built on `@ui-sdk/react` and deployed at `crust.jyz.land`.

### Changed

- The install page pins `bunx crust@v0.1.21` rather than a floating version.
