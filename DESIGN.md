# crust

A Bun-native desktop app framework. Matches Tauri's profile — system webview, no bundled Chromium, small app, fast cold start — without a Rust toolchain and without shipping a compiled native artifact.

**No Rust. Just crust.**

Status: design. Nothing implemented.
Target: macOS first, platform layer abstracted so Windows and Linux can be added later.
Published bar: a stranger can install it and open a window in ten minutes.

---

## 1. What it is

An `.app` produced by crust contains:

- one `bun build --compile` binary carrying the app's TypeScript and the Bun runtime, about 85 MiB
- the app's built frontend assets, embedded in that binary
- an `Info.plist`, an icon, and optionally a signature

The binary loads a system `WKWebView`, serves the frontend to it over a loopback HTTP server, and exposes a typed `invoke` bridge so page code can call Bun code and receive events.

Deliberate non-goals for v1: native widgets (webview only), Windows and Linux implementations, code-signed distribution with a Developer ID, mobile.

### The size truth

Tauri's floor is roughly 3–8 MB because it ships no JavaScript engine. crust's floor is roughly **85 MiB**, measured on this machine with Bun 1.4.4, because Bun embeds JavaScriptCore and the whole runtime ships inside the binary. A hello-world compiled to exactly 89,159,906 bytes; a build with three thousand functions added only 161 KiB to it, so the app's own code is noise against the runtime.

`--trim` is a **no-op on Bun 1.4.4 stable**: it is absent from `bun build --help`, unknown flags are accepted in silence, and the output is byte-identical with and without it. The 22.9 MiB figure circulating for compiled Bun binaries requires `--aot` on a canary build, and `--aot` does not exist in stable either.

This is a real correction to the plan: the size claim crust can make is "no bundled Chromium", which holds — an Electron app is several times larger — but it is not "half of Tauri". Against Tauri it is roughly ten times bigger, and that is the runtime, not the app.

Cold start is the good news, measured on the compiled binary without a webview: median 5.76 ms for the whole process, 4.37 ms to a listening `Bun.serve`. Webview creation is not in either figure and is the part still unknown.

**Accepted, 2026-11-12**: 85 MiB stands as the cost of shipping neither Rust nor Chromium, on the reasoning that cold start is the number a user actually feels. The size claim in any readme is "no bundled Chromium", never "as small as Tauri".

---

## 2. The central problem: no native artifact

There is no compiled shim. Every AppKit call crosses `bun:ffi` into the Objective-C runtime directly. That constraint drives most of the design.

### Prior art: BunKit

`scarletindustries/bunkit` does this already — real `AppKit` windows, tables, menus, and sheets driven from TypeScript on Bun, no webview, bundled into a `.app` by `bun run bundle`, on macOS arm64, Bun 1.4+, Xcode Command Line Tools required. Its API is `new Application()`, `new Window(...)`, `await app.run()`, which is the same shape crust wants. It is one contributor, eight stars, Apache-2.0, with no npm package and ad-hoc signing only.

The load-bearing detail is how it solves the two problems below: rather than hand-declaring a signature per selector, it reads each method's type encoding from the Objective-C runtime and calls `objc_msgSend` through **libffi**, which marshals arbitrary argument and return types. That is also why BunKit ships `native/build.sh` — it has a small compiled bridge over libffi, and so it violates crust's no-native-artifact rule. Reconciling those two is the single largest open question in this design.

```ts
import { dlopen, FFIType } from "bun:ffi";

const objc = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
  sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
});

const NSWindow = objc.symbols.objc_getClass("NSWindow");
const alloc = objc.symbols.sel_registerName("alloc");

const send = (receiver: number, selector: string, ...args: FFIType[]) => {
  const msgSend = /* a symbol declaring exactly this arg count */;
  return msgSend(receiver, objc.symbols.sel_registerName(selector), ...args);
};
```

### Four hard constraints this creates

