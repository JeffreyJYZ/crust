# M5 — running the opencode desktop client on crust

Scoped 2026-11-13. Read-only reconnaissance: nothing in either repository was modified, no build was run, no window was opened. Every claim below names the file it came from; where a claim comes from a doc rather than code, the doc says so.

**Correction, later on 2026-11-13 (crust 0.1.5).** This scoping predates 0.1.5, and two behaviours it describes have since changed. The bridge no longer binds an ephemeral port: `preferredPortFor` in `src/runtime.ts` derives a stable port from `app.id` (45000–48999, walking upward when taken), so the persistence failure in §4.2 does not happen unless that port is busy. And `dialog.openPanel` is now a non-blocking sheet with `filters` applied, with `-runModal` only as the fallback when there is no window to attach to, so the "blocks the JS thread" rows in §2 and §4.5 describe the old state. The `README.md:<line>` references below point at the README as it stood when this was written; use its section names instead.

Sources opened: `apps/opencode-tauri-client/{package.json,README.md,vite.config.ts,index.html,src/App.tsx,src/main.tsx,docs/opencode-api.md,docs/progress/000-status.md,docs/specs/010-app-shell.md,docs/specs/050-opencode-integration.md,docs/specs/060-plan.md}`; the abandoned build `apps/opencode-tauri-client-legacy/{src-tauri/src/lib.rs,src-tauri/Cargo.toml,src-tauri/tauri.conf.json,src-tauri/capabilities/default.json,src/client/target.ts,src/components/BtwDialog.tsx}` (read for facts only); `crust/{README.md,DESIGN.md,docs/api.md,docs/plugins.md,src/app.ts,src/runtime.ts,src/vite.ts,src/bridge/client.ts,src/bridge/server.ts,src/plugins/*.ts,src/platform/darwin/{index.ts,shim.c},src/config/schema.ts,src/cli/build.ts,examples/vite/*,templates/default/main.ts}`; the read-only mirror `monorepos/opencode/packages/server/src/{cors.ts,fetch.ts}`.

## 0. The finding that reshapes the milestone

The live client is a scaffold, not an app. `src/App.tsx` is five lines and renders `<main id="main"></main>`; `src/main.tsx` mounts it; `docs/progress/000-status.md` shows M0 at 1/6 and M1–M5 at 0. `dist/` is a 220 KB bundle built 15 Oct from exactly that, so "serve the client's built frontend" today serves a blank page.

That means crust's M5 ("dogfood: the opencode client has not been run on crust" — `DESIGN.md` §10) and the client's M5 ("Desktop polish" — `docs/specs/060-plan.md` lines 103–107) are different milestones that happen to share a number. The first is a crust question and answerable now. The second is polish of a product that does not exist yet, and it is gated behind the client's own M0–M4.

## 1. What native surface the client uses today

**None.** There is no `src-tauri/` directory, no `@tauri-apps/*` dependency in `package.json`, and not one `invoke()` in `src/` (searched for `tauri`, `invoke(`, `__TAURI`, `@tauri-apps`). The client today is a Vite page that touches no host API at all.

The only build that ever ran is the abandoned one, and it is the honest evidence for what this app actually needs from a shell:

| capability | used by the abandoned build | evidence |
| --- | --- | --- |
| window | one 1600×900 resizable `NSWindow` | `legacy/src-tauri/src/lib.rs` `run()` |
| pre-page global | `window.__OPENCODE_TARGET__ = { url, password }` injected before any page script | same file, `injection_script()`; read by `legacy/src/client/target.ts` `injectedTarget()` |
| dialogs | none | no dialog plugin in `Cargo.toml` |
| fs | none | `capabilities/default.json` is `["core:default"]` |
| shell | none | same |
| notifications | none | same |
| tray | none | same |
| clipboard | `navigator.clipboard.writeText` (a web API, not Tauri) | `legacy/src/components/BtwDialog.tsx:207` |
| HTTP | direct `fetch` from the page to the opencode server | `docs/opencode-api.md:21,24` |
| updater | none — `bundle.targets: ["app"]`, no updater plugin | `legacy/tauri.conf.json` |

Its own header states it: "**Nothing else is native**: the agent's PTY and session lifecycle live in the opencode server, so this shell only points the web app at the server" (`legacy/src-tauri/src/lib.rs`). `Cargo.toml` lists `tauri` and `serde_json` and nothing else, with `features = []`.

The **planned** surface is larger, and it is all ahead of the current task list, not behind it: native directory/file pickers, open-in-editor, copy with toast, unfocused turn-end notification, drag-drop attach (`docs/specs/010-app-shell.md:59`), `host.native.pickDirectory/pickFiles/openExternal/read/write/list/remove/dataDir` (`docs/specs/040-plugins.md:67`), window state restore, menu bar, app version (`060-plan.md:105`), updater and packaging (`060-plan.md:106-107`).

So the port is not "translate 40 Tauri calls". It is "serve a page and hand it one global", which crust already does in a different form.

## 2. Coverage in crust, row by row

