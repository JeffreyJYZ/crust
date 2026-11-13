# Plugins

How a crust plugin is shaped, how a page call reaches one, what the built-ins do today, and what a third-party plugin can and cannot do in your own project.

Read [api.md](api.md) for the config and app surface. Measurements and design reasoning are in [DESIGN.md](../DESIGN.md) §4 (bridge) and §5 (API surface); this page does not repeat them.

Everything below was read from `src/plugins/`, `src/bridge/`, `src/runtime.ts` and `src/platform/darwin/` in this working tree on 2026-11-13, and the JSON responses were produced by starting the real bridge in-process. Where this page and a source file disagree, the file is right — the plugin set was still moving while this was written.

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

**Trap, from the code path:** the two-argument rewrite is injected into the document *the bridge serves*. When `dev.url` points at a dev server, that page is loaded from the dev server and the shim is never injected, so `invoke("greet", {…})` reaches the bridge with `command: undefined` and is rejected `bad-request`. Use `invoke("app", "invoke", { name: "greet", args: {} })` in that mode. This repo ships no Vite plugin, and `DESIGN.md` §10 records the real Vite session as unexercised; treat the `dev.url` note as code-derived, not measured.

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

Five names exist, and `config.plugins` absent or empty registers all of them. On macOS with a platform attached, `fs`, `dialog`, `window` and `tray` do real work, and `notification` reaches a real adapter whose answer on this machine is "not delivered, here is why". Headless (no platform), `dialog`, `window`, `tray` and `notification` answer `not-implemented`.

| plugin | commands | works today? |
| --- | --- | --- |
| `fs` | `readTextFile`, `writeTextFile` | **yes**, real file I/O |
| `dialog` | `openPanel` | **yes on macOS**, via `darwinDialogAdapter()`; modal pick only, `filters` ignored |
| `window` | `close`, `focus`, `setTitle`, `list`, `isOpen` | **yes on macOS**, via `darwinWindowAdapter(platform)`; `not-implemented` headless |
| `tray` | `setTitle`, `setMenu`, `show`, `hide`, `destroy` | **yes on macOS**, via `createStatusBar()` in `src/platform/darwin/status-bar.ts`; `not-implemented` headless |
| `notification` | `requestPermission`, `notify` | **partly**: `notify` reaches the OS through `darwinNotificationAdapter()` and reports `{ delivered, reason }`. On this machine it reports `delivered: false` (an unbundled process has no bundle identifier), and `requestPermission` always answers `not-implemented` |

Evidence for each row:

- **`fs`** (`src/plugins/fs.ts`) calls `Bun.file(path).exists()` / `.text()` and `Bun.write`. A missing file is `not-found` (`fs.readTextFile: no file at …`, HTTP 404); a non-string `path` is `bad-request` (`fs: "path" must be a non-empty string`, HTTP 400). Both measured.
- **`dialog`** ships as `dialogPlugin = createDialogPlugin()` — no adapter — so out of the box it returns `not-implemented` with `requires: "NSOpenPanel"`. `startApp` swaps in `createDialogPlugin(darwin.darwinDialogAdapter())` when a platform is attached on macOS (`nativePlugins` in `src/runtime.ts`). The adapter's pick is `-runModal`, which blocks the JavaScript thread and the pump for as long as the panel is open; `filters` is not applied, and the sheet path returns `PANEL_STATUS.sheetStarted` which the adapter turns into `crust: openPanel failed (sheetStarted); NSOpenPanel could not be shown`. `DESIGN.md` §10 records the modal pick as unverified by automation.
- **`window`** is not in `corePlugins`; `nativePlugins` always appends it. With a platform it is `createWindowPlugin(darwinWindowAdapter(platform))`; without one it is `createWindowPlugin()` and every command answers `not-implemented` with `requires: "NSWindow"`. It returns typed values, not throws: `{ ok: false, code: "unknown-window" | "invalid-label" | "handler-error", message }`, and `{ ok: true, … }` on success.
- **`tray`** (`src/plugins/tray.ts`) has five commands, and each answers `{ ok: true, … }` or a typed `{ ok: false, code, message }` with `code` one of `invalid-text`, `invalid-menu`, `unknown-adapter`, `destroyed`, `handler-error`. `startApp` supplies `createStatusBar()` from `src/platform/darwin/status-bar.ts` on macOS. Because the bridge transports JSON, a page cannot send the optional `onClick`, so every click is also pushed as the `tray:click` event carrying `{ index, label }`. One status item exists per process: `createStatusBar()` throws while another is alive, because the runtime class holds a single click IMP, and `destroy` frees the slot. Headless, every command answers `not-implemented` with `requires: "NSStatusBar"`.
- **`notification`** (`src/plugins/notification.ts`) takes a `post` adapter, and `startApp` supplies `darwinNotificationAdapter()` from `src/platform/darwin/notifications.ts` on macOS. `notify` returns `{ delivered, reason }`, where `delivered` is true **only** when the OS reported status 0; statuses 1 (authorization), 2 (missing class or selector) and 3 (error) pass through as `delivered: false` with the reason intact. `requestPermission` answers `not-implemented` even with an adapter, because the notification itself requests authorization and the OS answers only through a completion handler. On this machine the adapter measured status 2: an unbundled process has no bundle identifier, so the modern centre is never entered. `DESIGN.md` §9 item 5 and the header of `notifications.ts` carry that reasoning. Headless, both commands answer `not-implemented` with `requires: "UNUserNotificationCenter"`.