1. **`objc_msgSend` is variadic, and calling it as variadic silently returns garbage.** Measured on this machine: `extern void *objc_msgSend(void *, void *, ...)` compiles and runs, but every call carrying an argument delivers wrong values — a `takeInt:` passed 41 arrived as 1806466472 — while the same call cast to a fixed prototype returned the correct result at every arity tried. Zero-argument sends happen to survive. TinyCC does not apply the arm64 variadic convention, so the fault is the declaration, not the ABI.
   The consequence: the signature ladder is mandatory, not optional, and its cost is paid at every call site.
   Two artifact-free routes exist:
   - **`cc()` with a shipped `.c` shim — measured working, and the current recommendation.** TinyCC compiles it in 2–8 ms at launch, links `-framework AppKit` and `-framework Foundation`, creates runtime classes with `class_addMethod`, and accepts a `JSCallback` back into C. The cost is one `.c` file in the package plus hand-written `extern` declarations, because framework headers cannot be included at all. **Decided 2026-11-12**: v1 ships this shim — both routes are artifact-free and measured, so it is a readability call, and libffi stays as the v2 option for dispatch from runtime type encodings.
   - **Driving libffi directly — proven, and still not the pick.** All six entry points resolve and a full CIF can be assembled from JavaScript, verified 22 of 22 checks and again inside a compiled binary. A marshalled send costs about 110–130 ns against 85–110 ns for the shim; a cached CIF brings it to 27 ns, and a `CFunction` over a `dlsym` handle — the shim's hot path — is 1.3 ns. Performance is therefore not what separates the two routes. It buys exactly one thing a hand-written `.c` shim cannot: calling through the runtime's own `method_getTypeEncoding` instead of a prototype someone wrote by hand. That is a v2 question, so v1 stays on the shim. Its traps are in `research/libffi.md`, the first being that `ffi_cif` is 40 bytes on arm64, not the 32 a reader would assume, and the overrun is silent.
2. **Struct arguments and struct returns are where a hand-declared ladder breaks.** `CGRect`, `CGSize`, and `CGAffineTransform` are the danger zone; libffi marshals them, a fixed prototype does not. Without libffi the mitigation is to keep the struct on the C stack: a shim function builds the rect and calls the initializer itself, so `initWithContentRect:styleMask:backing:defer:` is reachable while no struct crosses `bun:ffi`. Views are then positioned with Auto Layout constraints rather than `setFrame:`. `[[NSWindow alloc] init]` is **not** usable — see the traps below.

3. **Delegates require runtime class creation.** Window close, navigation policy, download handling, and web-process termination are all delegate callbacks. `objc_allocateClassPair` plus `class_addMethod` are callable through the same FFI surface, and an `IMP` can be a `JSCallback` — so a delegate is a class created at runtime whose methods point back into JavaScript. Signature is `void (id self, SEL _cmd, ...)`. This is the least certain part of the whole design and belongs in the spike, not in the polished phase.

4. **Nothing here is typed, and a bad selector kills the process.** Selector names are strings and argument types are hand-declared. Sending one the receiver does not implement raises an Objective-C exception that Bun cannot catch, so the process dies with `SIGABRT` and no JavaScript error is ever emitted — measured on this machine, `+[NSObject(NSObject) doesNotRecognizeSelector:]`. The mitigation is a binding layer that verifies every selector once at startup with `class_getInstanceMethod`/`respondsToSelector:` and refuses to send an unverified one, plus one place per AppKit object (`NSApplication`, `NSWindow`, `NSView`, `WKWebView`, `WKWebViewConfiguration`, `NSMenu`, `NSStatusBar`) and no stringly-typed selectors above that layer.

### Operational traps, all measured

