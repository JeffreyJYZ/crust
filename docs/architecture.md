# Architecture

One page for someone changing this codebase. It explains the moving parts — runtime, bridge, plugins, the `app` surface, the platform seam, and the two frontend shims — where the boundaries between them sit, and which files encode the traps that will bite anyone who edits them.

Measurements are deliberately not repeated here. Every number, and the command that produced it, is in [DESIGN.md](../DESIGN.md): §1 size, §2 the AppKit constraints and traps, §3 the run loop, §4 the bridge, §6 the platform seam, §9 risks, §10 milestones.

## The shape of a running app

```
bun (one process, one JavaScript thread)
│
├── src/runtime.ts        startApp(): config → platform → plugins → defer bridge → import main.ts
│   ├── src/bridge/       Bun.serve on 127.0.0.1:<port>, one token, invoke + SSE
│   ├── src/plugins/      definePlugin, the registry, the five built-ins
│   ├── src/app.ts        `app` — the surface main.ts uses; owns the Platform seam
│   ├── src/vite.ts       `crust/vite` — injects the page client into a dev-server document
│   ├── src/single.ts     the config-free mode: one file, bundled page, generated runner
│   └── src/platform/darwin/
│        ├── index.ts     the only Platform implementation, selectors, guards
│        ├── shim/        window, webview, application; parts joined, compiled at launch by cc()
│        ├── status_bar.c + status-bar.ts          the tray's NSStatusItem
│        └── notifications.c + notifications.ts    the notification centre
│
└── WKWebView             the page, loaded from the bridge or a dev server
```