| needed | crust today | name difference | settles it |
| --- | --- | --- | --- |
| window create, size, title | yes at launch, and page-callable now (the adapter half is uncommitted) | `windows[]` config, not `WebviewWindowBuilder`; `create()` delegates to `DarwinPlatform.createWindow` and resolves a relative url against the bridge, so a new window inherits the same missing init-script channel | `src/platform/darwin/index.ts:654,1196`, `docs/api.md:300`, `src/plugins/window.ts:64,167` |
| window close / focus / title / list / isOpen | yes, page-callable | `invoke("window","setTitle",{label,title})` vs Tauri `getCurrentWindow().setTitle()` | `src/plugins/window.ts:167,287` |
| inject a global before page scripts | **no** | Tauri `initialization_script`; crust has none | `src/platform/darwin/shim.c:146` (only `loadRequest:`); no "initialization" anywhere in `src/` |
| dialogs | yes, one command | `dialog.openPanel({directory})` vs `dialog.open({directory})`; modal only, `filters` ignored, blocks the JS thread | `src/plugins/dialog.ts:34-44,55`, `README.md:207-213` |
| fs | partial | `fs.readTextFile` / `writeTextFile` only — no readDir/exists/remove, and no path scoping (Tauri scopes by capability) | `src/plugins/fs.ts:37` |
| clipboard | **no** | neither read nor write; no `NSPasteboard` in `src/platform/darwin` | searched `pasteboard|NSPasteboard` — no match |
| open in editor / open external | **no** | no `NSWorkspace`, no shell plugin | searched `NSWorkspace|openExternal` — no match |
| shell command | **no** | there is no shell plugin at all | `src/plugins/index.ts` exports only fs/dialog/notification/tray/window |
| notifications | entered, then refused | `notification.notify` returns `{delivered,reason}`; in a bundle `granted=false`; `requestPermission` is 501 | `src/plugins/notification.ts:111,121`, `README.md:218-227` |
| tray / menu bar item | yes, unproven visually | `tray.setTitle/setMenu/show/hide/destroy` | `src/plugins/tray.ts:236`, `README.md:214-217` |
| app menu bar (File/View/Help) | **no** | v1 exposes no native menus by design | `DESIGN.md:295` item 7 |
| window size/position restore | **no** | `createWindow` always opens at 120,120 with the config size | `src/platform/darwin/index.ts:608` |
| updater / verify-release | **no** | nothing updater-shaped in the tree | `README.md:26-27` lists what is missing |
| HTTP to the opencode server | not a shell feature; the page does it | none needed | `docs/opencode-api.md:21` |
| CORS from a crust window | already allowed | the window origin is `http://127.0.0.1:<port>`, and the server allows `http://127.0.0.1:*` | mirror `packages/server/src/cors.ts:14` |
| dev frontend (Vite) | yes, via `dev.url` + `crust/vite` | `crust()` Vite plugin vs Tauri `devUrl` | `src/vite.ts:41`, `examples/vite/{crust.config.ts,vite.config.ts}` |
| built frontend | yes, embedded `public/` tree | copy `dist/` into `public/`; no `frontendDist` key | `README.md:107-110`, `src/cli/build.ts:55-78` |

Two crust behaviours decide the retrofit, and neither is a naming problem:

- **The bridge binds an ephemeral port every launch** (`src/bridge/server.ts:64,283,298` — `port: 0` by default). The page's origin is therefore `http://127.0.0.1:<random>` on every run, and `localStorage`/IndexedDB are partitioned per origin. The client's entire persistence plan (`settings.tabs`, fonts, sidebar, plugin state — `docs/specs/010-app-shell.md:63-73`) would be empty on every launch.
- **The default CSP is `connect-src 'self'`** (`src/bridge/server.ts:38-47`). A page served by the bridge cannot fetch the opencode server, and `script-src 'self' 'unsafe-inline'` has no `blob:`, which is what the client's plugin host imports built plugins from (`AGENTS.md` "Plugin rules"). Both are one config key away, but they are config the app must carry.

## 3. The smallest first slice

Goal: a crust window showing the client's built page, with one command answered end to end through a shim shaped like Tauri's IPC. No client repo change, no client build.

Everything lives in one throwaway project, `~/dev/rdm/opencode-crust-slice/`:

| file | what it is |
| --- | --- |
| `crust.config.ts` | `app {id,name,version}`, one window `1600×900`, title `opencode`; `security.csp` = `DEFAULT_CSP` plus `connect-src 'self' http://127.0.0.1:*` (copy the default string from `src/bridge/server.ts:38`) |
| `main.ts` | `app.use(tauri)` then `app.run()`; plus `app.command("oc.info", …)` reading `~/.local/state/opencode/service.json` and returning `{version,url}` only — never the password |
| `plugins/tauri.ts` | `definePlugin({name:"tauri", commands:{invoke}})` — one command taking `{cmd,args}` and answering `pong` for `ping`, `window.setTitle` for that cmd; the shape Tauri's IPC has |
| `public/index.html` | the client's `dist/index.html` byte-for-byte, plus one inline `<script>` in `<head>` setting `window.__OC_TARGET__` (a placeholder for the slice) and one script tag loading `shim.js` |
| `public/assets/*` | `cp -R ~/dev/apps/opencode-tauri-client/dist/assets …` — the 220 KB bundle as shipped |
| `public/shim.js` | `window.__TAURI_INTERNALS__ = { invoke: (cmd, args) => window.crust.invoke("tauri","invoke",{cmd,args}) }`, plus the probe that calls `invoke("ping")` on load and writes the answer into `#main` |
| `scripts/sync-dist.sh` | the `cp -R` above, so re-syncing is one command |