- **A framework must be linked, not merely dlopened.** In a bare Bun process `objc_getClass("NSObject")` resolves while `objc_getClass("NSString")` and `objc_getClass("NSWindow")` return `null`, and `objc_msgSend` then "works" and returns null. That reads as a selector typo, not a missing library. `flags: ["-framework", "AppKit", "-framework", "Foundation"]` is required.
- **`cc()` ignores unknown option keys in silence.** `flags` is the only real one; `cflags`, `libs`, `frameworks`, `include` and a made-up key are all accepted and do nothing, so a wrong name looks like success. `-framework` works, `-F` is rejected.
- **`cc({ source })` takes a file path, not inline C text.** The shim therefore ships as a `.c` file in the package.
- **Framework headers cannot be included.** `<objc/runtime.h>`, `<stdlib.h>`, `<string.h>` resolve; `<AppKit/AppKit.h>`, `<Foundation/Foundation.h>`, `<CoreFoundation/CoreFoundation.h>` never do, with or without `-I`. Every symbol is an `extern` declaration over `void *`.
- **`objc_addMethod` does not exist on this system.** `class_addMethod` does, and it links.
- **`/usr/lib/libobjc.A.dylib` is not a file** — macOS keeps it in the dyld shared cache — but `dlopen` resolves it by that path. An empty symbol map fails with `Expected at least one symbol`, which reads as a missing library.
- **A JavaScript string cannot be passed into compiled C.** Pass `ptr(new TextEncoder().encode(s))` instead.
- **`i64`/`u64` returns arrive as `BigInt`, so `41n !== 41` fails in silence**, and `FFIType` has no `long` — use `i64`.
- **`read.ptr` truncates a 64-bit pointer** — `12071777346111146000` where the real value ends `…137`. Use `read.u64` and keep the `BigInt`; a symbol that *returns* a pointer arrives as an exact `number`, so only the buffer read is dangerous.
- **`-windowNumber` never clears, so it cannot detect a closed window.** Measured: `517` before `-close`, `517` one millisecond after (with `isVisible` already 0), still `517` a second later, and the same through `-orderOut:` then `-close`. AppKit keeps the device number for the life of the object, so `windowNumber === 0` only ever means "never ordered in" — using it as liveness leaves `window-all-closed` unreachable in every app. The correct rule, now in `windowLiveness`: a window is open while `visible || miniaturized || appHidden`, because Cmd+H orders every window out without closing one.
- **Short ASCII `NSString`s are tagged pointers and cannot cross at all.** `+[NSString stringWithUTF8String:]` on `"crust M0"` returned `10866411690164120000`, which is already imprecise by the time `bun:ffi` hands it back — a tagged pointer exceeds `2^53` — so every later send hits a corrupted object and answers wrong. `stringWithUTF8String:` also crashed Bun outright on 1.4.4. Keep short strings in C behind an integer handle, or build them with a constant CFString and never marshal the object.
- **Structs do not cross through `bun:ffi`'s own declarations, but they do cross through libffi.** `returns: FFIType.ptr` on a `CGRect`-returning function looks like it works and does not: `CGRectGetWidth` on the returned buffer, where JavaScript had verified `900.0` at offset 16, produced `1.35e-311`, and the same failure appears for `ArrayBuffer`, `TypedArray`, `DataView`, `Buffer` and `ptr(...)`. Two lanes then disagreed and both were right — when `ffi_call` is handed a hand-built `ffi_type` describing the struct, `{ size, align, type: 13, elements: [...] }` with libffi patching in size and align, a `CGRect` argument and a `CGRect` return both round-trip correctly, verified against AppKit's own `-frame` readback. The v1 rule is unchanged and simpler than either finding: the shim exposes struct-valued operations as C functions taking and returning scalars or pointers, so the question never arises. Where it cannot, KVC `valueForKey:@"frame"` returns an `NSValue` whose `-description` can be parsed.

---

## 3. The run loop

`[NSApp run]` never returns, so it cannot be called: Bun's JavaScript loop would never run again. Instead the Cocoa run loop is pumped from JavaScript — in short slices, on a slower tick.

```ts
setInterval(() => {
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.00025, true); // 0.25 ms slice
}, 16);
```

The slice length, not the tick, is what decides whether this works. Measured over three seconds of 16 ms ticks, the fraction of ticks delivered degrades monotonically as the slice grows: 0.25 ms and 0.5 ms both delivered 186 of 187 (99.5%), then 1 ms reached 96.8%, 2 ms 92.0%, and 4 ms only 82.4% with a p99 gap of 21.85 ms instead of 16.30 ms.

A 4 ms blocking slice, which an earlier draft of this document specified as the obvious choice, is **worse than not pumping at all** — not pumping delivered 184 of 187 at a p99 of 18.18 ms. CPU is the misleading metric here: it falls as the slice grows, while tick delivery is the honest one.

Startup order, measured: `NSApplicationLoad` (28–44.5 ms) → `sharedApplication` → `setActivationPolicy:0` → optionally `finishLaunching` → pump. Nothing else has to happen before pumping; return codes were identical with and without `finishLaunching`.

### The event-driven pump, and why it is closed to crust

BunKit does not poll at all. Its `br_pump` calls `nextEventMatchingMask:` with a single `NSDate` deadline, switches to `distantPast` once an event has been taken, runs each `sendEvent:` inside its own `@try`, gates `updateWindows` on activity or every fiftieth idle pass, and returns once the queue drains. `CFRunLoopRunInMode` appears nowhere.

