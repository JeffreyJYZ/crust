# Architecture

One page for someone changing this codebase. It explains the four moving parts, where the boundary between them sits, and which files encode the traps that will bite anyone who edits them.

Measurements are deliberately not repeated here. Every number, and the command that produced it, is in [DESIGN.md](../DESIGN.md): §1 size, §2 the AppKit constraints and traps, §3 the run loop, §4 the bridge, §6 the platform seam, §9 risks, §10 milestones.

## The shape of a running app

```
bun (one process, one JavaScript thread)
│
├── src/runtime.ts        startApp(): config → plugins → bridge → platform → import main.ts
│   ├── src/bridge/       Bun.serve on 127.0.0.1:<ephemeral>, one token, invoke + SSE
│   ├── src/plugins/      definePlugin, the registry, the five built-ins
│   ├── src/app.ts        `app` — the surface main.ts uses; owns the Platform seam
│   └── src/platform/darwin/
│        ├── index.ts     the only Platform implementation, selectors, guards
│        ├── shim.c       window, webview, application; compiled at launch by cc()
│        ├── status_bar.c + status-bar.ts          the tray's NSStatusItem
│        └── notifications.c + notifications.ts    the notification centre
│
└── WKWebView             the page, loaded from the bridge or a dev server
```

Two entry points matter. `src/cli/index.ts` is the `crust` command. `src/runtime.ts` is the process that actually runs the app: `crust dev` spawns it (`src/cli/dev.ts`, through `Bun.spawn`), and a built binary's generated wrapper calls `startApp()` with an embedded config and an `entryModule`. Both paths converge on `startApp`. One detail to know before trusting the environment: `dev.ts` sets `CRUST_DEV_URL` on the child, but nothing in `src/` reads it — the dev URL the app uses is `config.dev.url`, resolved inside `startApp`.

`startApp` does five things in a fixed order, and the order matters:

1. load and validate the config (`loadConfig` / `validateConfig`);
2. build the plugin registry — the core plugins the config selected, the `app` namespace, and the platform's native adapters for `dialog`, `tray` and `notification`, plus `window`;
3. start the bridge with that registry as its handler source;
4. attach the platform, the config and the bridge URL to the `app` singleton;
5. import the user's entry, which registers commands and calls `app.run()`.

The platform is constructed *before* the plugins because `window`'s adapter reads labels and native pointers from that same instance, and the bridge is started *before* the entry is imported so `main.ts` can register commands against an already-listening server. Both are comments in `src/runtime.ts`; both are load bearing.

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
- **`createWindow(options)`** opens a window and returns `{ label }`. Throws on an empty label and on a duplicate label. `minWidth` is carried in `WindowOptions` but no implementation applies it.
- **`window(label)`** is the liveness query: the handle while the window is open, `undefined` once it has closed. `run()`'s `window-all-closed` watcher depends on it, and on macOS a closed window stays addressable because it was created with `setReleasedWhenClosed: NO`. Note that the `window` plugin's `list` does *not* filter this way: `Platform.windowLabels()` (a macOS extra, not part of the interface) returns every tracked label, including one whose window has closed and not yet been pruned by `window(label)`.
- **`quit()`** ends the application. On macOS it stops the pump, sends `terminate:`, and exits the process.

Only `src/app.ts` and `src/platform/darwin/index.ts` implement or consume this. The lazy `import("@/platform/darwin")` in `App.#loadPlatform` is what lets the bridge, the config and `bun check` load on a machine with no AppKit, and what keeps the shim uncompiled in a process that never opens a window.

Adding a second platform is meant to be a decision made in one directory. Be honest about the cost: WebView2 is COM and WebKitGTK is GTK's object system, so a second implementation will probably need a compiled shim and therefore a relaxation of the no-native-artifact rule — `DESIGN.md` §6 says the seam exists to localise that decision, not to promise pure FFI scales.

## The C shim: why it exists, and why it is compiled at launch

Every native call is made through a C unit compiled at runtime by `cc()` from `bun:ffi`. There is no prebuilt native artifact in the package. Three units exist: `src/platform/darwin/shim.c` for the window, the webview and the application; `status_bar.c` for the tray's `NSStatusItem`; and `notifications.c` for the notification centre. Each obeys the same four rules — one fixed prototype per `objc_msgSend` arity, no framework headers, no struct across the FFI, and strings crossing as encoded buffers — and each is loaded the same way: imported as text, hashed, materialised to `$TMPDIR`, compiled.

