# Site docs (site/)

Area: every claim on every page under `site/` (Next.js docs), checked against `src/` and `scripts/`.

## Findings

### 1. Parity page names a notification command that does not exist — MEDIUM
`site/app/docs/reference/parity/page.mdx:42`
The parity table's crust column lists the Notifications plugin as `notification.send`. The registered command is `notify`, not `send`; every other docs page uses `notification.notify`. A reader calling `notification.send` gets an unknown-command error.
**Breaks:** a page calling `invoke("notification.send")` fails; the documented command name is wrong.
**Evidence:** `src/plugins/notification.ts:79` registers `notify: (options: NotifyOptions) => …`; `:107` `notify: async (…)`. Docs' own evidence page says `notification.notify` (`site/app/docs/evidence/page.mdx:45`).

### 2. Parity page undercounts the window plugin's commands — LOW
`site/app/docs/reference/parity/page.mdx:27`
The Core table says the crust `window` plugin has "25 commands". The source `WINDOW_COMMANDS` has 26 entries (create through setCursorVisible), and the imports reference page correctly says 26. The docs contradict themselves.
**Breaks:** a reader relying on the count gets a wrong number; no runtime failure.
**Evidence:** `src/plugins/window-types.ts:141-168` lists 26 command names; `site/app/docs/reference/api/page.mdx:74` says "26 command names".

### 3. Parity page cites a nonexistent `app.start()` method — LOW
`site/app/docs/reference/parity/page.mdx:49`
The deep-linking row says the launch URL is claimed in `app.start()`. The `App` class has no `start()` method — the launch URL is claimed in `App.run()`. The docs' own imports page lists `run()` and no `start()`.
**Breaks:** a reader looking for the symbol named in backticks cannot find it.
**Evidence:** `src/app.ts:114` `async run(): Promise<void>` contains the claim at `:136` `deepLink.launch(launched)`; there is no `start()` on `App` (`site/app/docs/reference/api/page.mdx:44-50`).

### 4. Parity page uses stale fs and dialog command names — MEDIUM
`site/app/docs/reference/parity/page.mdx:40-41`
The Plugins table lists the File system plugin as `fs.read/write/list/stat/rename/remove` and Dialog as `dialog.open`, `dialog.save`. The registered commands are `readTextFile`/`writeTextFile` and `openPanel`/`savePanel`/`cancel`; there is no `fs.read`, `fs.write`, `dialog.open` or `dialog.save`. Every other row on the page uses exact command names, and the dedicated API pages agree with the source.
**Breaks:** a page calling the names printed in the table gets `unknown-command`.
**Evidence:** `src/plugins/fs.ts:107-108` `readTextFile` / `:116` `writeTextFile`; `src/plugins/dialog.ts:74` `openPanel`, `:91` `savePanel`, `:108` `cancel`; `site/app/docs/reference/api-ui/page.mdx:11-13`.

### 5. Config page's built-in plugin default set and error text are stale — MEDIUM
`site/app/docs/reference/config/page.mdx:70-72`
The `plugins` row says the default is "all five" (`fs`, `dialog`, `notification`, `tray`, `window`) and that an unknown name fails with `crust: unknown plugin "nope" — v1 ships fs, dialog, notification, tray, window`. When `config.plugins` is absent, the runtime registers the full plugin array (all native plugins on darwin), and the error lists every name from that array, not those five. The docs' own imports page names 7 `corePlugins`, not 5.
**Breaks:** a reader believes only five built-ins are on by default and that other plugin names are invalid, when in fact all are registered and the error text differs.
**Evidence:** `src/runtime-shim.ts:39` `if (!config.plugins || config.plugins.length === 0) return [...core];` and `:44` `— v1 ships ${known.join(", ")}`, where `known` is `core.map(p => p.name)` and `core` is the full native plugin array from `src/runtime.ts:72-79`.

## Coverage

Read in full: `site/app/docs/reference/{parity,platforms,limits,cli,config,errors,api,api-desktop,api-ui,api-fs,api-updater}/page.mdx`; guides `downloads` and `network`; home page. Scanned every `*.mdx` under `site/app` for version strings, dotted command names, `invoke(...)` calls, internal links and fragments. Verified claims against `src/app-types.ts`, `src/app.ts`, `src/runtime*.ts`, `src/plugins/*.ts`, `src/bridge/**`, `src/cli/doctor*`, `src/platform/{darwin,linux,windows}/`, `src/single-detect.ts`, `src/config/**` and `package.json`.

Confirmed correct (no finding): 8 CLI commands; single-file config (`crust.single.<slug>`, `0.0.0`, 900×700); port hashing (`45000 + hash % 4000`, offsets 0–20, bind 0 on 21st); `DEFAULT_CSP` string; 26 `WINDOW_COMMANDS`; `corePlugins` set; `NETWORK_SCHEME = "crust-net"`, network body 262144 / mime 128 / URL 2047 / log 100; fs grant default `"runtime"`; shell 500 lines and 256 records; notification `{ delivered, reason }` / `waitMs` / `not-implemented` `requestPermission`; Windows preflight symbols and Evergreen URL; darwin `loadRequest:`; `urlScheme` optional with no default; no custom scheme serving the page; all 18 internal `/docs/...` links and both fragment anchors resolve.

Not fully covered: the remaining ~40 guide pages were only scanned for command-name/link drift, not line-by-line against source. Version numbers seen (v0.1.12–v0.1.21) are historical pins/evidence, not claims that current is not `0.1.23`, so no version finding was filed. Next pass: line-by-line on `guides/{window,dev,native-extensions,frontend,updater}` and the `api-window`/`api-web`/`api-app` reference pages.