That is strictly better than a 16 ms tick: events are handled as they arrive instead of at the next poll, and idle costs nothing. It is closed to crust for a narrow reason — `@try` is Objective-C syntax and `cc()`'s TinyCC compiles C only, so the one construct that makes the pump safe cannot be produced by the only compiler crust ships. That is not a reason to stop; it is the reason the polling pump is the design rather than a stopgap, and it is the sharpest argument on file for reopening the no-native-artifact rule later.

Consequences to accept:

- Every crust app carries a background timer. Accepted.
- Blocking JavaScript blocks drawing. Long synchronous work must be pushed off the main thread with `Worker`; the framework's own file I/O and network paths are async by default.
- Re-entrancy is real: a Cocoa callback fires *inside* a pump, so a delegate that calls back into JavaScript runs nested inside a timer tick. Delegate handlers therefore must not assume a clean stack and must not throw across the FFI boundary.
- Timer coalescing under power saving can stall the pump. Mitigation if it shows up: pump from a dedicated `setTimeout` chain that re-arms itself, which is less likely to be coalesced than a repeating interval.

### The inverse solution, and why it is closed to crust

Electrobun, the most mature Bun desktop framework, met the same AppKit constraint and solved it the other way round: a Zig and Objective-C++ core owns the process main thread and never returns, and the application's JavaScript is pushed onto a `Worker`. That is the better shape for native integration, and it is unavailable here, because it is exactly the native artifact crust refuses to ship.

So the pump is not a choice among alternatives. With no native owner of the thread it is the only option available, and it is unattested at framework scale while almost every other decision in this document has a shipped precedent.

---

## 4. The bridge

```
┌───────────────────────┐        HTTP + SSE        ┌──────────────────┐
│ WKWebView (page)      │ ───────────────────────► │ Bun.serve        │
│ window.crust.invoke() │ ◄─────────────────────── │ 127.0.0.1:<rand> │
└───────────────────────┘        events            └──────────────────┘
```

`Bun.serve` bound to `127.0.0.1` on port `0`, so the port is ephemeral and never collides. A per-launch token (`crypto.randomUUID()`) is injected into the served HTML as a bootstrap script, so page code has it and other local processes do not.

- `POST /_crust/invoke` — `{ plugin, command, args }` with `Authorization: Bearer <token>`; responds with the handler's result or a structured error.
- `GET /_crust/events` — server-sent events carrying pushes from Bun to the page.
- `GET /` and asset paths — the built frontend, with the bootstrap script injected into `index.html`.

Rejected because they were worse for this design: a custom URL scheme handler (needs `WKURLSchemeHandler` with its own runtime-created delegate and gives up ordinary HTTP tooling), and `evaluateJavaScript` in both directions (no request/response model, awkward for streaming).

Security posture: ephemeral port plus bearer token plus an `Origin` check plus an explicit CSP. Loopback is reachable by any local process, so the token is what actually protects it. The server must never serve a request without the token except for the initial document and its assets, and must refuse any request whose `Origin` is not the page's own.

Two isolation ideas worth taking from Electrobun: it ships two compiled preloads and the untrusted one carries no bridge, no key and no port, which is a stronger boundary than one page with a token; and it validates the sender on every inbound event. On the other axis crust is ahead — Electrobun has no `Origin` check at all, and its entire authorisation is a small integer plus the key.

### Measured on this machine

The bridge is fast enough that it is not a design constraint: an invoke round-trip over 200 calls has a median of **0.119 ms** and a p99 of 1.276 ms, against a same-process call at 0.0005 ms. The socket accounts for 99.6% of that cost, so a reused connection (0.045 ms) is worth having. Binding an ephemeral port takes 0.11 ms.

Security checks behave: a missing or wrong token gets `401` and the correct one `200`; own origin `200`, absent `Origin` **`403`**, foreign origin `403`. SSE delivered 20 of 20 frames in order with a 20.38 ms median gap and no coalescing. One-megabyte bodies take 2.4 ms as JSON and 1.8 ms as binary. A stopped server rebinds the same port in 0.45 ms and a child process exits clean in 12 ms.

Development has the shape predicted: from a Vite origin the bridge answers `204/200/200` with an echoed `Access-Control-Allow-Origin` and `Vary: origin`, while a foreign origin stays `403` even with the dev origin configured.

### Origin stability, an unfixed design gap

