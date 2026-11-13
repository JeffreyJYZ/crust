# Plugins

How a crust plugin is shaped, how a page call reaches one, what the built-ins do today, and how a project mounts a plugin of its own and reaches it from a page.

Read [api.md](api.md) for the config and app surface. Measurements and design reasoning are in [DESIGN.md](../DESIGN.md) §4 (bridge) and §5 (API surface); this page does not repeat them.

Everything below was read from `src/app.ts`, `src/plugins/`, `src/bridge/`, `src/runtime.ts` and `src/platform/darwin/` in this working tree on 2026-11-13, and the JSON responses were produced by starting the real bridge in-process. The `crust/vite` section's two injected tags were observed in a served document, and its two-argument call was made from that page in a real browser against a real bridge started with `devOrigin`. Where this page and a source file disagree, the file is right — the plugin set was still moving while this was written.

## The shape of a plugin

A plugin is a name plus a command map.

```ts
import { definePlugin } from "crust/plugin";

export const fsLike = definePlugin({
	name: "fs",
	commands: {
		readTextFile: async ({ path }: { path: string }) => Bun.file(path).text(),
	},
});
```

`definePlugin` (`src/plugins/define.ts`) returns a frozen `PluginDefinition<"fs", { readTextFile }>`. The rules it enforces, all as `CrustError` with `code: "bad-request"`:

- the name must be a non-empty string with no dot;
- `commands` must be a non-empty object;
- each command name must contain no dot;
- each command value must be a function.

A handler is `(args, ctx) => result | Promise<result>`. `ctx` is a `PluginContext`, one member:

```ts
interface PluginContext {
	emit(event: string, data: unknown): void;
}
```

`emit` pushes a server-sent event to every connected page. On the page, `window.crust.listen(event, fn)` subscribes and `window.crust.once(event)` resolves with the next payload (`src/bridge/client.ts`).

Handlers must not block. There is one JavaScript thread, and a synchronous handler stops the bridge and the Cocoa pump with it; the built-in `fs` plugin is async for exactly this reason.

## How an invoke reaches a handler

Three call forms exist on the page. Two reach the same place.

```
page                         bridge (Bun, 127.0.0.1:<port>)        handler
window.crust.invoke("fs", "readTextFile", { path })
  └─ POST /_crust/invoke  { plugin: "fs", command: "readTextFile", args: { path } }
     └─ handlers.get("fs.readTextFile")
        └─ handler(args, ctx)
           └─ { ok: true, result: … }
```

**Plugin form, three arguments.** This is the client's own signature (`TypedInvoke` in `src/bridge/client.ts`):

```js
const text = await window.crust.invoke("fs", "readTextFile", { path: "/etc/hosts" });
```

The bridge keys every handler as `"<plugin>.<command>"` (`handlerMap` in `src/plugins/registry.ts`) and posts `{ plugin, command, args }` to `/_crust/invoke` with `Authorization: Bearer <token>`.

**App form, two arguments.** `src/runtime.ts` injects a small script into the served document that rewrites a two-argument call into the `app` namespace:

```js
await window.crust.invoke("greet", { name: "jyz" });
// becomes invoke("app", "invoke", { name: "greet", args: { name: "jyz" } })
```

The `app` plugin's single command calls `app.invoke(name, args)` on the backend (`src/runtime.ts`, `APP_NAMESPACE`). The `app` namespace is always registered, whatever `config.plugins` says.

**Events, one direction only, server to page:**

```js
const off = window.crust.listen("clock:tick", (ms) => console.log(ms));
const first = await window.crust.once("clock:tick");
```

**Trap, closed by `crust/vite`:** the two-argument rewrite used to live only in the document the bridge served. A `dev.url` page is loaded from the dev server, that shim never reached it, and `invoke("greet", {…})` arrived at the bridge as `command: {…}` — rejected `bad-request`. The rewrite now ships inside the client (`installCrust` in `src/bridge/client.ts`), so a page that has `window.crust` has both forms whoever served it, and `crust/vite` is what puts `window.crust` in a dev-server page.

### A page from a dev server (`crust/vite`)

`dev.url` means the window loads a document the dev server serves, so the bootstrap the bridge injects never reaches that page. `crust()` from `crust/vite` puts the same client in it:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { crust } from "crust/vite";