**Why a shim at all.** `objc_msgSend` is variadic. Declaring it as variadic and calling it delivers wrong argument values; the only safe call is through a fixed prototype per arity. `shim.c` supplies exactly one fixed-prototype wrapper per arity and per return kind (`shim_send_p0`, `shim_send_pq1`, `shim_send_vb1`, …), and the JavaScript side has one guarded wrapper per wrapper (`S.p0`, `S.pq1`, `S.vb1`, … in `src/platform/darwin/index.ts`). The shim also exists for the two cases the FFI cannot express: struct arguments and struct returns. `CGRect` is built on the C stack inside `shim_window_new` and the initializer is called from C, so no struct ever crosses the boundary; views are positioned with Auto Layout constraints, and `setFrame:` appears nowhere. The reasoning and the measurements behind both claims are `DESIGN.md` §2 and §9 items 1 and 4.

**Why compiled at launch instead of shipped.** `cc()` compiles C from a file path in roughly 3–20 ms (the comment on `shim()` in `src/platform/darwin/index.ts`; 17.9 ms measured in `DESIGN.md` §10), which is cheaper than shipping and signing a `.dylib`, and it keeps the no-native-artifact promise. Two consequences are encoded in `compile()`:

- `cc({ source })` takes a **path**, and inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where a shipped `.c` file does not exist. So `shim.c` is imported as text (`import shimSource from "./shim.c" with { type: "text" }`), hashed with SHA-256, written to `$TMPDIR/crust-shim-<hash>.c` on first use, and compiled from there. The hash means a second launch reuses the file and TinyCC's per-path cache.
- Every framework is linked explicitly with `flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit", "-framework", "CoreFoundation"]`. A dlopen'd libobjc resolves `NSObject` but not `NSString`, so an unlinked framework reads as a selector typo (`DESIGN.md` §2).

**Preflight, then guard.** Nothing is sent blind. `PREFLIGHT` in `src/platform/darwin/index.ts` lists every class and instance selector the window shim uses, including the ones the shim itself sends (the `NSString` / `NSURL` / `NSURLRequest` chain, `NSPlaceholderString`'s initializer, `valueForKey:` / `getValue:`), because C cannot verify them. `start()` tests each one — `respondsToSelector:` for class receivers, `class_getInstanceMethod` for instance receivers — and fails with all the missing ones named at once. At call time the `guard`/`must` pair checks the receiver and caches the answer per `(class, selector)`. The other two units do the same job in their own shape: they check for the class and selector before sending and report a status code (`NOTIFICATION_STATUS`, and the tray's status constants) rather than throwing through the bridge. The reason is not tidiness: an uncaught Objective-C exception terminates the process with `SIGABRT` and never becomes a JavaScript error.

## The pump and its 0.25 ms slice

`[NSApp run]` never returns, so it cannot be called from Bun. Instead the Cocoa run loop is pumped in short slices from JavaScript:

- `App.run()` calls `platform.pump(PUMP_INTERVAL_MS)`, which is 16 ms (`src/app.ts`);
- `DarwinPlatform.pump` re-arms a **`setTimeout`** chain, not a repeating interval, because an interval is the thing power-saving coalesces (`DESIGN.md` §3);
- each tick calls `shim_pump`, and `shim_pump` is `CFRunLoopRunInMode(mode, 0.00025, 1)` — a 0.25 ms slice (`shim.c`).

The slice length, not the tick, is what decides tick fidelity; `DESIGN.md` §3 has the delivery table and why a longer slice is worse than not pumping at all. Two consequences a contributor must keep in mind:

- **Blocking JavaScript blocks drawing.** Anything long belongs on a `Worker`. The bridge and the plugins are async for this reason, and the modal `NSOpenPanel` path is documented as blocking on purpose.
- **Re-entrancy is real.** A Cocoa callback fires inside a pump tick, so anything it calls back into JavaScript runs nested inside a timer.

The run-loop mode is resolved once by `shim_mode()` and verified by `shim_mode_ok()`, because a wrong mode is a silent no-op: `kCFRunLoopDefaultMode` is a data symbol that cannot be called through `bun:ffi`, so the shim builds a constant `CFString` and compares its contents.

## The bridge: token and origin rules

`src/bridge/server.ts` is `Bun.serve` on `127.0.0.1` with `port: 0`, so the port is ephemeral and two instances cannot collide. The security posture and its measurements are `DESIGN.md` §4; this is what the code enforces.

**Token.** One per launch, `crypto.randomUUID()`. It is injected into the served document as part of the bootstrap script, which is `installCrust.toString()` called with the config (`bootstrapSource` in `src/bridge/client.ts`). The page therefore holds it and other local processes do not. The client sends it as `Authorization: Bearer <token>`; the event stream cannot set headers, so `GET /_crust/events` also accepts `?token=`.

**What is token-free.** The document and its assets, and nothing else: any `GET`/`HEAD` whose path does not start with `/_crust/`. That is unavoidable — the page cannot present a token before it has been served — and it is why the token protects IPC, not the HTML/JS/CSS the page is made of.