The bridge binds port `0`, so its URL — and therefore the page's origin — changes on every launch. Anything origin-scoped is then thrown away each run: `localStorage`, `IndexedDB`, cookies, service workers, and WebKit's per-origin caches. That is invisible for a hello-world and fatal for a client that wants to persist state, which is exactly what the M5 plan found.

Three candidate fixes, none measured yet: bind a port derived from the app id (stable, but a collision is possible and must be retried), serve the page from a custom `crust://` scheme via `WKURLSchemeHandler` (a stable origin with no port at all, at the cost of a runtime-created delegate and the HTTP tooling the current design leans on), or keep `port 0` and move persistence into a native store behind a plugin. The third is the smallest change and the largest loss of web-platform familiarity, so this is a decision to make before M5 rather than during it.

### App Transport Security

`WKWebView` will refuse a plain-http load unless `Info.plist` carries an App Transport Security exemption, and the key that governs a webview is not the local-networking one:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoadsInWebContent</key>
  <true/>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

`NSAllowsArbitraryLoadsInWebContent` is what covers webview content; `NSAllowsLocalNetworking` does not reliably cover a bare IP address on macOS 14 and later. Ship both, and prefer the hostname `localhost` over `127.0.0.1` so the local-networking case is the one that applies. Both keys ship in every generated `Info.plist`.

---

## 5. The API surface

Core is window, IPC, and build. Everything else is a plugin.

**Config** — `crust.json`, or `crust.config.ts` exporting the same object when a computed value is needed.

```ts
export default {
  app: { id: "land.jyz.example", name: "Example", version: "0.1.0", icon: "assets/icon.png" },
  windows: [
    { label: "main", url: "/", width: 1100, height: 760, minWidth: 720, title: "Example" },
  ],
  dev: { url: "http://localhost:5173", beforeDevCommand: "bun run dev" },
  build: { beforeBuildCommand: "bun run build", minimumSystemVersion: "13.0" },
  plugins: ["crust:fs", "crust:dialog", "crust:notification"],
  security: { csp: "default-src 'self'" },
} satisfies CrustConfig;
```

**Backend** — a Bun entry file.

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${name}`);
app.on("ready", () => console.log("windows open"));
await app.run();
```

**Frontend** — a global injected by the bootstrap script.

```ts
const greeting = await window.crust.invoke<string>("greet", { name: "jyz" });
const unlisten = window.crust.listen("tick", (n) => console.log(n));
```

**Plugins** — an object of handlers registered under a namespace, called from the page with the same `invoke`.

```ts
import { definePlugin } from "crust/plugin";

export default definePlugin({
  name: "fs",
  commands: {
    readTextFile: async ({ path }) => Bun.file(path).text(),
  },
});
```

v1 ships four: `fs`, `dialog`, `notification`, `tray`. `dialog` and `tray` need AppKit (`NSOpenPanel`, `NSStatusBar`); `notification` needs `UNUserNotificationCenter`, which arrives from a framework handle rather than `libobjc` and may pull in the first genuine FFI complication.

---

## 6. Platform seam

One interface, one implementation, no premature abstraction beyond what the interface costs.

```ts
interface Platform {
  start(): Promise<void>;
  pump(intervalMs: number): void;
  createWindow(opts: WindowOptions): WindowHandle;
  window(label: string): WindowHandle | undefined;
  quit(): void;
}
```

macOS lives in `src/platform/darwin/`. Windows and Linux are designed for, not written.

Be honest about where this ends: WebView2 is COM, and WebKitGTK is GTK's signal-and-object system. Both are far friendlier with a compiled shim than with raw FFI, so adding Windows or Linux will probably require relaxing the "no native artifact" rule. The seam exists so that decision is made in one directory instead of throughout the codebase, not because pure FFI will scale there.

---

## 7. The CLI

```
crust dev     # watch backend, restart the app process, frontend HMR stays with Vite
crust build   # compile the binary, assemble X.app, ad-hoc sign
crust sign    # Developer ID path, stubbed until a certificate exists
crust dmg     # drag-to-Applications disk image
crust doctor  # report why the app did not open
```

`crust dev` semantics, as chosen: a backend edit restarts the app process; a frontend edit is handled by Vite's own HMR, so UI state survives. The window loads the dev server URL directly. Because that page's origin is `http://localhost:5173` while IPC is on `127.0.0.1:<rand>`, development is cross-origin: the server answers CORS preflights for exactly the dev origin, and the token reaches the page through a Vite plugin that injects `window.__CRUST__` at transform time. Production has no Vite and no CORS; the server injects the bootstrap itself.

