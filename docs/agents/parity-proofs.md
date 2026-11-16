# parity-proofs lane

Lane that proved the ten new parity surfaces. Measured facts, traps and decisions; read before touching `examples/parity-probe`, `scripts/e2e-parity*.ts` or `src/runtime-plugins.ts`.

## Measured

- **`crust build` compiles the probe (`bun build --compile`), so `import.meta.path` is `/$bunfs/root/crust-app`** — `startCrashGuard` always throws `not-implemented` there, because the guard is a second Bun process needing a readable copy of its own script.
- **`darwinDockAdapter().setBadge("")` threw `bun:ffi cannot convert argument to 'ptr'`** — `ptr()` refuses a zero-length `Uint8Array`, so the plugin's documented "empty string clears the badge" path was broken; fixed in `dock-ffi.ts` `bytesOf`, which now returns `{ address: 0, length: 0 }` for empty text, and `dock cleared=true` is the proof.
- **`crust_dock_set_badge(0, 0)` clears the tile** (returns 1, `badgeLabel()` reads `""`) — it is what the probe called while the adapter path was broken, and the probe still calls it in its `catch` so the dock is left clean on any future failure.
- **`accessibility.elementCount()` proves a real tree now** — `AXWindows` on `AXUIElementCreateApplication(getpid())` answers one window with four children from a separate trusted process (`external=windows:1,children:4`), and the parity row prints that rather than a refusal. The earlier empty list was the app not being on the active Space, not an absent window.
- **AX visibility is gated on app activation, not on the window** — AppKit lists only windows on the active Space, and a window joins it only when its app is active; `-[NSApplication activate]` is silently refused for a process LaunchServices did not launch (which is how `crust dev` and the probe run), so `-activateIgnoringOtherApps:` is the call that lands. `window-create.ts` sends it only when `isActive` is false, so a second window does not pull the app forward.
- **A named refusal is not evidence of a fixed bug** — the row's pattern was widened to accept `noWindow` while the real cause was unmeasured; once the activation fix landed the honest answer changed, so re-measure before trusting an old "passes on the refusal" note.
- **A parity pattern must accept the honest refusal form and the proof must `mark` true on it** — the way `NOTIFICATION` accepts `delivered:` or `refused:`; a named `not-implemented` is the surface answering, and silence is the only failure.
- **A visible window (`visible 1`) was not an AX window before the activation fix** — measured with `240x160`, `orderFrontRegardless`, a 300 ms wait, `activateOnce()` and a 16 ms pump, the array stayed empty; `-activateIgnoringOtherApps:` is what changed it, and `visible 1` alone still proves nothing about the tree.
- **The parity harness verdict for a row is "the line matched the pattern", not the proof's `mark`** — a line must print the adapter's real answer (`cleared=false`), or a broken path reads green while the summary says FAIL.
- **`attempt()` prints only when the body throws before marking**, so every proof prints its line first and calls `mark` after.
- **`bun check` type-checks `src` and `scripts` only (`tsconfig.json` `include`)** — a bad import in a probe file passes `bun check` and fails at `crust build`; the build is the probe's only type gate.
- **`window.load` does not exist** — after installing the navigation delegate, `navigation.reload()` is the only way to trigger a navigation, and a reload of a `data:` page reports `did-finish` with the `data:` URL.
- **The runtime's 16 ms pump drives WebKit's delegate and find completion callbacks** — the probe waits with `Bun.sleep`, never a second `platform.pump()`.
- **`darwinNetworkAdapter()` without `{ configuration }` always refuses** — the window path builds `[[WKWebView alloc] init]` and never exposes a `WKWebViewConfiguration`, so `setURLSchemeHandler:forURLScheme:` can never be reached.
- **`darwinCrashAdapter()` does not exist** — `src/platform/darwin/crash.ts` exports `armCrashHandlers`/`disarmCrashHandlers`, wrapped into the plugin's `CrashNative` in `runtime-plugins.ts`.
- **`src/plugins/network.ts` re-exports `NetworkStatus` but not `NetworkState`/`NetworkCommands`** — a barrel export of those two fails `bun check`.
- **`src/plugins/downloads.ts` re-exports no types** — they live in `downloads-types.ts`, which the barrel imports directly.

## Decisions

- **`NativePluginOptions.app` carries the app id** — `nativePlugins` had no way to name the data root, and `src/runtime.ts` now passes `config.app.id` so crash records and downloads land in `~/Library/Application Support/<app id>`.
- **`startCrashGuard` is wrapped in `try`/`catch` in `runtime-plugins.ts`** — a compiled app passes `undefined` and the plugin answers its own named refusal instead of the launch dying before a window exists.
- **Registering `crash-reporter` makes every darwin launch spawn a guard in a source run** — a compiled bundle never does; watch for the extra `process.execPath` child in dev.
- **The network proof drives the plugin's documented `install(scheme, decide)` seam with a probe adapter** — it proves the rule engine, log and event; it does not prove interception, and the line `network native handler: refused — …` states that in the run output.
- **`navigation`, `findinpage`, `network`, `downloads`, `crash-reporter` are exported from the barrels** — `platform` holds navigation/findinpage/network, `data` holds downloads, `system` holds crash-reporter, and `barrel.test.ts`'s checked-in list carries every new value name.
- **The `i18n` proof now passes `darwinLocaleAdapter()`** — the runtime registers that adapter, so the proof reads the system language (`locale=en-GB` here) while the catalogue falls back to `en`.

## Verdicts

- **Dock, accessibility and crash-reporter rows are green** — dock proves a real badge round trip, accessibility passes on the AX reason, crash-reporter on the guard's bundle refusal; no row claims a tree or a running guard it did not see.
- **`crash guard=refused last=unknown` is the honest crash-reporter line in a bundle** — never turn it into a pass by faking a guard process; the pattern accepts only `running last=none` or `refused last=unknown — <reason>`.
- **The harness prints the matched text**, so a two-line pattern (value line + reason line) puts both lines into the report as the row's evidence.
- **Never `open` a built bundle to make AX or LaunchServices cooperate** — the repo forbids it and it raises Gatekeeper.