Two failure shapes reach a page, and page code must handle both. A command that returns a `NotImplemented` value becomes a `501` rejection — that is how `dialog` fails, and how every plugin without an adapter fails. A command that returns a typed failure object (`window` and `tray` once an adapter is present) is an ordinary `200` response whose `result.ok` is `false`.

Which ones are registered is `config.plugins`' business: absent or `[]` registers all five; naming any registers only the named ones (the `crust:` prefix is optional), and an unknown name fails startup. See [api.md](api.md#keys-and-defaults).

## A third-party plugin in your own project

This is the case the framework has never documented, so here is the honest version: **you can write a plugin and test it in-process today, but there is no public way to mount it on a running app.** Nothing below claims otherwise.

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

### 2. Test it

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

### 3. The gap: it does not reach the page

What a project cannot do today, with the evidence:

| attempt | result |
| --- | --- |
| register on `app` | `app` has `command`, `on`, `run`, `quit`, `invoke`, `attach` and nothing else (`src/app.ts`) |
| name it in `config.plugins` | `crust: unknown plugin "clock" — v1 ships fs, dialog, notification, tray, window` (measured) |
| import the bridge to mount it | `startBridge` and `startApp` are not exported from `crust` or `crust/plugin`; `exports` in `package.json` maps only `.` and `./plugin` |

`startApp` builds its registry itself — `new PluginRegistry().register(...selectedPlugins(config, plugins), appPlugin)` — and `selectedPlugins` filters against the five core names. There is no plugin hook between the framework and your project.

So the page call that *would* be the payoff currently fails:

```js
await window.crust.invoke("clock", "now");
// 404 {"ok":false,"error":{"code":"unknown-command","message":"clock.now"}}
```

That last response is measured against the real bridge running the core registry only. It is the same shape an unknown name always produces: the message is `"<plugin>.<command>"`, and note that the code is `unknown-command` even for an unknown *plugin* — the bridge flattens names before lookup. (`unknown-plugin` exists only in `PluginRegistry.invoke`, which the bridge does not use.)

### What it would take

One public registration hook — a method on `app` or a config field that accepts `PluginDefinition`s — plus exporting the bridge/`startApp` path. Neither exists. Until then, a third-party plugin is a designed, typed, testable unit that cannot be shipped to a page, and the built-ins are the only plugins a page can reach.

If you need the capability now, it belongs inside a core plugin or inside an `app.command`: an app command is always registered, and reachable through the two-argument form when the bridge serves the page (or `invoke("app", "invoke", { name, args })` when it does not).