export default defineConfig({
	// The bridge allows exactly the origin dev.url names, so pin the port
	// instead of letting Vite move to the next free one.
	server: { port: 5173, strictPort: true },
	plugins: [crust()],
});
```

The plugin is serve-only (`apply: "serve"`): a build has no bridge, and a token in built HTML is the one thing production must not ship. On each document request it resolves the bridge address — from the environment when present, otherwise from the `.crust/dev.json` handshake — and injects two `<script>` tags into `<head>`:

```html
<script>window.__CRUST__ = {"url":"http://127.0.0.1:54321","token":"…"};</script>
<script>(function installCrust(config, target) { … })();</script>
```

The second tag is `pageClientSource()`: `installCrust.toString()` called with no config, so the client installs from the pre-set `window.__CRUST__` instead of being handed one. The bridge's own document still passes its config explicitly (`bootstrapSource` in `src/bridge/server.ts`). One function, one invoke path, one two-argument rewrite — no second copy lives in the plugin.

| variable | value |
| --- | --- |
| `CRUST_BRIDGE_URL` | the bridge's absolute URL, `http://127.0.0.1:<port>` |
| `CRUST_BRIDGE_TOKEN` | the per-launch token the bridge accepts |
| `CRUST_DEV_FILE` | optional: the handshake file's path, when it is not `.crust/dev.json` |

The two variables are the *override*, not the normal state. The dev server is spawned before the runtime binds its bridge, so the port cannot be handed to it at spawn time; instead the runtime writes `.crust/dev.json` — `{"url":"…","token":"…"}` — the first time it starts a bridge, and the plugin reads that file per request. That handshake is what makes `bun run dev` work under `crust dev` with nothing exported by hand. The variables still win when they exist, which is how a dev server started outside `crust dev` can be pointed at a bridge deliberately.

Only when both sources are empty does the plugin print one warning and inject nothing. A page with no `window.crust` fails loudly on its first call; a client pointed at a port nobody is listening on fails quietly. `crust dev` hands the pair to the `beforeDevCommand` child too (`bridgeEnv` in `src/cli/dev.ts`), so the two cannot disagree about which bridge the window may call. A scaffold with no `dev.url` needs none of this: the bridge serves that page itself and injects its own client.

### What comes back

Success (`src/bridge/server.ts`): `{ "ok": true, "result": … }`. A handler that returns `undefined` yields `"result": null`.

Measured for `fs`:

```text
writeTextFile -> 200 {"ok":true,"result":{"bytes":5}}
readTextFile  -> 200 {"ok":true,"result":"hello"}
```

