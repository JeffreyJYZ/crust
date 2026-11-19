# Building with crust

crust makes a desktop app out of Bun and the system WebView. No Rust, no bundled Chromium, no
native build step: the backend is TypeScript Bun runs, the frontend is a page the bridge serves,
and they talk over a loopback bridge with a bearer token. macOS 13+, Linux (GTK3 + WebKitGTK),
Windows (WebView2), x64 and arm64.

This file is the working surface: everything here is enough to build, run and verify an app. It is
not the full reference — when a table stops, the per-namespace command reference is at
<https://crust.jyz.land/docs/reference/api>. The docs index is <https://crust.jyz.land/docs>.

## Quickstart

```sh
bunx github:JeffreyJYZ/crust#v0.1.32 init my-app   # plain HTML, no bundler
bunx github:JeffreyJYZ/crust#v0.1.32 init my-app --react   # also --next, --svelte, --vue
cd my-app && bun install
bun run dev        # crust dev
```

`brew install JeffreyJYZ/tap/crust` gives the same CLI on macOS. Release binaries for all six
platform/arch pairs are on the releases page.

## What a scaffold is

| file | role |
| --- | --- |
| `crust.config.ts` | app identity, windows, security. The only required file. |
| `main.ts` | the backend: `app.command(...)`, `app.on(...)`, `await app.run()` |
| `public/` | what the window loads. `index.html` required. Served by the bridge itself. |

`--react` / `--svelte` / `--vue` / `--next` replace `public/` with a Vite or Next frontend and add
`dev.url`, so `crust dev` runs your dev server and points the window at it.

## `crust.config.ts`

```ts
import type { CrustConfig } from "crust";

export default {
  app: { id: "land.jyz.myapp", name: "My app", version: "0.1.0" },
  windows: [{ label: "main", url: "/", width: 900, height: 640, title: "My app" }],
  security: {
    capabilities: [{ name: "app", actions: ["app:invoke"] }],
    grants: { main: ["app"] },
  },
} satisfies CrustConfig;
```

### `app`

| key | default | notes |
| --- | --- | --- |
| `id` | required | reverse-DNS. Seeds the bridge port and is the notification identity |
| `name` | required | also the bundle name: `name.app` |
| `version` | required | `CFBundleShortVersionString` |
| `icon` | unset | **PNG**, resolved from the project dir. macOS converts to `.icns`; other platforms carry the PNG |
| `activate` | `"always"` | `"always"` / `"first"` / `"never"` — when a window create brings the app forward |

### `windows[]`

`label` (required, the handle every `window` command uses), `url` (default `/`), `width` 1100,
`height` 760, `minWidth`, `minHeight`, `title`, `material` (`"none"`; vibrancy/mica/acrylic/tabbed).

### `dev`

`url` — one dev-server origin every window loads verbatim; `windows[].url` is then ignored and that
origin becomes the one extra origin the bridge allows. `beforeDevCommand` — started, not awaited.
Vite needs `strictPort: true`, or a moved port makes every invoke `bad-origin`.

### `build`

`assets` (`"public"`) — the directory embedded, must hold `index.html`; `beforeBuildCommand` — run to
completion, a non-zero exit aborts the build; `minimumSystemVersion` (`"13.0"`); `urlScheme`; and
`sidecars` — executables copied beside the binary at `0755` that `sidecar.spawn` may run.

### `security` — read this one carefully

```ts
security: {
  capabilities: [{ name: "fs", actions: ["fs:*"] }, { name: "app", actions: ["app:invoke"] }],
  grants: { main: ["app", "fs"], admin: ["app"] },
}
```

- **Absent or empty `capabilities` allows every command.** That is the compatibility guarantee.
- **Present and non-empty denies by default.** A label with no `grants` entry holds nothing.
- An action is `plugin:command` with `*` as the only metacharacter: `fs:*`, `dialog:openPanel`.
- App commands can be narrowed: `app:<name>` (e.g. `app:notes.save`). `app:invoke` is the broad
  alias that grants every app command, which is what scaffolds ship.
- **The grant belongs to the window label bound to the token when its document was served.** A page
  writing `"window": "admin"` in its own invoke body can address that window but cannot hold its
  grants.
- This is authorisation, not a sandbox. A label holding `fs:*` reaches every path `fs` can.

`fs.scope` (absolute prefixes), `shell.allow` (program allowlist), `shell.cwdRoot`, `updater.pubkey`
(base64 of 32 raw bytes) and `updater.endpoint` narrow a plugin's reach. Narrow there, not here.

## `main.ts`

