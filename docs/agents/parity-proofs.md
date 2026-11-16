# parity-proofs lane

Lane that proved the ten new parity surfaces. Measured facts, traps and decisions; read before touching `examples/parity-probe`, `scripts/e2e-parity*.ts` or `src/runtime-plugins.ts`.

## Measured

- **`crust build` compiles the probe (`bun build --compile`), so `import.meta.path` is `/$bunfs/root/crust-app`** — `startCrashGuard` always throws `not-implemented` there, because the guard is a second Bun process needing a readable copy of its own script.
- **`darwinDockAdapter().setBadge("")` threw `bun:ffi cannot convert argument to 'ptr'`** — `ptr()` refuses a zero-length `Uint8Array`, so the plugin's documented "empty string clears the badge" path was broken; fixed in `dock-ffi.ts` `bytesOf`, which now returns `{ address: 0, length: 0 }` for empty text, and `dock cleared=true` is the proof.
- **`crust_dock_set_badge(0, 0)` clears the tile** (returns 1, `badgeLabel()` reads `""`) — it is what the probe called while the adapter path was broken, and the probe still calls it in its `catch` so the dock is left clean on any future failure.
- **`accessibility.elementCount()` reports no windows for this process even with a visible window** — `AXWindows` on `AXUIElementCreateApplication(getpid())` answers an empty list while `AXIsProcessTrusted` is true, and activation is refused for a direct-exec bundle (`active no`).
- **The accessibility proof now reads the tree from a second process** — another lane rewrote it to `accessibility ax self=… external=windows:N,children:M,status:S`, and the external read sees `windows:0` here, so that proof marks false and the summary stays FAIL until the AX exposure changes.
- **A parity pattern must accept the honest refusal form and the proof must `mark` true on it** — the way `NOTIFICATION` accepts `delivered:` or `refused:`; a named `not-implemented` is the surface answering, and silence is the only failure.
- **A visible window (`visible 1`) is not an AX window** — measured with `240x160`, `orderFrontRegardless`, a 300 ms wait, `activateOnce()`, and a 16 ms pump; the array stayed empty every time.
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
- **`updater.install` needs a receipt `updater.download` recorded in the same instance** — no receipt is `unverified-artifact`, and the path must be the one that download wrote.
- **`install` also refuses any `appPath` that is not this process's own bundle** — `ownBundleFailure(appPath, execPath)` derives it from the third `createUpdaterPlugin` argument, so a probe passes an `execPath` inside its temp `Old.app` instead of replacing the real bundle.
- **`download` writes one file, `install` accepts only an `.app` directory, and `readBytes` on a directory throws** — so a signed bundle download cannot verify; the probe widens `download` to materialise a directory and proves the Ed25519 half on a separate file artefact.
- **The probe's pinned key is generated per run** — `generateKeyPairSync("ed25519")`, `jwk.x` base64url → base64 of the 32 raw bytes, signature base64 of 64.
- **`check` has no URL policy while `download` is https-only unless `allowFileUrl`** — a loopback `http` server can serve the manifest, never the artefact; `file:` plus `allowFileUrl` is the only fetchable non-https path.
- **`main.ts` prints `parity: unproved <names>` before the summary on FAIL** — the harness only shows matched lines, so run the binary itself to see which proof failed.
- **`proofs-updater.ts` owns the updater proof; `proofs-update.ts` is notification only** — the split keeps each file about one surface.

## Verdicts

- **Dock, accessibility and crash-reporter rows are green** — dock proves a real badge round trip, accessibility passes on the AX reason, crash-reporter on the guard's bundle refusal; no row claims a tree or a running guard it did not see.
- **`crash guard=refused last=unknown` is the honest crash-reporter line in a bundle** — never turn it into a pass by faking a guard process; the pattern accepts only `running last=none` or `refused last=unknown — <reason>`.
- **The harness prints the matched text**, so a two-line pattern (value line + reason line) puts both lines into the report as the row's evidence.
- **Never `open` a built bundle to make AX or LaunchServices cooperate** — the repo forbids it and it raises Gatekeeper.
