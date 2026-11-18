# Building with crust

crust makes a desktop app out of Bun and the system WebView. No Rust, no bundled Chromium, no
native build step: the backend is TypeScript Bun runs, the frontend is a page the bridge serves,
and they talk over a loopback bridge with a bearer token. macOS 13+, Linux (GTK3 + WebKitGTK),
Windows (WebView2), x64 and arm64.

This file is the whole working surface. The full docs are at <https://crust.jyz.land/docs>; each
claim below is one you can act on without opening them.

## Quickstart

```sh
bunx github:JeffreyJYZ/crust#v0.1.29 init my-app   # plain HTML, no bundler
bunx github:JeffreyJYZ/crust#v0.1.29 init my-app --react   # also --next, --svelte, --vue
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

## Plugin namespaces (31)

`window`, `window-state`, `positioner` · `fs`, `store`, `shell`, `stronghold` ·
`dialog`, `notification`, `tray`, `menu`, `clipboard`, `shortcut` ·
`theme`, `dock`, `power`, `accessibility`, `opener`, `os` ·
`app`, `autostart`, `logging`, `i18n`, `single-instance`, `deep-link` ·
`navigation`, `findinpage`, `downloads`, `network`, `crash-reporter` · `updater`

Each has commands with documented args, answers and failure codes — `fs.readBinary`,
`tray.setTooltip`, `power.onSleep`, `updater.install`. A capability must grant the namespace before a
page may call it.

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