```ts
import { app } from "crust";

app.command("greet", ({ name }) => `hello ${typeof name === "string" ? name : "there"}`);

app.on("ready", () => console.log("window open"));
app.on("window-all-closed", () => app.quit());

await app.run();
```

| export | signature |
| --- | --- |
| `app` | the singleton, inert until a platform and config attach |
| `app.command(name, handler)` | `(args) => unknown \| Promise<unknown>`. Throw or return; both reach the page |
| `app.use(plugin)` | register a `PluginDefinition` |
| `app.on(event, listener)` | `ready`, `window-all-closed`, `activate`, `before-quit`, `will-quit`, `reopen`, `error` |
| `app.invoke(name, args)` | call your own command in-process |
| `app.quit()` | end the app |
| `app.run()` | start. `command`/`use` throw after this |
| `createApp(platform, config)`, `loadConfig`, `validateConfig`, `definePlugin` | also exported |

Handlers run on the pump thread, so keep them fast. An async handler is awaited and does not block.

### Verify it runs

No `report` command exists — the scaffold reads stdout. In `main.ts`, log in `ready` and in a
handler, then `bun run dev`: `window    open` means the window mounted, `page call answered` means
the page's invoke reached your handler and came back.

```ts
app.command("greet", ({ name }) => {
  console.log("  greet     answer (page call answered)");
  return `hello ${name}`;
});
app.on("ready", () => console.log("  window    open"));
await app.run();
```

## Built-ins and capabilities

All 32 plugin namespaces below are registered before your code runs, plus `app` and `single-instance`
(34 built-ins always) and `updater` when the config has an `updater` section. `app.use` is only for
your own plugins, never a built-in, so a page may call `store.get` with no registration step.

But once `security.capabilities` is present, **each namespace needs its own capability and grant**;
granting one does not grant another. For `store.get`:

```ts
security: {
  capabilities: [{ name: "store", actions: ["store:*"] }],
  grants: { main: ["store"] },
}
```

Without the `main` grant the same call returns `forbidden`.

## The page side

```js
await window.crust.ready;
const answer = await window.crust.invoke("greet", { name: "Ada" });   // routes to app.invoke
const files  = await window.crust.invoke("fs", "list", { path: "." }); // plugin:command form
```

- `window.crust` is injected by the bridge. **Never import crust in page code** — two clients.
- A refused command rejects with a `code`. A command answering a typed failure
  (`{ ok: false, code }`) resolves with it and the transport carries a 4xx/5xx.
- `window.crust.a11y.pageTree(selector)` returns the DOM subtree as
  `{ role, label, focusable, readingOrder }` — the DOM's view, not the OS accessibility tree.
  `focusElement(selector)` reports what actually took focus.
- In `next dev` there is no `window.crust`, because nothing injects the client into a document the
  Next dev server serves. A built app works.

## Plugin namespaces (32)

<!-- skill:commands:begin -->
- `accessibility` — trusted prompt elementCount announce title focus
- `autostart` — enable disable isEnabled
- `clipboard` — read write readImage writeImage
- `crash-reporter` — last list report configure clear install uninstall
- `database` — open close exec query get
- `deep-link` — scheme url
- `dialog` — openPanel savePanel cancel
- `dock` — badge badgeLabel bounce progress
- `downloads` — list start cancel directory setDirectory
- `findinpage` — search next previous clear
- `fs` — readTextFile writeTextFile list stat remove rename readBinary writeBinary mkdir scopeList
  scopeAllow scopeRevoke
- `i18n` — locale setLocale messages translate load
- `keychain` — set get delete list
- `logging` — setLevel level configure write tail
- `menu` — setAppMenu showContext reset read isDefault
- `navigation` — start stop state reload goBack goForward loadUrl
- `network` — status onChange rules setRules log clearLog
- `notification` — requestPermission notify
- `opener` — openPath openUrl revealItem
- `os` — info paths locale
- `positioner` — center topLeft topRight bottomLeft bottomRight topCenter bottomCenter leftCenter
  rightCenter
- `power` — state idleSeconds sleepPrevent sleepAllow onSleep onLock onWake onScreenSleep
  onScreenWake onUnlock
- `screen` — list primary
- `shell` — spawn output write close kill list
- `shortcut` — register unregister unregisterAll isRegistered list
- `sidecar` — spawn write list kill
- `store` — get set delete keys clear save
- `stronghold` — open close set get delete keys
- `theme` — current set reset
- `tray` — setTitle setTooltip setMenu show hide destroy
- `window` — create close focus setTitle list isOpen label setSize getSize setPosition getPosition
  setAlwaysOnTop isAlwaysOnTop setFullscreen isFullscreen minimize unminimize isMinimized maximize
  isMaximized setDecorations isDecorated setOpacity opacity setCursor setCursorVisible
