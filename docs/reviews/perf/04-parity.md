# Perf parity review 04: Tauri and Rune, honestly

Lane D research deliverable for `docs/plan/perf/BRIEF.md`. Report only; no code changed.

## Method and limits

- Sources are shallow clones made for this review: `git clone --depth 1` into
  `~/dev/resources/tauri/{tauri,wry,tao}`. Nothing was built there. Pin with
  `git -C <clone> rev-parse --short HEAD`; no rev is frozen in prose.
- Rune source read at `~/dev/experiments/rune` (existing clone; not built, not modified). Pin with
  `git -C ~/dev/experiments/rune rev-parse --short HEAD`.
- Crust paths are relative to the worktree `~/dev/worktrees/crust/perf-research` (branch
  `perf/research`).
- **This lane ran no frame or latency harness.** Every "expected win" below is a hypothesis, not a
  measured result. Per `docs/plan/perf/BRIEF.md:8-18`, a fix lane must measure it: record
  `sysctl -n vm.loadavg` and the `bun` process count before/after, label any run over 2.0
  `contaminated`, and interleave A/B arms with a same-flag-vs-itself control row.
- Citations are `path:line` against the clone roots named above. Claims marked `unconfirmed` were
  not established by the files inspected.

## 1. Tauri: same system WebView, different wire and different main loop

Tauri embeds the same system WebView wry exposes: wry builds a `WKWebView` and registers
`WKURLSchemeHandler` objects on its `WKWebViewConfiguration` (`wry/src/wkwebview/mod.rs:69`,
`:259`, `:294-328`). Page layout, script and paint are WebKit's work, not tao's callback's work.

### Request/response path

- Invoke is a **custom-protocol fetch, not postMessage, in the default path**:
  `sendIpcMessage()` POSTs to `convertFileSrc(cmd, 'ipc')` with headers
  `Tauri-Callback`, `Tauri-Error`, `Tauri-Invoke-Key`, and reads the result from the response
  headers/body into `runCallback` (`tauri/crates/tauri/scripts/ipc-protocol.js:22-57`). The `ipc`
  scheme is registered in `tauri/crates/tauri/src/manager/webview.rs:290-296`, and the Rust handler
  turns a `POST` into `webview.on_message` and answers with `Tauri-Response: ok|error`
  (`tauri/crates/tauri/src/ipc/protocol.rs:38-75`, `:107-110`).
- **postMessage is the fallback, not the primary**: if the custom protocol fetch fails (blocked
  scheme or CSP), the script warns and resends through `window.ipc.postMessage`
  (`tauri/crates/tauri/scripts/ipc-protocol.js:59-85`); that entry point is wry's
  `with_ipc_handler` (`wry/src/lib.rs:1177-1181`). So "custom protocol vs postMessage" is an
  ordered pair, not two competing designs.
- **Batching: not confirmed.** The queues found are a pre-IPC init queue
  (`tauri/crates/tauri/scripts/core.js:68-105`) and a channel queue that stores large payloads in
  Rust and has the page fetch them by id (`tauri/crates/tauri/src/ipc/channel.rs:47-91`,
  `:300-320`). Neither is per-frame invoke batching. Claim "Tauri batches invokes" =
  `unconfirmed`.
- **No polling in the inspected IPC path**: invokes are fetch-driven and events are pushed from
  Rust by injected JS that calls `runCallback` on the listener
  (`tauri/crates/tauri/src/ipc/protocol.rs:38-75`,
  `tauri/crates/tauri/src/event/mod.rs:227-243`). No timer was found in those files; the universal
  negative "Tauri never polls anywhere" is `unconfirmed`.
- Crust contrast: per-call `fetch` POST to `http://127.0.0.1:<port>/_crust/invoke`
  (`src/bridge/client/invoke.ts:119-161`, `src/bridge/server.ts:35-78`), and pushes events over
  SSE (`src/bridge/server/events.ts:90-141`, `src/bridge/client/invoke.ts:179-197`). Crust
  already does **not** poll the bridge; "no polling" is `not-applicable` as a gap.