---

## 8. Packaging

```
Crust App.app/
  Contents/
    Info.plist          # CFBundleIdentifier, LSMinimumSystemVersion, ATS, allowed JIT entitlement
    PkgInfo
    MacOS/crust-app     # bun build --compile output, ~85 MiB
    Resources/icon.icns
```

`CFBundleIdentifier` belongs in `Info.plist` and a real bundle needs one, but the specific claim that `WKWebView` requires it is unverified: a webview was constructed successfully with a null bundle identifier. Treat storage and data-store keying as an open question rather than a constraint. A bare executable also cannot be double-clicked from Finder, which is why the `.app` is the shipping unit and "single binary" means "one binary inside a bundle", not "one file on disk".

Signing now: ad-hoc (`codesign --sign -`). That works locally and produces an app Gatekeeper will refuse on any other machine, because an ad-hoc signature cannot be notarized. Distribution before a Developer ID exists means the recipient runs `xattr -dr com.apple.quarantine` or right-clicks Open. This is a documented consequence, not a bug.

Signing later: hardened runtime plus `com.apple.security.cs.allow-jit`. The entitlement is kept, but its necessity is **unproven for Bun's own runtime** — `new Function` executed correctly under `--options runtime` with no entitlement at all. The `WKWebView` WebContent process is the case that has not been measured, and it is the one most likely to need it. Developer ID `codesign`, then `notarytool submit --wait`, then `stapler staple`. The build pipeline gets a signing identity and notarization credentials from the environment; `crust sign` fails with a clear message when they are absent.

### Installing crust itself

Three paths, and they differ in what they need on the machine:

`brew install JeffreyJYZ/tap/crust` installs a **source formula**: crust is TypeScript that Bun runs, and its runtime compiles the bundled `.c` shim at launch with the TinyCC inside Bun, so there is no build step and nothing to bottle. Bun is a dependency, the way Python is for a Python tool. Measured on macOS 27 arm64: 87 files, 589 KB in `/opt/homebrew/Cellar/crust/0.1.1`, `bin/crust` a wrapper around `libexec/src/cli/index.ts`, and `crust doctor` in a `--next` scaffold reporting the shim compiling out of the Cellar with the bridge answering `pong` — which is the part a wrong `libexec` layout breaks.

`bunx github:JeffreyJYZ/crust` needs no install, and it caches its resolution under a hash of the specifier: a bare spec keeps serving the commit it first resolved, so a command added on `main` reports `unknown option`. Naming a ref resolves fresh; it goes stale the same way afterwards. This is a bunx property, not a crust one, and it is why a version bump does not fix it.

The npm tarball path exists (`bun pm pack`) and is checked by `bun run verify:package`, which packs, unpacks, installs into a temp directory and runs `crust --help` and `crust init probe --react` from the installed copy alone: 32 checks, 162.2 KiB. That check is not ceremony — 0.1.0 shipped without the `tsconfig.json` that defines the `@/` alias, and an installed copy could not start at all until the file set included it.

**Open question, now measured — it does not ship as one binary today.** `bun build --compile --minify --trim --target=bun-darwin-arm64 src/cli/index.ts` produces 85.09 MiB (identical with and without `--trim`; 24 modules, 116 ms). The binary loads, `--version` and `--help` work even with Bun off `PATH`, and the three things feared to break do not:

- `bun:ffi`'s `cc` compiles C at runtime inside a compiled executable. Measured: a probe launched windowed out of the binary wrote `crust-shim-*.c` and `crust-status-bar-*.c` into `TMPDIR`, TinyCC compiled both, WebKit's GPU/WebContent/Networking XPC processes spawned, and the page inside `WKWebView` called back through the bridge — `app answered the page`, `GET / -> 200`, `GET /page.js -> 200`, then SIGTERM to the group and exit 0.
- `Bun.build` runs from it: `crust doctor` in a single-file directory bundles the page successfully.

What breaks is path resolution, in four places. `crustRoot` is `resolve(import.meta.dir, "..", "..")`, which collapses to `/` in a compiled binary, so `crust init` fails for every template (`no templates/react (expected /templates/react)`), and the generated runner imports `/src/index.ts`, `/src/runtime.ts` and `/src/single.ts` — `/$bunfs/...` or `/src/...`, paths that exist on no disk. `crust dev` spawns `"bun"` from `PATH` rather than `process.execPath`, and `crust build` does the same through `src/packaging/build.ts`.