- `window-state` — save restore forget saveAll restoreAll forgetAll
<!-- skill:commands:end -->

Each has commands with documented args, answers and failure codes — `fs.readBinary`,
`tray.setTooltip`, `power.onSleep`, `updater.install`. A capability must grant the namespace before a
page may call it (see above). Every command is `invoke("<namespace>", "<command>", { args })`. The
eight a first app reaches for are below — names and arg shapes only; answers and codes live in the
/reference/api pages linked at the top.

| namespace | commands → args |
| --- | --- |
| `store` | `get {key,name?}` · `set {key,value,name?}` · `delete {key,name?}` · `keys`/`clear`/`save {name?}`. `name` picks a separate `store.<name>.json`; omit it for the default store |
| `fs` | `readTextFile {path}` · `writeTextFile {path,contents}` · `list`/`stat`/`readBinary {path}` · `writeBinary {path,bytes}` · `mkdir {path}` · `remove {path,recursive?}` · `rename {from,to}` · `scopeList` · `scopeAllow`/`scopeRevoke {path}` |
| `dialog` | `openPanel {title?,multiple?,directory?,filters?}` · `savePanel {title?,suggestedName?,filters?}` · `cancel`. `{paths: []}` means the user cancelled |
| `window` | `create {label,title?,width?,height?,url?}` · `list` · `label` · `close`/`focus`/`isOpen`/`minimize`/`unminimize`/`isMinimized`/`maximize`/`isMaximized`/`isDecorated`/`opacity`/`getSize`/`getPosition`/`isAlwaysOnTop`/`isFullscreen {label}` · `setTitle {label,title}` · `setSize {label,width,height}` · `setPosition {label,x,y}` · `setAlwaysOnTop`/`setFullscreen`/`setDecorations`/`setOpacity {label,value}` · `setCursor {cursor}` · `setCursorVisible {value}` |
| `notification` | `notify {title,body?,id?,waitMs?}` · `requestPermission` |
| `clipboard` | `read` · `write {text}` · `readImage` · `writeImage {png}` |
| `shell` | `spawn {program,args?,cwd?,env?,stdin?}` (`stdin: "pipe"` to feed it) · `output`/`close`/`kill {id}` · `write {id,data}` · `list` |
| `tray` | `setTitle`/`setTooltip {text}` · `setMenu {items:[{label,onClick?}]}` · `show`/`hide`/`destroy` |

## CLI

| command | does |
| --- | --- |
| `crust init <dir> [--react\|--next\|--svelte\|--vue]` | scaffold into an empty directory |
| `crust dev [file]` | watch the backend, restart on change, keep the frontend's own dev server |
| `crust build [file]` | compile; **macOS** assembles `X.app` in `dist/` and ad-hoc signs it. Linux/Windows produce the flat binary |
| `crust sign` | Developer ID + hardened runtime, needs `CRUST_SIGNING_IDENTITY` |
| `crust dmg` / `crust package --format appimage\|nsis` | release artefacts |
| `crust notarize` | notarytool, staple, validate |
| `crust doctor` | one line per launch check, exit 1 on any failure |

`--dir <path>` and `--config <path>` work on all of them.

## Failure codes

`unauthorized` (401), `forbidden` (403, capability refused), `bad-origin`, `not-found`,
`unknown-plugin`, `unknown-command`, `bad-json`, `bad-request`, `handler-error`, `too-large`,
`not-implemented`, `outside-scope` (403, `fs`/`shell` boundary).

## Gotchas that cost time

- **A present `capabilities` array turns the bridge deny-by-default.** Every window label then needs
  a `grants` entry, and every namespace a page calls needs an action. Symptom: `forbidden`.
- **`dev.url` must be `strictPort`.** A port move is `bad-origin` on every invoke.
- **`app.icon` is a PNG**, not SVG/ICO. A missing file fails the build by name.
- **Builds are host-only.** `crust build` has no `--target`; the release workflow builds the other
  platforms.
- **Only macOS gets an `.app` and signing.** Off darwin the product is `dist/crust-app(.exe)`, and
  the updater refuses `unsupported-platform`.
- **A window's URL must be same-origin as the bridge** unless `dev.url` names it. Absolute foreign
  origins are refused.
- **`bun test` in your app is yours, not crust's** — crust's own suite is not part of your project.

## Full reference

`/docs/start/first-app`, `/docs/reference/config`, `/docs/reference/api` (one page per namespace),
`/docs/reference/errors`, `/docs/guides/*` (one guide per plugin), `/docs/limits` (what crust does
not do, stated before you build on it).
