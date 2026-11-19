# Agentic testing: capture, drive, assert

Goal: an agent can start a crust app, look at it, click and type into it, assert on what is on screen,
and get an artefact when it fails — without a human, without moving the cursor, and without asking
macOS for Accessibility or Screen Recording.

## The constraint that fixes the design

Real OS input (CGEvent mouse/keyboard, `cliclick`, AppleScript clicks) moves the human's cursor and
requires Accessibility permission. It is banned in this repo. So input happens **inside the page the
app owns**: `evaluateJavaScript` in the app's own webview, dispatching DOM events. From the app's
point of view those are ordinary events; from the machine's point of view nothing moved.

Capture is likewise the webview's own render — `-[WKWebView takeSnapshotWithConfiguration:]` — not the
display. That needs no Screen Recording grant, and `CGWindowListCreateImage` (which would) is
deprecated on macOS 14+ anyway.

## Surface

### `window.capture` — one label, one PNG

```
invoke("window", "capture", { label }) →
  { ok: true, width, height, scale, png }   // png is base64, the page as rendered
  { ok: false, code: "not-implemented", requires: "…" }   // platform without it
```

Sized in page pixels at the window's scale factor, so a 2x display yields a 2x bitmap.

### `testing` namespace — drive and observe

Every command takes `label` and runs in that window's page. Refusals are the existing codes:
`unknown-window`, `not-found` (selector matched nothing), `not-implemented`, `handler-error`.

```
click { label, selector }            scrolls into view, focuses, clicks; answers { clicked: true }
clickAt { label, x, y }              elementFromPoint(x,y) and click it
type { label, selector?, text }      focuses, sets the value through the native setter so framework
                                     state updates, then dispatches input; answers { value }
key { label, key, modifiers? }       KeyboardEvent through the page (note in the docs: synthetic
                                     events do not trigger browser defaults like navigation)
hover { label, selector }
query { label, selector }            { exists, visible, rect, text, value, attributes }
waitFor { label, selector, timeoutMs }  resolves when the element exists, rejects on timeout
console { label, since? }            page console entries captured from document start
```

`console` needs a page-side hook installed at document start — the bridge already injects into its own
content world, and console capture has to run in the page's world, so that is a bridge change, not a
plugin one.

### `crust test <file>` — the harness (later)

Runs a test file with Bun, launches the app, hands it a client that wraps the two surfaces above,
writes `dist/test-artifacts/<name>.png` on failure, exits non-zero. Not in this wave: it consumes both
surfaces and should be written against them once they exist.

## Lane split

- **A — capture.** `src/platform/darwin/**` (shim + adapter) and the `window` plugin's command table,
  types, fake and docs. Must answer honestly where a platform cannot.
- **B — testing namespace.** A new plugin under `src/plugins/`, registered in `src/plugins/core.ts`,
  the bridge's page-world console hook, tests, and its capability wiring.

They meet at `src/plugins/core.ts` and the bridge; A must not need either beyond its own window
command, and B owns registration.

## Rules for both

- A command that cannot work on a platform answers `not-implemented` **with `requires` naming the API**,
  never a silent success.
- No command may move the cursor, post a CGEvent, or ask for Accessibility/Screen Recording.
- The fake plugin must answer the same shapes, so the plugin tests need no window.
- Every refusal and answer shape gets a test; a doc claim that is not in the code is a defect.