### What runs per frame, and what does not

- Tauri's Rust main thread runs tao's native event loop: `App::run` records the main thread id and
  hands control to the runtime loop (`tauri/crates/tauri/src/app.rs:1429-1458`); tao's `EventLoop`
  pulls system/window events and must be created on the main thread
  (`tao/src/event_loop.rs:27-38`, `:95-102`). No repeating JS timer drives AppKit drawing.
- wry's async custom-protocol responder is explicitly `Send` so protocol computation can run on a
  separate thread or async task (`wry/src/lib.rs:436-446`, `:1130-1142`). The exact queue on which
  Apple's `WKURLSchemeHandler` delegate callback itself fires is `unconfirmed`: the macOS handler
  calls the registered function directly with no explicit dispatch hop
  (`wry/src/wkwebview/class/url_scheme_handler.rs:184-324`).
- Crust contrast: `PUMP_INTERVAL_MS = 16` (`src/app-types.ts:117`) drives a self-rearming
  `setTimeout` chain (`src/platform/darwin/pump.ts:34-48`, `src/platform/darwin/platform.ts:77-82`).
  Each tick builds autoreleased `NSDate`/`NSEvent`/`NSString`/`NSValue` objects, calls
  `nextEventMatchingMask:...` with a 4 ms deadline, then `sendEvent:` and `updateWindows`
  (`src/platform/darwin/shim/50_app.c:72-77`, `:84-109`). A second 16 ms `setInterval` drains
  deep links (`src/app-loop.ts:131-140`). This is the clearest structural difference: crust does
  periodic native event work on a JS timer; tao does not.

## 2. Rune: native renderer, and why that smoothness is not all transferable

Correction to the framing: **Rune does not use GPUI.** Its own plan evaluates upstream GPUI and
rejects forking it (`rune/PLAN.md:61-67`); the analysis is `rune/research/01-gpui-zed-warp.md:23`.
Rune is described as a "native GPU-rendered Rust UI framework" (`rune/README.md:3`). GPUI itself
does have an instanced flat scene graph (`rune/research/01-gpui-zed-warp.md:29-49`) — but also
full-window redraws, no layer compositing, and main-thread animation
(`rune/research/01-gpui-zed-warp.md:16`, `:68`, `:198-200`). So "GPUI is smooth because of its
scene graph" is not supported by these sources.

What the native path buys, with limits:

- **GPU scene graph, one pass**: six instanced primitives and a GPU clip table, one render pass per
  typical frame (`rune/PLAN.md:24`, `:158-175`). No DOM, style recalc, layout or CSS compositor
  between the app and the drawable.
- **No JS bridge on desktop**: Rust view functions produce a keyed element tree; the app/render
  boundary is a serializable command channel carrying tree diffs, layout rects, text runs and
  springs (`rune/PLAN.md:22`, `:29`, `:105-130`).
- **No per-frame compositor handoff in the default path**: a display-link-paced render thread
  presents the Metal/wgpu drawable, with zero ticks at rest (`rune/PLAN.md:106-114`, `:177-181`).
  Honest caveat: Rune *does* hand off to the window server when it needs Liquid Glass, video or
  native layers, and those are main-thread AppKit objects (`rune/PLAN.md:183-196`). It also does
  not avoid a compositor in its WASM target (`rune/research/01-gpui-zed-warp.md:225`).
- **Not transferable to a system-WebView app**: crust cannot own the paint loop, skip DOM/CSS, or
  bypass WebKit's compositor without ceasing to be a WebView app. The brief states the shared
  compositor premise at `docs/plan/perf/BRIEF.md:22-26`. This is the inherent gap, not a backlog
  item.

## 3. Transfer list

Every win column is a hypothesis. `research/bridge.md:37-44` already measures crust's invoke
round trip at median `0.119 ms` / p99 `1.276 ms` on fresh sockets and `0.045 ms` on a reused
socket (`:307`), and SSE at `20.38 ms` median gap (`:88-94`); an IPC swap cannot be assumed to
move frame rate without a re-measure.