So the prerequisite for a standalone binary is embedding, not a runtime capability. Templates and the shim are embedded now (`--asset`, read through `src/cli/assets.ts`), `crustRoot` finds the package root by marker search, and a 89,407,586-byte binary runs `crust --version`, `crust init --next` and a full `crust doctor` with Bun off `PATH` and no checkout. What still needs real files is `dev` and `build`: the entry they generate imports `src/runtime.ts` and `src/single.ts` at absolute paths, and a child `bun build --compile` cannot read a path inside another executable. The remaining fix is the trick the shim already uses — embed those sources as text, materialise them beside the generated entry.

AOT is a separate axis and is not a speed win: canary `bun compile` produced 56.1 MB (38.2 MB with `--trim`) against 136.3 MB for `--no-aot`, with startup 12.5 ms versus 10.8 ms, and a 300M-iteration loop 215.2 ms against 211.9 ms — JSC's JIT beats the ahead-of-time output on this workload. AOT also refuses `import()` from disk, which crust needs for the user's `crust.config.ts`, so it would require `--aot-allow-code-from-disk` and would then lose most of its size advantage.


---

## 9. Risks, ranked

1. **Variadic `objc_msgSend` with no compiled artifact — resolved, with a trap.** `cc()` is measured working end to end, so no native artifact is needed and the ladder stays internal to the shim. The residual risk is ergonomic, not existential: every send goes through a fixed prototype, and a mistake returns wrong values with no error anywhere.
2. **Runtime-created delegates with `JSCallback` IMPs.** Without them there is no window close event, no navigation policy, no download handling. Second thing to prove.
3. **Sub-300 ms cold start.** Bun starts in tens of milliseconds and `WKWebView` creation plus web-process launch is the expensive part. If HTTP serving is the difference, fall back to `loadHTMLString` for single-file builds or a scheme handler for split assets.
4. **Struct-free AppKit is mandatory, not merely tidy.** Structs cannot be passed or returned across `bun:ffi` on 1.4.4, including through the indirect-result pointer. The rect is therefore built on the C stack and the initializer is called from C — `shim_window_new` in the spike does exactly that — while views are positioned by Auto Layout constraints. `setFrame:` appears nowhere. Note that `[[NSWindow alloc] init]` is not a shortcut for this: it aborts the process from AppKit's own event thread, measured below.
5. **`UNUserNotificationCenter`** needs a bundle identity and may not be reachable from `libobjc` alone, which would block the `notification` plugin.
6. **Windows and Linux** almost certainly need a compiled shim. Accepted as a later decision.
7. **AppKit's nested run loop freezes JavaScript.** BunKit documents this: modal dialogs, menu tracking, live resize, and drags enter a nested run loop that blocks the JavaScript thread until the user lets go. For a webview app the damage is limited — the window still resizes, but the bridge stalls during a live drag — and it is the reason v1 exposes no native menus.
8. **The pump is measured in isolation but unattested at framework scale.** Electrobun avoided it entirely by owning the main thread from native code, and BunKit needed a native bridge as well. In isolation the pump holds 99.5% tick delivery at a 0.25 ms slice, which is enough to proceed. What is still unknown is its behaviour with a drawing window, under long synchronous work, and under power-saving coalescing. If it degrades there, the answer is not a cleverer pump; it is reopening the no-native-artifact rule.

---

## 10. Milestones

**M0 — spike. DONE, 2026-11-13.** A real `NSWindow` with a real `WKWebView`, driven from TypeScript over a shipped `.c` shim, pumped from JavaScript: the design works.

Measured: shim compiled 17.9 ms · `NSApplicationLoad` 46.3 ms · window via `initWithContentRect:` 31.36 ms · **`WKWebView alloc+init` 165 ms** · six constraints 1.64 ms · `Bun.serve` 1.57 ms · **`isVisible=1` at 299.5 ms** · page reported back 925.2 ms after window creation · webview frame read through KVC as `0,0 1100x760` · two resizes survived · 26 seconds alive with no crash.

Three things the spike settled the hard way, all now traps in §2: `[[NSWindow alloc] init]` aborts on AppKit's event thread, a short ASCII `NSString` cannot cross `bun:ffi` at all, and `stringWithUTF8String:` crashes Bun outright. The URL path therefore runs entirely inside C.