Run it with `bun run src/cli/index.ts dev --dir ~/dev/rdm/opencode-crust-slice` from the crust checkout.

Visible when it works: a 1600×900 window titled `opencode`, rendering the client's page, with `pong` where the probe wrote it, and the terminal printing `tauri ping (page call answered)`. That proves exactly one thing and it is the thing M5 asks: a page built for Tauri reaches Bun through crust's bridge, with no Rust and no Chromium.

The slice deliberately uses a literal `window.__OC_TARGET__` in its own copy of `index.html`. That is fine for a proof and wrong for shipping — see 4.3.

## 4. What is still broken after the slice

Ordered by whether it costs a day or a month.

1. **There is no app to run.** This is the whole of it. `src/App.tsx` is five lines; M0 is 1/6 and M1–M5 are 0/6, 0/9, 0/5, 0/8, 0/5. Every row of crust's M5 beyond "it opens" is gated on client work that has not started. The slice proves the seam, not the product.
2. **Persistence dies on every launch** unless the port stops moving. `settings.tabs`, fonts, sidebar and plugin state are `localStorage` per `docs/specs/010-app-shell.md:63-73`, and crust's origin changes each run (`src/bridge/server.ts:283`). Fixing it means a fixed bridge port exposed in config (then two instances collide) or moving persistence to the native side, where there is no scoped store yet. This is a design decision, not a line of code.
3. **No initialization script.** The real client must read `window.__OPENCODE_TARGET__` before its bundle executes (`legacy/src/client/target.ts:47-62`). Crust's only pre-page channel is the bridge's injected bootstrap, which installs `window.crust` and nothing app-specific (`src/bridge/client.ts:282`). Two routes: inject a config-provided snippet in `injectBootstrap` (`src/bridge/server.ts:251` — TypeScript only, hours), or add `WKUserScript` through a `WKUserContentController` in the C shim and pass it from `createWindow` (`shim.c:146`, `index.ts:621` — the webview is built with `allocInit`, so this is new C plus the AppKit trap list). The bridge route cannot reach a `dev.url` page, so it also forces the built-page path.
4. **CSP blocks the real app in two places** — the server fetch (`connect-src`, `server.ts:43`) and the plugin host's Blob import (`script-src`, `server.ts:40`). Both fixable in config, both must be carried by the app rather than the framework.
5. **The dialog blocks the JavaScript thread and the pump** for as long as the directory picker is open (`README.md:207-213`, `dialog.ts:34-44`). Tauri's picker is async. The client's new-session flow is a directory picker (`docs/specs/060-plan.md:57`), so this lands on M1.3 and M5.2 as a visible stall in a streaming session.
6. **Every M5 native integration is missing or unproven** — clipboard (absent), open-in-editor (absent, no `NSWorkspace`), menu bar (absent by design), window state restore (absent), notifications (refused in a bundle, cause unidentified — `README.md:218-227`), drag-drop attach (no webview drag API in the tree), updater (absent). Each is a crust feature, and notification/tray already have proven-failure history.
7. **The ship story is not there.** 85 MiB bundle, ad-hoc signed only; `spctl` rejects it and it cannot be notarized, so another machine needs `xattr -dr com.apple.quarantine` (`README.md:197-201`). No updater means no update path either. This is a credentials problem before it is a code problem.
8. **Unverified on crust**: a Vite HMR session (`DESIGN.md` M3 is PARTIAL), the Blob-loaded plugin host inside WKWebView, and screenshot/devtools parity with the previous Chromium-free path.

## 5. Blockers that are the user's

- **A Developer ID certificate and notarization**, if M5 is meant to end in an app someone else can open. `crust sign` is written but has never run; `DESIGN.md` §10 M6 and `README.md:197-201` both say so. Without it the deliverable is a locally-runnable `.app`.
- **A decision on what M5 means**: crust dogfood (the slice above, one day) or the client's M5 polish (blocked behind the client's M0–M4, weeks). Both are defensible; they cannot share a date.
- **A decision on persistence**: fixed bridge port versus a native settings store. This one changes the app's architecture and is not mine to pick.
- **Consent to spend client milestone time on M0–M4 before any M5 row can be accepted** — the same question as above, stated as work.
- No credentials are needed to run the slice: it reads the registered `service.json` for a url and version only, and touches no session.

## Verdict

One day to prove the seam — a crust window serving the built page and answering one command through a Tauri-shaped shim. **One month to call M5 done, and almost none of that month is crust work**: it is the client's unstarted foundations, plus two crust design decisions (init-script channel, stable origin) and a signing certificate.
