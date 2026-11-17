# Lane C — the credential lives in a content world the page cannot read

Read `../fix-wave/BRIEF.md` first. Read `docs/agents/csp-nonce.md` once Lane A has written it — this
lane touches one of the same two files and must not fight it.

## The problem this solves

Today the page holds its own token: `bootstrap.ts` reads it from `location.search` and closes over it.
Any script running in the page can therefore read it, and — more importantly — can **patch
`window.crust.invoke`** to do whatever it likes, or scrape the token out of the client.

A CSP nonce stops *new* `<script>` tags. It does not stop a payload already running, and it cannot
stop a first-party script that a dependency compromised.

## What macOS gives us

`WKUserContentWorld` (macOS 11+) is a JavaScript world separate from the page's: the page cannot see,
read or patch its globals. `WKUserScript` can be added with `injectionTime: atDocumentStart` and
`forMainFrameOnly: yes` into that world. That is the primitive Tauri's isolation pattern builds on —
theirs uses an iframe, ours can use a world.

## The shape

1. **Shim**: a part that creates a `WKContentWorld` once (`+[WKContentWorld worldWithName:]`), stores
   it, and exposes it to JS. Also `-[WKUserContentController addUserScript:…]`-shaped helpers if needed.
2. **At document start**, inject a script into that world which:
   - reads `location.search` for the token itself (so the token never appears in the page's world),
   - defines the invoke function,
   - and exposes exactly **one** function to the page world, via
     `window.webkit.messageHandlers` or a bridged global: `window.crustInvoke(plugin, command, args)`
     returning a promise.
3. **The page client** (`installInvoke`) calls `window.crustInvoke` when it exists and falls back to
   its own `fetch` path when it does not (a Vite-served page, or a platform without a content world).
   The fallback keeps Linux and Windows working, so this is additive.
4. **`window.crust.invoke` stays the public API** — nothing an app wrote changes.

## What this buys, stated honestly

- Page script can still **call** every command the window is granted. That is the point.
- Page script can no longer **read the token**, nor **replace** the invoke implementation.
- It does **not** make a granted command safe: `fs:*` still writes files.

## Rules

- Optional per platform: a platform without a content world keeps the current path and says so.
- The token must not be present in the page's `location.search` **or** in `window.crust` when the
  content-world path is active — a test asserts neither.
- Do not change the wire protocol, the bridge, or any plugin.

Files: `src/platform/darwin/shim/` (new part + `shim-source.ts`), `src/platform/darwin/webview-*.ts`,
`src/bridge/client/install.ts` + `invoke.ts` (the fallback), tests, one docs paragraph.

## Proof

`bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`, plus a live check on darwin:
launch a window, `eval` in the page world that `typeof window.crustInvoke === "function"` and that
`location.search` carries no token, and one real invoke round trip through the content world.