Every failure is `{ "ok": false, "error": { code, message, requires? } }` with an HTTP status from the table in [api.md](api.md#errors-at-a-glance). The page-side client turns it into a rejected promise whose error has `name: "CrustInvokeError"` and the same `code`, `status` and optional `requires` (`src/bridge/client.ts`).

## The `not-implemented` error shape

A plugin that cannot do the work returns a value, not a fake success:

```ts
import { definePlugin, notImplemented } from "crust/plugin";

export const sample = definePlugin({
	name: "sample",
	commands: {
		openPanel: () =>
			notImplemented("sample.openPanel needs NSOpenPanel", "NSOpenPanel"),
	},
});
```

Both the registry and the bridge recognise that value and convert it into an error, so the page sees a rejection rather than a result. Measured response from `POST /_crust/invoke` with `{ "plugin": "dialog", "command": "openPanel", "args": {} }`:

```json
{
  "status": 501,
  "body": {
    "ok": false,
    "error": {
      "code": "not-implemented",
      "message": "dialog.openPanel needs NSOpenPanel, which the AppKit shim does not expose yet. Pass a DialogNative adapter to createDialogPlugin once it does.",
      "requires": "NSOpenPanel"
    }
  }
}
```

On the page that is:

```js
try {
	await window.crust.invoke("dialog", "openPanel", {});
} catch (error) {
	error.name;      // "CrustInvokeError"
	error.code;      // "not-implemented"
	error.status;    // 501
	error.requires;  // "NSOpenPanel"
	error.message;   // the sentence above
}
```

The exact field set is fixed by `NotImplemented` in `src/plugins/define.ts`: `ok: false`, `code: "not-implemented"`, `message`, `requires`. `requires` names the selector or framework the command is waiting on, and it survives the whole path — handler value, registry, wire body, page error. A command that must *throw* instead can throw `NotImplementedError`, which carries the same code and `requires`.

Never answer a missing implementation with an empty array or a resolved fake: for `dialog.openPanel`, `{ paths: [] }` means the user cancelled, and nothing else.

## The built-in plugins today

Five built-in names exist, and `config.plugins` absent or empty registers all of them. On macOS with a platform attached, `fs`, `dialog`, `window` and `tray` do real work, and `notification` reaches a real adapter whose answer on this machine is "not delivered, here is why". Headless (no platform), `dialog`, `window`, `tray` and `notification` answer `not-implemented`.

| plugin | commands | works today? |
| --- | --- | --- |
| `fs` | `readTextFile`, `writeTextFile`, `list`, `stat`, `remove`, `rename` | **yes**, real file I/O; a missing path is `not-found` |
| `dialog` | `openPanel`, `savePanel` | **yes on macOS**, via `darwinDialogAdapter()`; a non-blocking sheet with `filters` applied, `-runModal` only when there is no window to attach to |
| `window` | `close`, `focus`, `setTitle`, `list`, `isOpen` | **yes on macOS**, via `darwinWindowAdapter(platform)`; `not-implemented` headless |
| `tray` | `setTitle`, `setMenu`, `show`, `hide`, `destroy` | **yes on macOS**, via `createStatusBar()` in `src/platform/darwin/status-bar.ts`; `not-implemented` headless |
| `notification` | `requestPermission`, `notify` | **partly**: `notify` reaches the OS through `darwinNotificationAdapter()` and reports `{ delivered, reason }`. Unbundled it is status 2 — no bundle identifier, so the modern centre is never entered — and inside a built `.app` authorization is denied, so `delivered` is `false` either way with the reason intact. `requestPermission` always answers `not-implemented` |

Evidence for each row:

- **`fs`** (`src/plugins/fs.ts`) calls `Bun.file(path).exists()` / `.text()` and `Bun.write`. A missing file is `not-found` (`fs.readTextFile: no file at …`, HTTP 404); a non-string `path` is `bad-request` (`fs: "path" must be a non-empty string`, HTTP 400). Both measured.
- **`dialog`** ships as `dialogPlugin = createDialogPlugin()` — no adapter — so out of the box it returns `not-implemented` with `requires: "NSOpenPanel"`. `startApp` swaps in `createDialogPlugin(darwin.darwinDialogAdapter())` when a platform is attached on macOS (`nativePlugins` in `src/runtime.ts`). The adapter starts the panel as a sheet (`beginSheetModalForWindow:completionHandler:`): the C-side completion handler records the answer, and the adapter awaits it by reading a done flag on a 16 ms timer (`SHEET_POLL_INTERVAL_MS`), so the JavaScript thread, the Cocoa pump and every in-flight invoke keep running while the sheet is on screen. `filters` *are* applied: the list is flattened, each entry stripped of a leading `*.` or `.`, de-duplicated, and handed to C as one comma-separated extension string for the deprecated `-setAllowedFileTypes:`, which still exists on macOS 27. `-runModal` is the fallback for having no window to attach a sheet to — chosen by the shim's `SHIM_PANEL_NO_WINDOW`, never guessed by the adapter — and that path does block the JavaScript thread and the pump until the user answers. `title`, `multiple` and `directory` are passed through. A sheet and a completed pick are **unverified**: the pick needs a human, so `DESIGN.md` §10 records the modal pick as the only pick automation has reached. `savePanel` is `NSSavePanel` on the same machinery: the caller supplies `title`, a `suggestedName` for the name field and the same `filters`, and the answer is `{ paths }` with one entry, or `[]` for a cancel. Overwrite confirmation is AppKit's own — a replace prompt for an existing file — and crust adds no second one and never writes the file. Its sheet was measured starting, staying pending, and resolving `{ paths: [] }` through the poll after `-cancel:`; a completed save pick is **unverified**, for the same reason as the open panel.
- **`window`** is not in `corePlugins`; `nativePlugins` always appends it. With a platform it is `createWindowPlugin(darwinWindowAdapter(platform))`; without one it is `createWindowPlugin()` and every command answers `not-implemented` with `requires: "NSWindow"`. It returns typed values, not throws: `{ ok: false, code: "unknown-window" | "invalid-label" | "handler-error", message }`, and `{ ok: true, … }` on success.
- **`tray`** (`src/plugins/tray.ts`) has five commands, and each answers `{ ok: true, … }` or a typed `{ ok: false, code, message }` with `code` one of `invalid-text`, `invalid-menu`, `unknown-adapter`, `destroyed`, `handler-error`. `startApp` supplies `createStatusBar()` from `src/platform/darwin/status-bar.ts` on macOS. Because the bridge transports JSON, a page cannot send the optional `onClick`, so every click is also pushed as the `tray:click` event carrying `{ index, label }`. One status item exists per process: `createStatusBar()` throws while another is alive, because the runtime class holds a single click IMP, and `destroy` frees the slot. Headless, every command answers `not-implemented` with `requires: "NSStatusBar"`.
- **`notification`** (`src/plugins/notification.ts`) takes a `post` adapter, and `startApp` supplies `darwinNotificationAdapter()` from `src/platform/darwin/notifications.ts` on macOS. `notify` returns `{ delivered, reason }`, where `delivered` is true **only** when the OS reported status 0; statuses 1 (authorization), 2 (missing class or selector) and 3 (error) pass through as `delivered: false` with the reason intact. `requestPermission` answers `not-implemented` even with an adapter, because the notification itself requests authorization and the OS answers only through a completion handler. On this machine the adapter measured status 2 unbundled: an unbundled process has no bundle identifier, so the modern centre is never entered. Inside a built `.app` the modern centre **is** entered and the callback reports `granted = false` with `UNUserNotificationCenter: authorization was denied`; the cause of the denial is narrowed but unidentified, and the app's signing identity is the remaining candidate. Both shapes report `delivered: false` with the reason intact. `DESIGN.md` §9 item 5 and the header of `notifications.ts` carry that reasoning. Headless, both commands answer `not-implemented` with `requires: "UNUserNotificationCenter"`.

Two failure shapes reach a page, and page code must handle both. A command that returns a `NotImplemented` value becomes a `501` rejection — that is how `dialog` fails, and how every plugin without an adapter fails. A command that returns a typed failure object (`window` and `tray` once an adapter is present) is an ordinary `200` response whose `result.ok` is `false`.

Which built-ins are registered is `config.plugins`' business: absent or `[]` registers all five; naming any registers only the named ones (the `crust:` prefix is optional), and an unknown name fails startup. It selects built-ins only: a plugin mounted with `app.use` is always registered and never belongs in that list. See [api.md](api.md#keys-and-defaults).

## A plugin in your own project

Your project mounts a plugin with `app.use`, in `main.ts`, before `await app.run()`. There is no config field and no bridge import: the same `definePlugin` value the framework uses is the mount target.

### 1. Write it

`src/plugins/clock.ts` in your project:

```ts
import { definePlugin, notImplemented } from "crust/plugin";

export const clock = definePlugin({
	name: "clock",
	commands: {
		now: () => new Date().toISOString(),
		zone: () => notImplemented("clock.zone needs a native time zone API", "NSTimeZone"),
	},
});
```

`crust/plugin` is a real entry point (`package.json` `exports`), so the import resolves in an installed project. No build step and no bundler config: it is the same TypeScript entry the framework itself imports.

### 2. Mount it

`main.ts`, before `run()`:

```ts
import { app } from "crust";
import { clock } from "./plugins/clock.ts";

app.use(clock);

await app.run();
```

`app.use` (`src/app.ts`) reuses `definePlugin`'s shape checks — non-empty name, no dot, a non-empty `commands` object whose every value is a function — and adds three refusals of its own:

| refused | message |
| --- | --- |
| a second mount of the same name | `app.use: plugin "clock" is already mounted` |
| a built-in name (`fs`, `dialog`, `notification`, `tray`, `window`) | `app.use: "fs" is a built-in plugin — a name is a namespace, so pick another` |
| the reserved `app` namespace | `app.use: "app" is the reserved app namespace` |

A fourth is the lifecycle rule `app.command` also enforces: mounting after `run()` has started throws `crust: cannot mount a plugin after app.run() has started`. A collision is never a silent override — two plugins sharing a name would overlap in one handler table.

The mount must precede `run()` for a mechanical reason. The bridge snapshots its `"<plugin>.<command>"` table when it starts (`handlerMap` in `src/plugins/registry.ts`), and `startApp` creates that bridge on the first `run()`, after importing `main.ts`. Everything `main.ts` registers and mounts by then is in the table the served page talks to.

### 3. Reach it from the page

The plugin form is the three-argument call:

```js
await window.crust.invoke("clock", "now");
// 200 {"ok":true,"result":"2026-11-13T09:41:07.812Z"}
```

The two-argument form `invoke("greet", { name })` is app commands only — the client rewrites it into the `app` namespace — so a plugin command always uses three arguments. Both forms work on a `dev.url` page too, because `crust/vite` gives it the same client (see [A page from a dev server](#a-page-from-a-dev-server-crustvite)).

`startApp` registers mounted plugins after the core and native ones, then the `app` namespace: `new PluginRegistry().register(...selectedPlugins(config, plugins), ...app.plugins(), appPlugin)`. `PluginRegistry.register` refuses a duplicate name, so a namespace conflict fails startup with `plugin "<name>" is already registered` rather than shadowing a built-in.

An unknown name still fails at the bridge, and the code is `unknown-command` even for an unknown *plugin*, because the bridge flattens names before lookup. A command that returns `notImplemented` is `501`:

```js
await window.crust.invoke("clock", "zone");
// 501 {"ok":false,"error":{"code":"not-implemented","message":"clock.zone needs a native time zone API","requires":"NSTimeZone"}}
```

(`unknown-plugin` exists only in `PluginRegistry.invoke`, which the bridge does not use.)

### 4. Test it in-process

`src/plugins/clock.test.ts`:

```ts
import { expect, test } from "bun:test";
import { PluginRegistry } from "crust/plugin";
import { clock } from "./clock.ts";

const ctx = { emit: () => {} };

test("now answers ISO time", async () => {
	const registry = new PluginRegistry().register(clock);
	const value = await registry.invoke("clock", "now", {}, ctx);
	expect(typeof value).toBe("string");
});

test("zone fails honestly", async () => {
	const registry = new PluginRegistry().register(clock);
	await expect(registry.invoke("clock", "zone", {}, ctx)).rejects.toMatchObject({
		code: "not-implemented",
		requires: "NSTimeZone",
	});
});
```

Run it with `bun test`. The same code was run against this checkout (imports by path, since the snippet lives outside the package): 3 pass, 0 fail, 3 `expect()` calls. `PluginRegistry.invoke` is the same resolution the bridge performs: unknown plugin throws `unknown-plugin`, a non-function command throws `unknown-command`, and a `NotImplemented` value becomes a `CrustError` with `code: "not-implemented"`.

`PluginRegistry` (`src/plugins/registry.ts`) is also the whole plugin registry: `register(...plugins)` refuses a duplicate name, `has`, `get`, `names`, `commandsOf`, `invoke`, and `handlers()` which flattens to the `"<plugin>.<command>"` table the bridge consumes.

### The worked example in this repo

`examples/hello/main.ts` mounts a `greeting` plugin beside its `greet` app command, and `examples/hello/public/app.js` calls both — two arguments for the app command, three for the plugin. Started with `bun run src/cli/index.ts dev --dir examples/hello`, the page's plugin call reached the handler and the backend printed:

```text
  plugin    greeting.greet answered: hello jyz, from a plugin
```

Same page, same bridge, same handler table as every built-in: the only difference is who wrote the plugin.

`examples/vite` is the dev-server half: a real Vite app whose `vite.config.ts` mounts `crust()`, whose `crust.config.ts` sets `dev.url`, and whose page calls `invoke("greet", { name: "vite" })` in two arguments. `bun run src/cli/index.ts dev --dir examples/vite` is the intended command; see the environment caveat above.