The remaining startup cost is WebKit's own process launch, so the sub-300 ms claim holds for *window visible*, not for *page painted*.

**M1 — bridge. DONE, 2026-11-13.** Ephemeral port, token injection, invoke, SSE, assets embedded in the binary. Measured: 0.064 ms median invoke, 0.142 ms p99 on a reused connection; 47 tests over bridge and plugins; every rejection rule asserted.

**M2 — packaging. DONE, 2026-11-13.** `crust build` emits an 85.12 MiB ad-hoc-signed `.app` whose binary runs directly and exits 0; `Info.plist` carries both ATS keys; `crust doctor` runs nine checks and exits 1 naming the failure. Icon generation exists; it has only been proven on its rejection path, since no ≥1024 source was available.

**M3 — dev workflow. DONE for both shapes.** `crust dev` restarts the backend process, passes `CRUST_DEV_URL`, and the bridge answers a Vite origin with the dev CORS shape. The watcher ignores frontend and build output (`public`, `dist`, `node_modules`, `.next`, `out`, `.crust`); before `.next` and `out` were excluded, `next dev` restarted the backend twice in one page load, and a restart rotates the bridge token, so a loaded page started failing with a missing bearer token. `crust dev app.tsx` is the config-free shape: it bundles one file, writes `.crust/single/`, and rebuilds on save without restarting the runtime. Three scripts prove it — `e2e:dev` (4 assertions), `e2e:single` (19, including the rebuild and the syntax-error path) and `e2e:dev:binary` (12, driven by the compiled binary with no Bun on `PATH`). A real Vite **HMR** session is still unexercised: a save is a full reload.

**M4 — plugins. DONE, with three honest gaps.** `fs` reads and writes for real. `dialog` shows a non-blocking sheet with `filters` applied and falls back to `-runModal` only when no window exists; a completed pick has never been observed. `window` exposes close, focus, setTitle, list and isOpen. `tray` builds a real status item and menu — AppKit readback confirms title, visibility and the menu-bar frame, but nobody has seen it on screen, because the only Space available was a fullscreen app, where macOS draws no menu bar. `notification` reaches `UNUserNotificationCenter` and reports `{"delivered":false,"reason":…}` truthfully rather than pretending; no run has produced `delivered: true`, and the signing identity is the untested candidate.

**M5 — dogfood. NOT STARTED.** The opencode client has not been run on crust. This remains the milestone that decides whether the design is right.

**M6 — ship story. PARTIAL, and installable today.** `brew install JeffreyJYZ/tap/crust` installs a source formula — crust is TypeScript Bun runs, so there is nothing to bottle — and 0.1.4 is what it serves. `crust dmg` produces a 38.70 MiB image through `diskutil image create from`. `bun run build:standalone` also compiles crust into one 89.9 MB executable that scaffolds all three templates, runs `doctor` and runs `dev` with no Bun and no checkout, because the child is the binary re-executed under `BUN_BE_BUN=1`. The Developer ID path is written but has never been exercised, because no certificate exists here.

A stranger's path is now measured end to end in one script: `bun run verify:first-run` scaffolds, installs, builds, launches and requires the page's `invoke` to answer — and it caught a scaffold that installed but could not build (`bun x vite build` ran vite under the user's Node, which fails outright on Node 27). What "published" still needs is npm distribution, or a Developer ID for distributable apps; the first waits on 2FA and the second on a certificate.

---

## 11. Measurement plan

Claims only count with numbers attached, and each number needs the command that produced it.

- **Cold start** — timestamp at the first line of the Bun entry, timestamp inside the page at `window.crust.ready`, and the difference. Measure by running the binary inside the bundle directly, `App.app/Contents/MacOS/<bin>`, ten times, reporting median and worst. Never `hyperfine "open -W -a …"`: that times LaunchServices, not the app.
- **Idle RAM** — the whole process group: the app binary, WebKit's `WebContent`, `GPU`, and `Networking` helpers. `ps` RSS overstates cost because the WebKit helpers share read-only framework pages, so report `vmmap --summary` physical footprint alongside RSS, as a range, never a single figure.
- **Binary size** — the compiled binary and the assembled `.app` separately, and record that `--trim` changed nothing on Bun 1.4.4 rather than reporting it as applied.
- **IPC latency** — in-page `performance.now()` before and after a no-op `invoke`, over a hundred calls, median and p99.

Anything not measured is written down as a guess.