**Origin.** For every `/_crust/*` request the server requires an `Origin` header and refuses an absent one:

- `http://127.0.0.1:<port>` and `http://localhost:<port>` are the bridge's own origins and are always allowed;
- a configured `devOrigin` (string or list, from `StartBridgeOptions`) is also allowed, and only those origins get CORS headers and a `204` preflight;
- anything else, including no header at all, is `403 bad-origin`.

Refusing an absent `Origin` is the point: a local non-browser client sends none, and skipping the check when the header is missing would let any local process drive the bridge. The `Origin` check runs before the token check, so a browser error is `bad-origin`, not `unauthorized`.

**Everything else on the wire.** `DEFAULT_CSP` is applied to documents and overridable by `security.csp`; it must keep `connect-src 'self'` or every invoke becomes a CSP violation. Bodies over 2 MiB are refused (`too-large`, 413) before parsing. `idleTimeout: 0` disables Bun's 10 s default, which would cut an idle event stream. `emit` writes `event: <name>\ndata: <json>\n\n` to every subscriber and drops a subscriber whose enqueue throws.

## The four traps

Each of these has already cost a debugging session. The file beside each one is where the fix lives; `DESIGN.md` §2 records the measurement.

1. **`[[NSWindow alloc] init]` aborts the process.** `NSWindow`'s designated initializer is `initWithContentRect:styleMask:backing:defer:`; a bare `init` returns a half-built window that AppKit's own event thread later messages, which is an uncaught exception and a `SIGABRT`. Encoded in `src/platform/darwin/shim.c`: the comment above `shim_window_new`, and the function itself, which builds the rect on the C stack and calls the designated initializer. `DarwinPlatform.createWindow` calls that symbol and never sends `init` to a window.
2. **A short ASCII `NSString` is a tagged pointer and cannot cross `bun:ffi`.** Values above 2^53 are already imprecise when they come back, so every later send hits a corrupted object. Encoded in `shim.c`: `shim_window_set_title` builds the string and applies it natively, `panel_nsstring` does the same for the open panel, and `shim_webview_load` builds the URL chain entirely inside C. JavaScript never receives one. `DarwinPlatform.createWindow` and `darwinWindowAdapter.setTitle` read the applied title back and throw on a mismatch, so a silent no-op cannot pass as success.
3. **`+[NSString stringWithUTF8String:]` crashes Bun outright.** Encoded in `shim.c`: the comment in `panel_nsstring`, and the fact that every string in the file is built with `-initWithBytes:length:encoding:` (encoding `4`, `NSUTF8StringEncoding`). A JS string is never passed into C either; `cbuf` in `index.ts` encodes it to a `Uint8Array`, keeps the buffer alive for the process lifetime, and passes its address.
4. **`read.ptr` truncates a 64-bit pointer.** A pointer read out of a buffer loses the high bits and faults later at something like `0x10`, far from the cause. Encoded in `src/platform/darwin/index.ts` by not reading pointers out of memory at all: a symbol that *returns* a pointer arrives as an exact `number`, and `ptrValue` refuses anything else (a `BigInt` from an `i64` return, a missing symbol) instead of coercing it. `i64` arguments are converted up to `BigInt` explicitly (`S.pq1`, `S.vq1`).

These are properties of `bun:ffi`, not of the window shim: `status_bar.c` and `notifications.c` obey the same four rules, build their strings with `-initWithBytes:length:encoding:`, and never hand an object across the boundary. A new C unit that breaks one of them will fail the same way, in the same place — at a later send, not at the mistake.

## Where to change what

| change | file |
| --- | --- |
| a new app-surface method or event | `src/app.ts` (`App`, `AppEvent`) |
| how the app boots | `src/runtime.ts` (`startApp`) |
| a new plugin | `src/plugins/`, then add it to `corePlugins` **and** the runtime's selection if it needs a native half |
| invoke/SSE behaviour, CSP, CORS | `src/bridge/server.ts` |
| the page-side client | `src/bridge/client.ts` — keep `installCrust` self-contained; the served bootstrap is its own source text |
| a new AppKit call | `src/platform/darwin/shim.c` plus a symbol in `compile()`, plus a `PREFLIGHT` entry — or a new C unit following `status_bar.c` if it is its own framework |
| window/application lifecycle | `src/platform/darwin/index.ts` (`DarwinPlatform`) |
| a new config key | `src/config/schema.ts` (validator, `*_KEYS`, interface) — extra keys are rejected, so the allowlist is part of the schema |
| CLI behaviour | `src/cli/`, packaging in `src/packaging/` |

Two invariants worth restating because breaking them fails quietly: `app` command handlers are looked up, never snapshotted, which is why `main.ts` can register after the bridge starts; and the `app` namespace is registered independently of `config.plugins`, which is why app commands keep working when the plugin list is narrowed.