| Tauri technique | Crust file that would change | Status | Expected win (hypothesis) and measurement |
|---|---|---|---|
| Native event loop instead of a JS-timer AppKit pump | `src/app-types.ts:117`, `src/platform/darwin/pump.ts`, `src/platform/darwin/platform.ts`, `src/platform/darwin/shim/50_app.c` | `transferable` | Fewer 16 ms wakeups and no per-tick `NSDate`/`NSEvent` allocation. Measure frame-time p95, long tasks, main-thread delay and CPU with bridge idle and under load; compare against a same-flag control row. |
| Custom-protocol invoke (`ipc://` POST with header-carried callback) | `src/bridge/client/invoke.ts`, `src/bridge/server.ts`, `src/platform/darwin/webview-configuration.ts` (reuse the existing `WKURLSchemeHandler` at `src/platform/darwin/shim/110_network.c:146,173`) | `transferable` | Removes loopback socket work and the token-in-query for page invokes. Likely small: reused-socket cost is already `0.045 ms` (`research/bridge.md:307`). Must preserve the Origin/token model (`src/bridge/server.ts:3`) and wry's cross-platform Origin caveat (`wry/src/lib.rs:1060-1066`). Measure invoke p50/p95. |
| Async/off-main-thread protocol work (`RequestAsyncResponder` is `Send`) | `src/bridge/server/invoke.ts`, `src/bridge/server.ts` | `transferable` | Heavy plugin handlers stop blocking the Bun event loop. Measure event-loop delay and invoke p95 with a deliberately slow handler. |
| Large-payload channel: store bytes in the backend, fetch by id | `src/bridge/client/invoke.ts:52-85`, `src/bridge/server/bytes.ts` | `transferable` | Avoids base64 expansion and the page-side `atob` revive for binary results. Crust's 1 MB costs are already `2.4 ms` JSON / `1.8 ms` binary (`research/bridge.md:106-107`); measure 1 MB payload round trips before/after. |
| postMessage fallback / isolated world for the credential | `src/platform/darwin/content-world.ts:1-15`, `src/bridge/client/invoke.ts:96-117` | `not-applicable` | Crust already runs a `WKContentWorld` half and relays DOM `CustomEvent`s to the page; Tauri's fallback is crust's baseline, not a new gap. |
| Invoke batching | none | `not-applicable` | No batching of invokes was found in the cited Tauri paths (`unconfirmed` as a universal claim), so there is no demonstrated technique to copy. |
| Event no-polling | `src/bridge/server/events.ts` | `not-applicable` | Crust already pushes SSE frames and never coalesces them (`:1-6`, `:90-141`). |
| WebView compositor shared with Tauri | none | `not-applicable` | Same system WebView on macOS; not a differentiator (`docs/plan/perf/BRIEF.md:22-26`). |
| Display-link render thread, GPU scene graph, no JS bridge | would require replacing the WebView | `inherent` | Rune's frame path (`rune/PLAN.md:105-130`, `:158-181`) cannot be adopted inside crust without becoming a native renderer. Animations driven purely on a render thread are out of reach for a DOM-based page. |
| Zero idle ticks and no compositor handoff | would require replacing the WebView | `inherent` | Same reason; even Rune hands off for glass/video (`rune/PLAN.md:183-196`). |

## Bottom line

Three biggest transferable differences: (1) tao's native event loop vs crust's 16 ms JS pump that
drains AppKit events every tick; (2) Tauri's custom-protocol invoke with header-carried callbacks
vs crust's loopback HTTP POST; (3) off-main-thread protocol work and fetch-by-id for large payloads
vs crust's page-side base64 revive. One inherent gap: Rune's display-link-paced native GPU
renderer with no JS bridge and no per-frame compositor handoff — unreachable while crust's UI is a
system WebView.

Report: `docs/reviews/perf/04-parity.md` (this file, on branch `perf/research`).