The bridge's port is not ephemeral any more: it is derived from `app.id`, so a page's origin survives a restart and `localStorage` with it. [The bridge](#the-bridge-token-origin-and-port) has the derivation and the fallback.

Three shapes launch the same runtime. `src/cli/index.ts` is the `crust` command: `crust dev` spawns the runtime through `Bun.spawn` (`src/cli/dev.ts`), and a built binary's generated wrapper calls `startApp()` with an embedded config and an `entryModule` (`src/cli/build.ts`). The third is the config-free mode: `crust dev app.tsx` writes a generated runner to a temp directory that imports `startApp` with a literal config (`devRunnerSource` in `src/single.ts`), and `crust build app.tsx` compiles an equivalent wrapper. All of them converge on `startApp`.

Which copy of the runtime that is matters as much as the call. Both entry points resolve the project's own `node_modules/crust` by realpath before falling back to the framework the CLI carries, because the project's `import "crust"` and the spawned runtime have to be the same module instance; [One copy of the framework](#one-copy-of-the-framework-or-two-app-singletons) has the rule and the two failures that expose it.

One detail to know before trusting the environment: `dev.ts` sets `CRUST_DEV_URL` on the child, but nothing in `src/` reads it — the dev URL the app uses is `config.dev.url`, resolved inside `startApp`. What a dev *server* needs is the other pair: with `dev.url` set, `startApp` writes `.crust/dev.json` (`{ url, token }`) and exports `CRUST_BRIDGE_URL` / `CRUST_BRIDGE_TOKEN`, which `src/vite.ts` reads per document request. The file exists because the dev server is spawned before the bridge binds.

`startApp` does its work in a fixed order, and the order matters:

1. load and validate the config (`loadConfig` / `validateConfig`), or validate the embedded one a built app passes;
2. construct the platform — `window`'s adapter reads labels and native pointers from that same instance, so it exists before any plugin is built;
3. build the plugin set: the core four, with `dialog`, `tray` and `notification` replaced by the platform's native adapters and `window` appended;
4. resolve the frontend: `options.root` or `<project>/public` when that directory exists, and the document from `options.assets["/index.html"]` first, then disk;
5. `app.deferBridge(...)` with a factory, then `app.attach(platform, config)` — or `app.configure(config)` when no platform is attached, which is the headless case — the bridge is not started here;
6. import the user's entry, which registers commands, mounts plugins with `app.use`, and calls `app.run()`;
7. `run()` calls the deferred factory, which registers the config's core selection, the mounted plugins and the `app` namespace, binds the port, and returns the URL; then windows, `ready`, pump.

The bridge starts at `run()`, not before the import, because a user plugin mounted in `main.ts` has to be in the registry before the server accepts requests. `App.deferBridge` is what allows that ordering without `startApp` owning the server; `src/runtime.ts` is where both facts are encoded. An entry that never calls `run()` still gets a bridge — `startApp` calls the same factory at the end, which is what keeps a headless bridge test simple.

## The Platform seam

`src/app.ts` declares one interface and nothing else knows AppKit exists.

```ts
interface Platform {
	start(): Promise<void>;
	pump(intervalMs: number): void;
	createWindow(options: WindowOptions): WindowHandle;
	window(label: string): WindowHandle | undefined;
	quit(): void;
}
```

- **`start()`** brings the application up: compile the shim, preflight every selector, `NSApplicationLoad`, `sharedApplication`, activation policy, resolve the run-loop mode. It is idempotent per instance and throws a single error listing every missing selector rather than aborting on the first.
- **`pump(intervalMs)`** starts the Cocoa run loop pump on a timer. It throws unless the interval is a finite positive number, and re-arming is the implementation's business, not `App`'s.
- **`createWindow(options)`** opens a window and returns `{ label }`. Throws on an empty label and on a duplicate label. `minWidth` is applied as the window's minimum size (`shim_window_set_min_size`), with the configured `height` reused as the minimum height; `width`/`height` default to 1100×760. `DarwinPlatform` also keeps the absolute URL each window was asked to load (`windowUrl(label)`), which is what `darwinWindowAdapter.create` resolves a later relative `url` against — the bridge URL itself is the runtime's, not the platform's.
- **`window(label)`** is the liveness query: the handle while the window is open, `undefined` once it has closed. `run()`'s `window-all-closed` watcher depends on it, and on macOS a closed window stays addressable because it was created with `setReleasedWhenClosed: NO`. `Platform.windowLabels()` (a macOS extra, not part of the interface) is what the `window` plugin's `list` reads, and it filters by the same liveness rule — a closed window's native object survives for the liveness read, but its label drops out of the next listing.
- **`quit()`** ends the application. On macOS it stops the pump, sends `terminate:`, and exits the process.

Only `src/app.ts` and `src/platform/darwin/index.ts` implement or consume this. Two things keep AppKit optional: `startApp` imports the layer only when it attaches a platform, and `App.#loadPlatform` does it lazily, so the bridge, the config and `bun check` load on a machine with no AppKit and a process that never opens a window never compiles the shim.

Adding a second platform is meant to be a decision made in one directory. Be honest about the cost: WebView2 is COM and WebKitGTK is GTK's object system, so a second implementation will probably need a compiled shim and therefore a relaxation of the no-native-artifact rule — `DESIGN.md` §6 says the seam exists to localise that decision, not to promise pure FFI scales.

## The plugins and their native halves

A plugin owns no framework. Each file in `src/plugins/` declares a name, a command map, and an interface for its native half (`DialogNative`, `WindowNative`, `TrayNative`, `NotificationAdapter`); the implementation lives in `src/platform/darwin/` and `startApp` substitutes it (`nativePlugins` in `src/runtime.ts`). Without a platform, or off macOS, the plugin still registers under its own name and every command answers a typed `NotImplemented` naming what is missing — which is what keeps `config.plugins` matching in a headless process. `fs` needs no adapter at all.

Four of the five have a real native half, and their shapes differ for reasons worth keeping:

- **`dialog`** is a sheet (`beginSheetModalForWindow:completionHandler:`) whenever a key window exists, and `awaitSheetResult` polls the C-side done flag on a 16 ms timer so the pump and in-flight invokes keep running. With no visible window it presents the panel through `beginWithCompletionHandler:` rather than `-runModal`, so the same poll awaits it and `cancel` can end it — the blocking fallback is gone, because a windowless app could never answer it itself. `filters` becomes one comma-separated extension list applied through the deprecated `-setAllowedFileTypes:`; `multiple` and `directory` map to `allowsMultipleSelection` / `canChooseDirectories`; `savePanel` is `NSSavePanel` sharing the same sheet target, poll and file-type helper rather than a second copy. One sheet exists per process — the C side holds one panel, one done flag and one path list — so a second request while one is up is refused with a message naming the panel that is up, and `dialog.cancel` is the page's way out: it sends `-cancel:`, waits up to 2000 ms for the completion handler, and answers `{ cancelled, paths: [] }`, with `cancelled: false` when nothing was pending rather than an error.
- **`window`** is `darwinWindowAdapter(platform)`, which reads labels and native pointers from the running `DarwinPlatform` and answers typed failures instead of throwing. Its `create` command delegates to `DarwinPlatform.createWindow` after two checks the platform's own limit forces: a relative `url` is resolved against the document an open window already loaded (with no open window that loaded a real `http(s)` document there is no base at all, and that case is `handler-error` rather than a guessed origin), and a closed-but-tracked label is released with `platform.window(label)` first, or `createWindow` refuses it as a duplicate. `WindowNative.create` stays optional, so a hand-written adapter without it answers `unknown-adapter` rather than failing to type-check.
- **`tray`** is one `NSStatusItem` per process with a title and a menu. `createStatusBar()` throws while another item is alive, because the ObjC runtime class holds a single click IMP and a single target; `destroy()` frees the slot. `readback()` reports what AppKit says about the item — title, `isVisible`, button window number, frame, occlusion, active space — which is state, never evidence that it was drawn.
- **`notification`** takes a `post` adapter that answers an OS status: `0` delivered, `1` authorization pending or denied, `2` a class or selector missing, `3` an error. The plugin maps only status `0` to `delivered: true`, so a missing permission is never a silent success. `requestPermission` answers `not-implemented` whenever the adapter can post, because the OS reveals authorization only through the completion handler `notify` already consumes.

Two rules hold for all of them. A failure is a **value**, not an exception: `WindowAdapterError` and `TrayAdapterError` are caught inside the plugin and returned as `{ ok: false, code, message }`, and a `NotImplemented` value is converted to a `501 not-implemented` at the registry/bridge boundary. And the C units guard every selector and report a status code instead of throwing, because an uncaught ObjC exception is a `SIGABRT` with no JavaScript error to catch.

## The C shim: why it exists, and why it is compiled at launch

Every native call is made through a C unit compiled at runtime by `cc()` from `bun:ffi`. There is no prebuilt native artifact in the package. Three units exist: `src/platform/darwin/shim/` for the window, the webview and the application; `status_bar/` for the tray's `NSStatusItem`; and `notifications/` for the notification centre — each unit is a directory of numbered parts joined in path order, because every file stays under 200 lines and the parts share statics. Each obeys the same four rules — one fixed prototype per `objc_msgSend` arity, no framework headers, no struct across the FFI, and strings crossing as encoded buffers — and each is loaded the same way: imported as text, hashed, materialised to `$TMPDIR`, compiled.

**Why a shim at all.** `objc_msgSend` is variadic. Declaring it as variadic and calling it delivers wrong argument values; the only safe call is through a fixed prototype per arity. the shim supplies exactly one fixed-prototype wrapper per arity and per return kind (`shim_send_p0`, `shim_send_pq1`, `shim_send_vb1`, …), and the JavaScript side has one guarded wrapper per wrapper (`S.p0`, `S.pq1`, `S.vb1`, … in `src/platform/darwin/index.ts`). The shim also exists for the two cases the FFI cannot express: struct arguments and struct returns. `CGRect` is built on the C stack inside `shim_window_new` and the initializer is called from C, so no struct ever crosses the boundary; views are positioned with Auto Layout constraints, and `setFrame:` appears nowhere. The reasoning and the measurements behind both claims are `DESIGN.md` §2 and §9 items 1 and 4.

**Why compiled at launch instead of shipped.** `cc()` compiles C from a file path in roughly 3–20 ms (the comment on `shim()` in `src/platform/darwin/index.ts`; 17.9 ms measured in `DESIGN.md` §10), which is cheaper than shipping and signing a `.dylib`, and it keeps the no-native-artifact promise. Two consequences are encoded in `compile()`:

- `cc({ source })` takes a **path**, and inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where a shipped `.c` file does not exist. So the shim parts are imported as text, joined in order by `shim-source.ts`, hashed with SHA-256, written to `$TMPDIR/crust-shim-<hash>.c` on first use, and compiled from there. The hash means a second launch reuses the file and TinyCC's per-path cache.
- Every framework is linked explicitly with `flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit", "-framework", "CoreFoundation"]`. A dlopen'd libobjc resolves `NSObject` but not `NSString`, so an unlinked framework reads as a selector typo (`DESIGN.md` §2).

**Preflight, then guard.** Nothing is sent blind. `PREFLIGHT` in `src/platform/darwin/index.ts` lists every class and instance selector the window shim uses, including the ones the shim itself sends (the `NSString` / `NSURL` / `NSURLRequest` chain, `NSPlaceholderString`'s initializer, `valueForKey:` / `getValue:`), because C cannot verify them. `start()` tests each one — `respondsToSelector:` for class receivers, `class_getInstanceMethod` for instance receivers — and fails with all the missing ones named at once. At call time the `guard`/`must` pair checks the receiver and caches the answer per `(class, selector)`. The other two units do the same job in their own shape: they check for the class and selector before sending and report a status code (`NOTIFICATION_STATUS`, and the tray's status constants) rather than throwing through the bridge. The reason is not tidiness: an uncaught Objective-C exception terminates the process with `SIGABRT` and never becomes a JavaScript error.

## The pump and its 0.25 ms slice

`[NSApp run]` never returns, so it cannot be called from Bun. Instead the Cocoa run loop is pumped in short slices from JavaScript:

- `App.run()` calls `platform.pump(PUMP_INTERVAL_MS)`, which is 16 ms (`src/app.ts`);
- `DarwinPlatform.pump` re-arms a **`setTimeout`** chain, not a repeating interval, because an interval is the thing power-saving coalesces (`DESIGN.md` §3);
- each tick calls `shim_pump`, and `shim_pump` is `CFRunLoopRunInMode(mode, 0.00025, 1)` — a 0.25 ms slice (the shim).

The slice length, not the tick, is what decides tick fidelity; `DESIGN.md` §3 has the delivery table and why a longer slice is worse than not pumping at all. Two consequences a contributor must keep in mind:

- **Blocking JavaScript blocks drawing.** Anything long belongs on a `Worker`. The bridge and the plugins are async for this reason, and no native path blocks it: even a windowless dialog reports through a completion block that is polled, so `dialog.cancel` works there too.
- **Re-entrancy is real.** A Cocoa callback fires inside a pump tick, so anything it calls back into JavaScript runs nested inside a timer.

The run-loop mode is resolved once by `shim_mode()` and verified by `shim_mode_ok()`, because a wrong mode is a silent no-op: `kCFRunLoopDefaultMode` is a data symbol that cannot be called through `bun:ffi`, so the shim builds a constant `CFString` and compares its contents.

## The bridge: token, origin and port

`src/bridge/server.ts` is `Bun.serve` on `127.0.0.1`, one token per launch, one origin check. The security posture and its measurements are `DESIGN.md` §4; this is what the code enforces.

**Port.** The bridge takes a `port` option (`0`, the OS's choice, is the default at the `startBridge` layer), but the runtime always passes one: `preferredPortFor(app.id)` in `src/runtime.ts` hashes the id into the range 45000–48999, and the factory tries `preferred + offset` for offsets 0…19 before falling back to `0` on the 21st attempt. The reason is stated in that function and it is not tidiness: an ephemeral port makes the page's origin change every launch, which discards `localStorage`, `IndexedDB`, service workers and every per-origin cache. A derived port keeps the origin stable; the walk keeps a busy port from being a startup failure. A launch that walks to another port has a different origin, and nothing migrates the old one.

**Token.** One per launch, `crypto.randomUUID()`. It is injected into the served document as part of the bootstrap script, which is `installCrust.toString()` called with the config (`bootstrapSource` in `src/bridge/client.ts`). The page therefore holds it and other local processes do not. The client sends it as `Authorization: Bearer <token>`; the event stream cannot set headers, so `GET /_crust/events` also accepts `?token=`. A restart is a new token, so a page loaded before it must reload.

**What is token-free.** The document and its assets, and nothing else: any `GET`/`HEAD` whose path does not start with `/_crust/`. That is unavoidable — the page cannot present a token before it has been served — and it is why the token protects IPC, not the HTML/JS/CSS the page is made of. Assets are read from an embedded `AssetTable` first and from `root` second, and an extensionless path that matches no file is answered with the document, so a client-side route survives a reload.

**Origin.** For every `/_crust/*` request the server requires an `Origin` header and refuses an absent one:

- `http://127.0.0.1:<port>` and `http://localhost:<port>` are the bridge's own origins and are always allowed;
- a configured `devOrigin` (string or list, from `StartBridgeOptions`) is also allowed, and only those origins get CORS headers and a `204` preflight;
- anything else, including no header at all, is `403 bad-origin`.

Refusing an absent `Origin` is the point: a local non-browser client sends none, and skipping the check when the header is missing would let any local process drive the bridge. The `Origin` check runs before the token check, so a browser error is `bad-origin`, not `unauthorized`.

**A dev-server page.** With `dev.url` set, the document comes from the dev server, so neither the bootstrap nor the invoke shim is in it. `startApp` publishes the pair the dev server needs — `.crust/dev.json` plus `CRUST_BRIDGE_URL` / `CRUST_BRIDGE_TOKEN` — and `src/vite.ts` injects `window.__CRUST__` and `pageClientSource()` into the document it serves. That is one client implementation with two carriers, not a second copy: `pageClientSource()` is the same `installCrust` source the bridge ships, and it installs from the pre-set global.

**Everything else on the wire.** `DEFAULT_CSP` is applied to documents and overridable by `security.csp`; it must keep `connect-src 'self'` or every invoke becomes a CSP violation. Bodies over 2 MiB are refused (`too-large`, 413) before parsing. `idleTimeout: 0` disables Bun's 10 s default, which would cut an idle event stream. `emit` writes `event: <name>\ndata: <json>\n\n` to every subscriber and drops a subscriber whose enqueue throws.

## The four traps

Each of these has already cost a debugging session. The file beside each one is where the fix lives; `DESIGN.md` §2 records the measurement.

1. **`[[NSWindow alloc] init]` aborts the process.** `NSWindow`'s designated initializer is `initWithContentRect:styleMask:backing:defer:`; a bare `init` returns a half-built window that AppKit's own event thread later messages, which is an uncaught exception and a `SIGABRT`. Encoded in `src/platform/darwin/shim/40_window.c`: the comment above `shim_window_new`, and the function itself, which builds the rect on the C stack and calls the designated initializer. `DarwinPlatform.createWindow` calls that symbol and never sends `init` to a window.
2. **A short ASCII `NSString` is a tagged pointer and cannot cross `bun:ffi`.** Values above 2^53 are already imprecise when they come back, so every later send hits a corrupted object. Encoded in the shim: `shim_window_set_title` builds the string and applies it natively, `panel_nsstring` does the same for the open panel, and `shim_webview_load` builds the URL chain entirely inside C. JavaScript never receives one. `DarwinPlatform.createWindow` and `darwinWindowAdapter.setTitle` read the applied title back and throw on a mismatch, so a silent no-op cannot pass as success.
3. **`+[NSString stringWithUTF8String:]` crashes Bun outright.** Encoded in the shim: the comment in `panel_nsstring`, and the fact that every string in the file is built with `-initWithBytes:length:encoding:` (encoding `4`, `NSUTF8StringEncoding`). A JS string is never passed into C either; `cbuf` in `index.ts` encodes it to a `Uint8Array`, keeps the buffer alive for the process lifetime, and passes its address.
4. **`read.ptr` truncates a 64-bit pointer.** A pointer read out of a buffer loses the high bits and faults later at something like `0x10`, far from the cause. Encoded in `src/platform/darwin/index.ts` by not reading pointers out of memory at all: a symbol that *returns* a pointer arrives as an exact `number`, and `ptrValue` refuses anything else (a `BigInt` from an `i64` return, a missing symbol) instead of coercing it. `i64` arguments are converted up to `BigInt` explicitly (`S.pq1`, `S.vq1`).

These are properties of `bun:ffi`, not of the window shim: `status_bar.c` and `notifications.c` obey the same four rules, build their strings with `-initWithBytes:length:encoding:`, and never hand an object across the boundary. A new C unit that breaks one of them will fail the same way, in the same place — at a later send, not at the mistake.

## One copy of the framework, or two `app` singletons

`crust` is a normal dependency of the project, and it is also the thing running the project. Those are two specifiers for the same code, and if they resolve to different files the app has two `app` objects — one holding the registered commands and the config, the other holding the bridge and the window.

Both entry points therefore resolve the project's own copy, by realpath, and fall back to the CLI's only when the project has none:

- `crust build` imports the runtime from `projectCrustRoot(dir)` when it generates the wrapper (`src/cli/build.ts`), so `app.run()` in the entry runs on the instance the wrapper configured. That wrapper calls `app.configure(config)` when no platform is attached, which is what lets a built app started at cwd `/` skip `loadConfig()` entirely.
- `crust dev` spawns the runtime child from the same root (`src/cli/dev.ts`), so a command registered in `main.ts` is visible to the bridge.

A compiled CLI has no checkout to point a child at: `frameworkRoot` (`src/cli/framework.ts`) writes its embedded sources to `$TMPDIR/crust-framework-<version>` — version-keyed, marker written last — and the generated entry imports from there, because a child `bun build` cannot read `/$bunfs`.

The failure is not subtle when it happens, and it only reproduces with an installed crust: a built app launched outside its project directory died with `no crust config in /`, and `crust dev` answered `crust: unknown command "greet"` for a command that was registered. A checkout hides both, because `link:` makes the two specifiers one realpath — which is why the e2e suites accept `CRUST_BIN` and are run against an installed tarball, not only against this tree.

## A window that never appears

The most misleading failure this framework has had. A page paints, its JavaScript keeps running, and the window shows nothing — which reads as a rendering bug and is not one.

Measured 2026-11-14, three readings in this order:

```
active    no
runloop   main thread owns it: yes
window    main number 3181, visible 1, on active space 0
```

`isOnActiveSpace 0` was the answer: a launched app's window lands on the desktop Space while the user sits in a fullscreen one, so it is created, visible to AppKit, and on no Space anyone can see. `screencapture -l` then returns an empty frame, which is why screenshots made it look like the window had gone blank. Two lines in `createWindow` fix it: `setCollectionBehavior:` with `canJoinAllSpaces | fullScreenAuxiliary` (257), and `orderFrontRegardless` for the activation an unlaunched process is refused. The `runloop` line exists because the obvious suspect was the pump, and ruling it out took one boolean.

## Where a frontend comes from

Three paths, one bridge, and each one is a different file's business:

| frontend | how the document reaches the page | file |
| --- | --- | --- |
| no dev server | the bridge serves `public/index.html` and its assets from disk | `src/runtime.ts` (`root`) |
| a dev server (`dev.url`) | the window loads the dev server's document, and `crust/vite` injects the client | `src/vite.ts`, `src/runtime.ts` (handshake) |
| one file | `Bun.build` bundles the page, the bridge serves the bundle directory | `src/single.ts`, `src/cli/dev.ts` |

A built app replaces the first path's disk read with an embedded table: `crust build` walks `build.assets` (default `public`) and generates `dist/crust-assets.ts`, which the wrapper imports and `startApp` passes as `options.assets` — the bridge checks it before `root`. The walk runs **after** `build.beforeBuildCommand`, and the named directory must exist and hold `index.html`, so a framework's stale output can never be packaged in place of a fresh one (`resolveAssets` in `src/cli/build.ts`).

The config-free mode is smaller than a project by design: no config file, a config built in memory (`crust.single.<slug>`, version `0.0.0`, one 900×700 window), and a page convention that is a regular expression over the source — `export default` means a React component to mount, anything else is loaded for its own side effects. `crust dev` writes a generated runner into a temp directory and watches only the entry file; `crust build` embeds the bundle and passes a `root` that cannot exist, so every request is answered from the table. The user-facing contract is [single-file.md](single-file.md).

## Where to change what

| change | file |
| --- | --- |
| a new app-surface method or event | `src/app.ts` (`App`, `AppEvent`) |
| how the app boots | `src/runtime.ts` (`startApp`) |
| the bridge's port derivation, dev handshake, plugin selection | `src/runtime.ts` (`preferredPortFor`, `startBridgeFor`, `nativePlugins`, `selectedPlugins`) |
| a new plugin | `src/plugins/`, then add it to `corePlugins` **and** `nativePlugins` if it needs a native half — and to `RESERVED_PLUGIN_NAMES`' source list in `src/app.ts` |
| invoke/SSE behaviour, CSP, CORS, asset serving | `src/bridge/server.ts` |
| the page-side client | `src/bridge/client.ts` — keep `installCrust` self-contained; the served bootstrap and `crust/vite`'s injected client are both its own source text |
| a dev-server page's client | `src/vite.ts` — the two injected tags, the env/file lookup and the one warning |
| the config-free mode | `src/single.ts` (detection, bundle, document, runner) plus the single-file branch in `src/cli/dev.ts` / `src/cli/build.ts` |
| what a build embeds | `src/cli/build.ts` (`resolveAssets`, `assetsModuleSource`) |
| a new AppKit call | the matching part under `src/platform/darwin/shim/` plus a symbol in `compile()`, plus a `PREFLIGHT` entry — or a new C unit following `status_bar.c` if it is its own framework |
| window/application lifecycle | `src/platform/darwin/index.ts` (`DarwinPlatform`, `windowLiveness`) |
| a new config key | `src/config/schema.ts` (validator, `*_KEYS`, interface) — extra keys are rejected, so the allowlist is part of the schema |
| CLI behaviour | `src/cli/`, packaging in `src/packaging/` |
| a `crust doctor` check | `src/cli/doctor.ts` — `checkShim`, `classifyDevPort` (the four `dev.url` port states) and `watcherNote` (page-side `.ts` files the backend watcher would restart on) are the shape to copy: a pure classifier, a one-line detail, a `fail` only when the state is unlaunchable |

Two invariants worth restating because breaking them fails quietly. The `app` namespace is a plugin whose handler calls `app.invoke`, so app commands resolve at invoke time rather than being snapshotted into the bridge's table — which is why the namespace is registered independently of `config.plugins`. And `app.command`, `app.use` and `App.deferBridge` all refuse once `run()` has started, so `main.ts` must finish registering before its `await app.run()`; that refusal is the invariant, not an inconvenience.

## What this page does not claim

The code described above exists and is tested where a test can reach it; four things it is not:

- **The Next.js export path** (`build.assets: "out"` with `beforeBuildCommand: "bun --bun ./node_modules/.bin/next build"`) has been run once, end to end, through `crust build`: `next.md` records the export, the embedded files and the launch. What has not been observed is a person clicking around the exported app; client-side navigation and hydration are proven by the served markup and the `invoke` round trip, not by a human.
- **A dialog pick a human completed.** The sheet machinery has been exercised in a real window — the panel reported `sheetStarted`, stayed pending, and `-cancel:` resolved `{ paths: [] }` through the poll, for both the open and save panels — but nobody has chosen a file, so the OK response, a real path and the overwrite prompt are unobserved, and the free-standing path (a panel with no visible window) is covered by adapter tests but has not been entered at runtime.
- **A tray item seen on screen** has never been captured. An item was created, titled, shown, hidden and destroyed; AppKit readback reported a title, `isVisible: true`, a button window on the menu-bar row and the occlusion bit, while the screen capture contained no menu bar because the active Space was a fullscreen app. That is state, not pixels.
- **A delivered notification** has never been observed. Authorisation has been, and it was denied: inside a built `.app` the modern `UNUserNotificationCenter` path is entered and the callback fires with `granted = false`, so `notify` answers `delivered: false` with `UNUserNotificationCenter: authorization was denied`. The cause is unidentified; the app's signing identity is the untested candidate.

A window created by `window.create` has left that list: `bun run e2e:window` is scripted proof of it, 61 assertions, four windows created through the command. Three of them load a document that runs the suite's own page script in its own context and reports back, which is what turns "a second `NSWindow` exists" into an observation; the fourth proves a closed label is re-creatable and that a live one is refused with nothing released.
