# crust API reference

`crust` 0.1.12, macOS arm64 only for v1. This page documents every export of the package root (`import … from "crust"`), the plugin entry point (`import … from "crust/plugin"`), and the dev-server plugin (`import { crust } from "crust/vite"`).

Each signature, default and error message below was read from the source file named beside it in this working tree. What was *run* is narrower, and [Unverified](#unverified) lists what this page deliberately does not claim: a Developer ID signature (no such certificate exists on this machine, so that path is documented from `codesign`'s behaviour, not from a signed bundle), AppKit's overwrite prompt in `dialog.savePanel`, the `-runModal` fallback, and the Next static-export path observed only through `crust build`, never through a human clicking around the exported app. Everything else below, including a completed dialog pick and tray click (both by a person on 2026-11-14), a delivered notification (a probe on the same day), the Next build pipeline, both single-file modes and `window.create`, has a script or a recorded run behind it.

Design rationale and measurements live in [DESIGN.md](../DESIGN.md); link targets are cited as `DESIGN.md §n` rather than restated.

## What the package exports

The root entry point, `src/index.ts`, re-exports three groups.

```ts
// values
import {
	App, app, createApp, PUMP_INTERVAL_MS,
	CONFIG_FILES, ConfigError, findConfig, loadConfig, validateConfig,
	definePlugin, isNotImplemented, notImplemented, NotImplementedError,
} from "crust";

// types (erased at runtime)
import type {
	AppEvent, AppListener, CommandHandler, Platform, WindowHandle, WindowOptions,
	AppConfig, BuildConfig, ConfigIssue, CrustConfig, DevConfig, LoadedConfig,
	LoadConfigOptions, SecurityConfig, WindowConfig,
	ArgsOf, PluginContext, PluginDefinition, ResultOf, SchemaOf,
} from "crust";
```

The plugin entry point, `src/plugins/index.ts`, adds the plugin registry, the five built-in plugins, and the native adapter factories:

```ts
import {
	definePlugin, notImplemented, isNotImplemented, NotImplementedError,
	PluginRegistry, handlerMap,
	fsPlugin, dialogPlugin, notificationPlugin, trayPlugin, windowPlugin,
	corePlugins, coreRegistry,
	createDialogPlugin, createNotificationPlugin, createTrayPlugin, createWindowPlugin,
	WINDOW_COMMANDS, WindowAdapterError,
} from "crust/plugin";

// types (erased at runtime)
import type {
	CancelPanelResult, DialogNative, OpenPanelOptions, OpenPanelResult, SavePanelOptions,
	SavePanelResult, NotificationNative, NotificationPermission, NotifyOptions, NotifyResult,
	TrayNative, TrayOptions, TrayResult, WindowNative, WindowCreateOptions, WindowCreateResult,
	WindowErrorCode, WindowFailure, PluginContext, PluginDefinition,
} from "crust/plugin";
```

The third entry point, `src/vite.ts`, is a Vite plugin — the only way a page served by a dev server gets `window.crust`:

```ts
import { crust, BRIDGE_URL_VAR, BRIDGE_TOKEN_VAR } from "crust/vite";
import type { CrustOptions } from "crust/vite";
```

All three are real `exports` entries in `package.json`, so they resolve in an installed project with no build step.

Nothing in this package is imported by *page* code. A page uses the global `window.crust` the bridge injects; `crust/vite` is imported by `vite.config.ts`, never by the page. See [plugins.md](plugins.md) for the page-side surface.

A second warning before anything else: `app` is the **backend** object. The page-side `window.crust.invoke` is a different function with a different signature, documented in [plugins.md](plugins.md#how-an-invoke-reaches-a-handler).

---

## `app`

The module-level singleton in `src/app.ts`.

```ts
import { app } from "crust";
```

One `App` instance per process, created when the module loads. It is inert until a `Platform` and a `CrustConfig` are attached. Under `crust dev` and inside a built app, `startApp` (`src/runtime.ts`) attaches both *before* it imports your `main.ts`, so `main.ts` only ever registers handlers and calls `run()`.

Called bare (`bun src/main.ts`) there is nothing attached, and `run()` loads the config from the working directory and imports the macOS platform itself.

### `app.command(name, handler)`

```ts
command(name: string, handler: (args: Record<string, unknown>) => unknown | Promise<unknown>): this
```

Registers a backend command. The page calls it by name, with no plugin argument: `window.crust.invoke("greet", { name: "jyz" })`. `args` is whatever the page sent; a two-argument page call that carries a non-object second argument arrives as `{}` (`src/runtime.ts`, the `app.invoke` handler).

Returns `this`, so calls chain.

```ts
app.command("greet", ({ name }) => {
	return `hello ${typeof name === "string" && name.length > 0 ? name : "there"}`;
});
```

The same command as `examples/hello/main.ts`, without its `console.log` line.

**Failure modes**

- `app.command("", …)` throws `crust: command name must not be empty` at registration time, whatever the handler would have done.
- Registering the same name twice throws `crust: command "greet" is already registered`. There is no unregister and no overwrite.
- Registering after `run()` has started throws `crust: cannot register command "greet" after app.run() has started`. `main.ts` registers everything before its `await app.run()`, and the throw is what makes a late registration a startup failure instead of a command the bridge's handler table never learned about.
- A handler that throws *while running* does not throw at registration: it rejects `app.invoke`, and over the bridge it becomes a `handler-error` (HTTP 500) carrying the thrown message.

### `app.use(plugin)`

```ts
use(plugin: PluginDefinition): this
```

Mounts a plugin of your own, so a page reaches it as `window.crust.invoke("<name>", "<command>", args)`. This is the whole third-party extension path: there is no config field and nothing to import from `src/bridge/`.

```ts
import { app } from "crust";
import { clock } from "./plugins/clock.ts";

app.use(clock);

await app.run();
```

The argument is the value `definePlugin` returns, and `use` re-runs `definePlugin`'s shape checks on it, so a hand-built object with a bad name or a non-function command fails here with the same `bad-request` messages. Two checks come before that and three after:

| input | message | kind |
| --- | --- | --- |
| mounted after `run()` | `crust: cannot mount a plugin after app.run() has started` | plain `Error` |
| not an object | `app.use: not a plugin definition (expected { name, commands })` | `bad-request` |
| the reserved `app` namespace | `app.use: "app" is the reserved app namespace` | `bad-request` |
| a built-in name (`fs`, `dialog`, `notification`, `tray`, `window`) | `app.use: "fs" is a built-in plugin — a name is a namespace, so pick another` | `bad-request` |
| the same name mounted twice | `app.use: plugin "clock" is already mounted` | `bad-request` |

A name is a namespace, and the bridge keys every handler as `"<plugin>.<command>"`, so a collision is refused rather than silently shadowing a built-in. `window` is reserved even when `config.plugins` does not select it. Returns `this`.

Why the mount must precede `run()`: the bridge's `"<plugin>.<command>"` table is built when the bridge starts, which is the first `run()` (`startApp` defers that creation for exactly this reason — see [`app.run()`](#apprun)). Anything mounted later would be a handler the served page cannot reach.

### `app.plugins()`

```ts
plugins(): readonly PluginDefinition[]
```

Every plugin mounted with `app.use`, in mount order. `startApp` registers these after the core and native plugins, so a project plugin can never displace a built-in. Public because it is the only way to read the mount list without starting the app; an app does not normally call it.

### `app.deferBridge(factory)` — internal

```ts
deferBridge(factory: (config: CrustConfig) => string): this
```

Hands `App` a bridge factory to call on the first `run()` instead of starting a server now. `startApp` uses it so a plugin mounted by `main.ts` is already registered when the bridge snapshots its handler table; the factory runs at most once and its return value is the URL windows load from. Throws `crust: cannot start a bridge for a running app` after `run()`. Not a user-facing option.

### `app.on(event, listener)`

```ts
on(event: "ready" | "window-all-closed", listener: () => void | Promise<void>): this
```

Two events exist, and only these two (`AppEvent` in `src/app.ts`):

| event | when |
| --- | --- |
| `"ready"` | after every configured window is created, and before the pump starts |
| `"window-all-closed"` | once, when no configured window label resolves any more |

Returns `this`.

`"window-all-closed"` is polled, not pushed: `run()` starts a 250 ms interval only when at least one listener for it exists, and that interval checks `platform.window(label)` for every configured window. When none resolve, the listeners run and then `platform.quit()` is called. If nobody listens, the check never runs and the app keeps pumping with no window.

```ts
app.on("ready", () => {
	console.log("window open");
});

app.on("window-all-closed", () => {
	console.log("closed; quitting");
});
```

**Failure modes**

- `on` itself never throws; an unrecognised event name is accepted and can never fire (the map is keyed by whatever string you pass, but only the two events above are ever emitted).
- Listeners may be async and are awaited. A `ready` listener that throws rejects `app.run()`, so the app never reaches `pump()`.
- A `window-all-closed` listener that throws leaves an unhandled rejection and `quit()` is never called, because the call is `emit(...).then(() => quit())`.

### `app.run()`

```ts
run(): Promise<void>
```

Starts the app: the deferred bridge (if `startApp` supplied one), `platform.start()`, one `platform.createWindow(…)` per `config.windows` entry, emit `ready`, then `platform.pump(16)` (`PUMP_INTERVAL_MS`). Resolves once the app is up; the process stays alive on the pump timer and the bridge afterwards. There is no "run until closed" promise to await — completion is observed through `quit()` or process exit.

With nothing attached at all, `run()` loads the config from the current directory and lazily imports `src/platform/darwin/index.ts`, which is what keeps the AppKit layer out of a process that never opens a window. With only the config attached (`app.configure`, the headless and built-wrapper path) it skips `loadConfig()` and resolves just the platform.

**The bridge is created here, not earlier.** Through `startApp`, `App.deferBridge` holds a factory and `run()` calls it before creating any window; the factory registers the core plugins the config selected, the platform's native adapters, every `app.use` plugin, and the `app` namespace, then binds. That ordering is the reason a plugin mounted in `main.ts` is reachable from the first page load.

**The port is derived from `app.id`, so the page origin is stable.** `preferredPortFor` in `src/runtime.ts` hashes the id (FNV-1a) into `45000 + (hash % 4000)`. The bridge tries `preferred + offset` for offsets 0…19 and binds `0` — letting the OS choose — on the 21st attempt, so a taken port is never a startup failure. Two launches of the same app normally share one origin, which is what keeps `localStorage`, `IndexedDB`, service workers and per-origin caches alive across a restart. The guarantee is "stable unless the port is occupied": when the walk moves, that launch has a different origin, and nothing in the runtime migrates old state.

The token is still per launch (`crypto.randomUUID()`), so a page loaded before a restart must reload before its invokes work again.

With `dev.url` set, the same factory also publishes the bridge to the dev server: it writes `.crust/dev.json` (`{ "url", "token" }`) in the project directory and sets `CRUST_BRIDGE_URL` / `CRUST_BRIDGE_TOKEN` in its own environment. The file is the carrier that matters — the runtime owns that environment and the dev server is a sibling process — so [`crust/vite`](#crustvite) reads the variables first and falls back to the file on every document request. A failed write prints `bridge    could not publish the dev handshake: …` and the launch continues; the window is loaded from the dev server, so the page simply has no client.

Window URLs are resolved per window (`windowUrl` in `src/app.ts`):

1. `config.dev.url`, if set, wins **verbatim for every window** — `window.url` is ignored in that case;
2. otherwise `bridgeUrl + window.url` (default `/`);
3. otherwise `run()` throws.

**Failure modes**, as the literal strings in `src/app.ts` and `src/runtime.ts`:

| call | error |
| --- | --- |
| second `run()` | `crust: app.run() was already called` |
| no config on disk | `no crust config in <dir>: expected crust.config.ts or crust.json in the project root` |
| not macOS | `crust: no platform for <process.platform> — macOS only for v1` |
| no `dev.url`, no bridge | ``crust: no page URL — set dev.url, or start through `crust dev` / a built app so the bridge can serve the page`` |
| a configured window has no `label` | rejected by config validation before this point |

### `app.quit()`

```ts
quit(): void
```

Stops the window watcher and calls `platform.quit()`. On macOS that stops the pump timer, sends `terminate:` to `NSApplication`, and calls `process.exit(0)` (`src/platform/darwin/index.ts`), so nothing after `app.quit()` in your process runs.

Safe before `run()`: with no platform attached it only stops the watcher and returns.

### `app.invoke(name, args)`

```ts
invoke(name: string, args?: Record<string, unknown>): Promise<unknown>
```

Runs a command on the backend. This is the backend-side entry point; the page reaches it through the `app` plugin namespace (see [plugins.md](plugins.md#how-an-invoke-reaches-a-handler)). `args` defaults to `{}`.

```ts
const greeting = await app.invoke("greet", { name: "jyz" });
```

**Failure modes**

- An unknown name throws `crust: unknown command "nope"` — never `undefined`.
- A handler's own throw is passed through unchanged (`await handler(args)`), so the message reaches the caller as-is. Over the bridge it is wrapped as `handler-error`.

### `app.attach(platform, config, bridgeUrl?)` — internal

```ts
attach(platform: Platform, config: CrustConfig, bridgeUrl?: string): this
```

Wires the platform and the config into the instance. `startApp` calls it before importing `main.ts`; tests call it with a fake platform. Public because `App` is a class with no package-private access, but it is not a user-facing option: calling it yourself is only correct in a test.

Throws `crust: cannot attach a platform to a running app` after `run()` has started.

### `app.configure(config)` — internal

```ts
configure(config: CrustConfig): this
```

Hands the instance the config without a platform. `startApp` calls it instead of `attach` when it attaches no platform (a headless bridge, or a non-macOS process), so `run()` has a config and never falls back to `loadConfig()`. Public for the same reason as `attach`: `App` has no package-private access. Calling it yourself is only correct in a test.

Throws `crust: cannot configure a running app` after `run()` has started.

---

## `App`, `createApp`, `PUMP_INTERVAL_MS`

```ts
class App { /* command, use, plugins, on, run, quit, invoke, attach, configure, deferBridge */ }
function createApp(platform: Platform, config: CrustConfig, bridgeUrl?: string): App
const PUMP_INTERVAL_MS = 16;
```

`createApp` is `new App().attach(platform, config, bridgeUrl)` and exists so a test can build an app without touching the singleton. `PUMP_INTERVAL_MS` is the Cocoa tick handed to `Platform.pump`; the 0.25 ms slice lives inside the shim (`DESIGN.md` §3). Both are exported from `src/app.ts`; neither is needed by a normal app, which uses `app` and `app.run()`.

---

## `definePlugin`

```ts
function definePlugin<Name extends string, Commands extends CommandMap>(plugin: {
	name: Name;
	commands: Commands;
}): PluginDefinition<Name, Commands>
```

Declares a plugin: a name plus a map of command handlers. The returned object is frozen (`Object.freeze` on both the plugin and a copy of the command map). The name doubles as the invoke namespace, because the bridge keys every handler as `"<plugin>.<command>"`.

A handler is `(args, ctx) => result | Promise<result>`, where `ctx` is `PluginContext` — one member, `emit(event, data)`, which pushes a server-sent event to every connected page.

```ts
import { definePlugin } from "crust/plugin";

const plugin = definePlugin({
	name: "clock",
	commands: {
		now: () => new Date().toISOString(),
	},
});
```

Mounted with `app.use(plugin)` before `run()`; the page then calls `invoke("clock", "now")`. A duplicate name, a built-in name or the reserved `app` namespace is refused with a message naming the collision, and mounting after `run()` throws. See [`app.use`](#appuseplugin) and [plugins.md](plugins.md#a-plugin-in-your-own-project).

**Failure modes** — every one throws `CrustError` with `code: "bad-request"`:

| input | message |
| --- | --- |
| name not a string, or `""` | `definePlugin: name must be a non-empty string` |
| name contains `.` | `definePlugin: name "a.b" may not contain a dot` |
| `commands` missing or not an object | `definePlugin: plugin "x" needs a commands object` |
| empty command map | `definePlugin: plugin "x" has no commands` |
| a command name contains `.` | `definePlugin: x.a.b may not contain a dot` |
| a command value is not a function | `definePlugin: x.y is not a function` |

The dot rules are load-bearing: `"<plugin>.<command>"` is the handler key, so a dotted name would make two different plugins share keys.

---

## `notImplemented`, `isNotImplemented`, `NotImplementedError`

```ts
interface NotImplemented {
	readonly ok: false;
	readonly code: "not-implemented";
	readonly message: string;
	readonly requires: string;
}
function notImplemented(message: string, requires: string): NotImplemented
function isNotImplemented(value: unknown): value is NotImplemented

class NotImplementedError extends CrustError {
	readonly requires: string;
	constructor(message: string, requires: string);
}
```

The "fail honestly" primitive. A command that cannot do the work returns `notImplemented(whatIsMissing, selector)` instead of an empty success; the registry and the bridge turn that value into a `not-implemented` error (HTTP 501) with `requires` attached. `isNotImplemented` tests the value; `NotImplementedError` is the rejecting form, for a command that must throw instead of returning.

```ts
import { definePlugin, notImplemented } from "crust/plugin";

const plugin = definePlugin({
	name: "clipboard",
	commands: {
		read: () => notImplemented("clipboard.read needs NSPasteboard", "NSPasteboard"),
	},
});
```

The exact wire shape this produces is in [plugins.md](plugins.md#the-not-implemented-error-shape).

---

## Compile-time helpers

`ArgsOf<Handler>`, `ResultOf<Handler>`, `SchemaOf<Plugins>` and `SchemaOf`'s companion `CommandSchema` exist so a typed client can derive an `invoke` from a tuple of plugin definitions. They are types only; nothing is exported at runtime for them.

```ts
import type { SchemaOf } from "crust/plugin";
import { clock } from "./src/plugins/clock.ts";

type Schema = SchemaOf<[typeof clock]>;
// { clock: { now: () => string } }
```

---

## `crust/vite`

The dev-server half of the bridge. With `dev.url` set, the window loads a document the dev server serves, so the bootstrap the bridge injects into *its own* document never reaches that page and `window.crust` does not exist. This plugin puts it there.

```ts
function crust(options?: CrustOptions): Plugin

const BRIDGE_URL_VAR = "CRUST_BRIDGE_URL";
const BRIDGE_TOKEN_VAR = "CRUST_BRIDGE_TOKEN";

interface CrustOptions {
	urlVar?: string;   // default BRIDGE_URL_VAR
	tokenVar?: string; // default BRIDGE_TOKEN_VAR
}
```

```ts
// vite.config.ts
import { crust } from "crust/vite";

export default defineConfig({
	server: { port: 5173, strictPort: true },
	plugins: [crust()],
});
```

- **Serve-only** (`apply: "serve"`). A build has no bridge, and a token shipped in built HTML is exactly what production must not carry.
- **Read per document request**, not at config time, because the dev server is spawned before the runtime's bridge binds. It tries `process.env[urlVar]` / `process.env[tokenVar]` first, then `process.env.CRUST_DEV_FILE` or `<cwd>/.crust/dev.json` — the handshake `startApp` writes (`src/runtime.ts`).
- **Injects two `<script>` tags into `<head>`**: `window.__CRUST__ = {"url":…,"token":…}` and the page client (`pageClientSource()` in `src/bridge/client.ts`, the same `installCrust` source the bridge serves, so there is no second copy of the invoke path). Both call forms therefore work on a dev-server page: `invoke("greet", {…})` two-argument and `invoke("fs", "readTextFile", {…})` three-argument.
- **Warns once and injects nothing** when neither source has a pair: `[crust] CRUST_BRIDGE_URL/CRUST_BRIDGE_TOKEN are unset, so this page gets no window.crust. Start the dev server through \`crust dev\`, which exports both for it.` A page with no `window.crust` fails loudly on its first call; a client pointed at a guessed address would fail quietly.
- **The port must not drift.** The bridge allows exactly the origin `dev.url` names (plus its own two loopback origins), so `strictPort` is required — Vite otherwise moves to the next free port and every invoke is refused `bad-origin`.

Verified by hand against a Vite 8.3.8 + React 19 app: the served document carried both tags and the two-argument call answered from the backend ([existing-react.md](existing-react.md)). There is no Next.js equivalent yet; in `next dev` the page reports `window.crust is not installed` ([next.md](next.md)).

---

## Config

`src/config/schema.ts` defines the object; `src/config/load.ts` reads it. Both `crust.config.ts` (default export) and `crust.json` are accepted, in that order, and the TS form may also export the object as `config`.

```ts
import type { CrustConfig } from "crust";

export default {
	app: { id: "land.jyz.example", name: "Example", version: "0.1.0" },
	windows: [{ label: "main", url: "/", width: 900, height: 640, title: "Example" }],
} satisfies CrustConfig;
```

### Keys and defaults

The validator fills in nothing — it only rejects. The "default" column is what the consuming code does when the key is absent, and each one was traced to its file.

| key | required | default | notes |
| --- | --- | --- | --- |
| `app.id` | yes | — | reverse-DNS `CFBundleIdentifier` written to `Info.plist`; also seeds the bridge port, so the page origin is stable across launches (`src/runtime.ts`, `preferredPortFor`) |
| `app.name` | yes | — | app name; also names platform failures |
| `app.version` | yes | — | `CFBundleShortVersionString` |
| `app.icon` | no | unset | resolved against `--dir` by `crust build`; a missing file fails the build |
| `windows` | yes | — | must be a non-empty array; an empty or missing array is a config error |
| `windows[].label` | yes | — | the key `platform.window(label)` and `window` commands use |
| `windows[].url` | no | `"/"` | appended to the bridge URL (`src/app.ts`, `windowUrl`) |
| `windows[].width` | no | `1100` | applied by `DarwinPlatform.createWindow` |
| `windows[].height` | no | `760` | same |
| `windows[].minWidth` | no | unset | applied as the window's minimum size, and the configured `height` is reused as the minimum *height* too (`shim_window_set_min_size` in `src/platform/darwin/index.ts`) |
| `windows[].title` | no | unset | applied from C and read back; a mismatch throws |
| `dev.url` | no | unset | when set, every window loads it verbatim and `windows[].url` is ignored; its origin is also the one extra origin the bridge allows for CORS |
| `dev.beforeDevCommand` | no | unset | started (not awaited) by `crust dev` via `sh -c`, in the project directory, with inherited stdio. It inherits the bridge pair only if `crust dev` already had both variables; otherwise the `.crust/dev.json` handshake is what `crust/vite` reads. With `dev.url` set, `crust dev` then waits up to 30 s for a TCP connect on that port before spawning the runtime — the window loads the URL exactly once and cannot retry — and aborts with a message naming the URL if nothing listens |
| `build.beforeBuildCommand` | no | unset | run **first**, before the asset directory is read, via `sh -c` in the project directory with inherited stdio; a non-zero exit aborts the build with a message naming the command and its exit code |
| `build.assets` | no | `public` | directory `crust build` embeds, relative to `--dir`. A *named* directory must exist and hold `index.html`, or the build stops; it may not resolve to `dist/`, where `crust build` writes, because a second build would embed its own binary |
| `build.minimumSystemVersion` | no | `"13.0"` | `LSMinimumSystemVersion`; default in `src/cli/build.ts` |
| `plugins` | no | all five built-ins | `crust:` prefix optional; naming any restricts registration to exactly those named |
| `security.csp` | no | `DEFAULT_CSP` | `src/bridge/server.ts`; must keep `connect-src 'self'` or every invoke becomes a CSP violation |

`build.assets` and `build.beforeBuildCommand` are the pair a built frontend needs, and the order is the point: the command runs to completion, then the directory is read, then it is checked for `index.html`. A framework app therefore never ships whatever happened to be in its output directory from an earlier run. With `assets` absent the old behaviour stands — `public/` is embedded when it exists, and a project with no frontend directory still builds.

`plugins` deserves the extra sentence: absent or `[]` means `fs`, `dialog`, `notification`, `tray` and `window` are all registered. `["crust:fs"]` registers `fs` only — every other plugin name then answers `unknown-command` on the bridge. An unknown name fails startup with `crust: unknown plugin "nope" — v1 ships fs, dialog, notification, tray, window`. The `app` namespace is always registered, whatever `plugins` says, and a plugin mounted with `app.use` is always registered too — `plugins` selects built-ins only.

### Reading and validating

```ts
const CONFIG_FILES = ["crust.config.ts", "crust.json"] as const;

function loadConfig(options?: { dir?: string; configPath?: string }):
	Promise<{ config: CrustConfig; path: string }>;

function findConfig(dir: string): Promise<string | undefined>;

function validateConfig(value: unknown, source?: string): CrustConfig;

class ConfigError extends Error {
	readonly issues: Array<{ path: string; expected: string; received?: string }>;
}
```

`loadConfig` picks `crust.config.ts` then `crust.json` in `dir` (default: the current directory), or an explicit `configPath` relative to `dir`, and validates what it read. `findConfig` answers the same question without loading. Both are used by the CLI; an app rarely calls them, because `startApp` and `app.run()` already do.

`validateConfig` throws `ConfigError` listing **every** issue, not just the first. Verified output for one bad key:

```text
invalid crust config in crust.config.ts:
  windows[0].width — expected a positive integer, got "wide"
```

and for an unknown key:

```text
invalid crust config in crust.config.ts:
  app.color — expected one of "id", "name", "version", "icon", got "red"
```

Extra keys are rejected at every level, which is why a typo is a startup failure rather than a silently ignored option.

**Failure modes** of `loadConfig`: no config file, an explicit path that does not exist, unreadable or unparsable JSON, a module with no default export, and an unsupported extension all throw plain `Error`s naming the path; validation failures throw `ConfigError` with the `issues` array intact.

---

## `Platform` — internal

```ts
interface Platform {
	start(): Promise<void>;
	pump(intervalMs: number): void;
	createWindow(options: WindowOptions): WindowHandle;
	window(label: string): WindowHandle | undefined;
	quit(): void;
}

interface WindowOptions {
	label: string;
	url?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	title?: string;
}

interface WindowHandle { label: string }
```

Exported because `App.attach` takes one and tests pass a fake, not because it is a supported extension point. v1 has exactly one implementation, `src/platform/darwin/`, and there is no registration mechanism for a second. Two sites construct it: `startApp` builds it before any plugin (`src/runtime.ts`), and `app.run()` does the same lazily when nothing is attached, which is what keeps AppKit out of a process that never opens a window.

Behaviour worth knowing even so, because `App` depends on it:

- `start()` is idempotent within an instance and throws when any preflighted selector is missing, naming every one at once.
- `pump(intervalMs)` throws unless the interval is a finite positive number.
- `createWindow` throws on an empty label and on a duplicate label.
- `window(label)` returns `undefined` once that window has closed. Liveness is the measured rule in `windowLiveness`: visible, or miniaturised, or the app hidden — never `-windowNumber`, which keeps its value after `-close`, and never a plain visibility test, because a minimised window is still open.
- `windowLabels()` is a macOS extra, outside the interface: the labels whose windows AppKit still holds. A closed window's native object survives on purpose, because the liveness check needs it, so this filters by `windowLiveness` rather than returning every label ever created. The `window` plugin's `list` reads it, which is why a page that closes a window does not see it come back in the next listing.
- `quit()` exits the process (`DESIGN.md` §3 explains why the pump must own the loop instead of `[NSApp run]`).

Why the seam exists and what it costs to add a second platform is `DESIGN.md` §6.

---

## The built-in plugin surface

Five names exist, in `src/plugins/`. `config.plugins` selects among them; `startApp` replaces `dialog`, `tray` and `notification` with the platform's native adapters and always appends `window`. Two failure shapes reach a page and page code must handle both: a returned `NotImplemented` becomes a `501 not-implemented` rejection, while `window` and `tray` answer a typed `{ ok: false, code, message }` inside an ordinary `200`. Wire bodies and the full per-plugin reasoning are in [plugins.md](plugins.md#the-built-in-plugins-today).

| plugin | commands | answers |
| --- | --- | --- |
| `fs` | `readTextFile`, `writeTextFile`, `list`, `stat`, `remove`, `rename` | file text, `{ bytes }`, `{ entries: [{ name, path, directory, size }] }`, `{ path, directory, size, modified }`, `{ removed, path }`, `{ path }`. A missing path is `not-found` (404), a non-string path `bad-request` (400). `list` returns absolute paths and sorts by name; `remove` deletes a non-empty directory only with `recursive: true` |
| `dialog` | `openPanel`, `savePanel`, `cancel` | `{ paths: string[] }`; `savePanel` picks exactly one file, so its list holds one path or none, and `[]` means the user cancelled — never an error and never `not-implemented` from a real adapter. `cancel` ends the sheet that is up and answers `{ cancelled, paths: [] }`, where `cancelled: false` means nothing was pending; that is an ordinary race with the user, deliberately not an error. One sheet exists at a time, so a second panel request while one is up is refused with a message naming the panel that is already up |
| `window` | `create`, `close`, `focus`, `setTitle`, `list`, `isOpen` | `{ ok: true, … }` or `{ ok: false, code: "unknown-window" \| "invalid-label" \| "invalid-size" \| "invalid-url" \| "duplicate-label" \| "unknown-adapter" \| "handler-error", message, label? }`. `create` answers `{ ok: true, label, created: true }`; a label that is already open is `duplicate-label`, and a third-party adapter without `WindowNative.create` answers `unknown-adapter` |
| `tray` | `setTitle`, `setMenu`, `show`, `hide`, `destroy` | `{ ok: true, … }` or `{ ok: false, code: "invalid-text" \| "invalid-menu" \| "unknown-adapter" \| "destroyed" \| "handler-error", message }` |
| `notification` | `requestPermission`, `notify` | `notify` → `{ delivered: boolean, reason: string }`; `requestPermission` → `not-implemented` whenever a real adapter is present |

Four of those deserve one sentence each, because the shape is not obvious from the command name:

- **`dialog`** is a sheet, not a modal, whenever a window exists: the panel is started with `beginSheetModalForWindow:completionHandler:`, the C completion handler records `NSModalResponse`, and `awaitSheetResult` polls the done flag on a 16 ms timer — so the pump and in-flight invokes keep running while the picker is up. With no key window it falls back to `-runModal`, which blocks the JavaScript thread for the whole pick. `filters` is flattened to one comma-separated extension list and applied through the deprecated `-setAllowedFileTypes:`, because macOS 27's `allowedContentTypes` needs UTType objects that cannot cross `bun:ffi`. `multiple` and `directory` map to `allowsMultipleSelection` / `canChooseDirectories`; `savePanel` is `NSSavePanel` on the same machinery, takes a `suggestedName` for its name field, and answers one path or none. **One sheet at a time**: the C side holds one panel, one done flag and one path list, so a second `openPanel` or `savePanel` while a sheet is up answers `SHIM_PANEL_BUSY` before touching anything, and that becomes a rejected invoke — `handler-error`, HTTP 500 — whose message names the panel that is already up and names `dialog.cancel` as the way out. `dialog.cancel` is that way out: it sends `-cancel:`, waits up to `SHEET_CANCEL_TIMEOUT_MS` (2000 ms) for the completion handler, abandons the poll of the sheet it ended and answers `{ cancelled: true, paths: [] }`; with nothing pending it answers `{ cancelled: false, paths: [] }`, deliberately not an error, because a page races the user's own click all the time. A save over an existing file still gets AppKit's own replace prompt, and crust adds no second confirmation. A sheet has been shown, held pending and cancelled in a real window, for both panels; a completed pick or save needs a human — see [Unverified](#unverified).
- **`tray`** is one `NSStatusItem` per process with a title and a menu; a second `createStatusBar()` throws until the first is destroyed, because the ObjC runtime holds a single click IMP. A page cannot send a function, so every row click is also emitted as the `tray:click` event carrying `{ index, label }`.
- **`notification`** reports the OS's own status: `delivered` is true only when the adapter's status is 0. Statuses 1 (authorization pending or denied), 2 (a class or selector is missing) and 3 (the API errored) all come back as `delivered: false` with the reason intact, so a missing permission is never a silent success. **Delivered, measured on 2026-11-14** (`{"delivered": true}` from a built app). Two other answers are real and mean different things: unbundled (`crust dev`) the process has no bundle identifier, so `UNUserNotificationCenter` is never entered and the reason names the absent `NSUserNotification` selector; and a bundle identifier that macOS has already recorded as denied keeps answering `UNErrorDomain code 1` whatever you sign it with — ad-hoc and an Apple Development certificate were both refused, and a fresh identifier delivered under both. Change `app.id` to be asked again.
- **`window.create`** takes `{ label, title?, width?, height?, url? }` and is the answer to a page that closed its only window: before it, a re-open meant keeping a hidden window alive. The plugin half is complete (`src/plugins/window.ts`, with tests), and the macOS `darwinWindowAdapter` implements `WindowNative.create` by delegating to `DarwinPlatform.createWindow` and nothing more: a **live** label is refused as `duplicate-label` before anything is released, a **closed** one is pruned first with `platform.window(label)` so `createWindow` does not refuse a label nobody can see in `list`, and a relative `url` resolves against the document the platform recorded for an open window (`windowUrl`), so it needs some open window that loaded a real `http(s)` document — with none there is no base, and the command answers `handler-error` rather than guessing an origin. Neither `CRUST_BRIDGE_URL` nor `.crust/dev.json` is reachable from the adapter: the runtime publishes them only when `dev.url` names a dev server, and a built app runs from `/`. The capability check runs before the arguments, deliberately: an adapter without `create` says `unknown-adapter` rather than complain about a request it would never run. With an adapter present the payload is validated (a non-integer size is `invalid-size`, refused not clamped; an empty `url` is `invalid-url`; an already-open label is `duplicate-label`), and the plugin reads the platform's list back afterwards, so an adapter that answers without tracking the new label is a `handler-error` rather than a window that every later command denies.

---

## The command line

`src/cli/index.ts` is the `crust` binary.

| command | does |
| --- | --- |
| `crust init <dir> [--react \| --next]` | scaffold into an empty directory: plain HTML by default, React + Vite with `--react`, Next.js with `--next` |
| `crust dev [file]` | watch the backend, restart it on change, keep the frontend with its own dev server; with a `.tsx`/`.jsx`/`.ts`/`.js` positional, run that one file as the app |
| `crust build [file]` | compile the binary, assemble `X.app`, ad-hoc sign it; with a positional, build the single-file app |
| `crust sign` | Developer ID signing (needs a certificate) |
| `crust dmg` | drag-to-Applications disk image |
| `crust doctor` | diagnose a launch instead of guessing: that the C shim compiles, the bridge binds, the port the app will actually get is free, that the `dev.url` port is usable (one of four states: free, held by a process that answers the URL, held by one that answers nothing — the `strictPort` failure and the only `fail` — or answering with nothing listening locally, which is a proxy), whether page-side `.ts` files exist that the backend watcher would restart on (a note, never a failure, because the app runs), the asset directory holds `index.html`, the templates are present and a built bundle's signature |

Options: `--dir <path>` (project directory, default the current directory), `--config <path>` and `--entry <path>` (both relative to `--dir`), `--react` / `--next` (init only, and mutually exclusive — passing both is refused before anything is written), `--help`/`-h`, `--version`/`-v`. An unknown option, a second positional, or a template flag anywhere but `init` is an error, not a fallback.

**The config-free mode.** `crust dev app.tsx` and `crust build app.tsx` take one file and no config at all: the app id is `crust.single.<slug>`, the name and window title come from the basename, the version is `0.0.0`, and the one window is 900×700. The page is bundled with `Bun.build` — `<dir>/.crust/single` in dev, `<dir>/dist/single` in a build — and the backend is the framework itself, which registers `info` and `echo` so `window.crust.invoke("info")` proves the round trip. A file whose source contains `export default` is mounted as a React component; any other file is loaded for its own side effects. A `crust.config.ts` beside the file is refused rather than guessed at. The whole contract, including what it does not support, is [single-file.md](single-file.md).

---

## Unverified

These are the claims this page does not make. Each is code that exists, exercised only in part.

1. **The Next.js build path, part one: a human using the exported app.** `build.assets: "out"` with `beforeBuildCommand: "bun --bun ./node_modules/.bin/next build"` is measured end to end: `crust build` ran the export (21 files from `out/`), embedded them, produced an 85.83 MiB binary, and that binary served the document, a `_next` chunk and `/about`, 403'd a missing asset, and answered the page's `invoke` — see [next.md](next.md). What has not happened is a person clicking around the exported app, so client-side navigation and hydration are proven only by the served markup and the round trip.
2. **A dialog pick — verified by a person on 2026-11-14.** Both panels were exercised in a real window earlier (the open panel reported `sheetStarted`, was still pending 400 ms later, and `-cancel:` resolved `{ paths: [] }` through the poll; the save panel did the same). On 2026-11-14 a person then picked a folder in a built app and saved a file through the save panel, and the UI updated — so the OK response and a real path list are now observed. Still unobserved: AppKit's overwrite prompt (nothing has replaced an existing file through the panel), and the `-runModal` fallback, which needs a window-less launch.
3. **A tray item created, and clicked — verified by a person on 2026-11-14.** An item is created, titled, shown, hidden and destroyed in a run, and AppKit readback reports its title, `isVisible: true`, a button window on the menu-bar row and its frame. A person then clicked a menu row in a built app and the app reported the save, which means the row's action ran; independently, `activateRow(index)` fires the same row through `sendAction:to:from:` and answers `sent=true fired=Save now`, so the row action, the runtime trampoline and the JS `onClick` are all proven. The `tray click — <label>` log line was missing only because that running instance predated the app's own log file.
4. **A delivered notification — delivered on 2026-11-14, and the earlier explanation was wrong.** A probe posted through `notification.notify` and the completion handler reported no error: `{"delivered": true}`. The signature was never the cause. Measured matrix, same probe app: `land.jyz.crust-notify-probe` answered `UNErrorDomain code 1` ad-hoc, under an Apple-issued **Apple Development** certificate, launched directly and through LaunchServices, from `dist/` and from `~/Applications`. A **fresh bundle identifier** answered `delivered: true` under ad-hoc *and* under Apple Development, from both locations. So macOS caches authorization per bundle identifier and a recorded denial is never re-asked; changing `app.id` is the way out, and `notify` now says so instead of blaming the signature. Still unobserved: a notification that a person watches arrive, and the trusted-app prompt on a first post. Note the separate trap for *privacy* grants: macOS keys those to the designated requirement, which for an ad-hoc signature is the binary's own cdhash, so every `crust build` looks like a new app and re-prompts — `CRUST_SIGNING_IDENTITY` gives a stable one.

Both single-file modes moved out of this list: `bun run e2e:single` covers `crust dev app.tsx` and `crust build app.tsx` in 19 assertions — the page answering in dev, the built bundle signed and answering with cwd `/`, a save that rebuilds without restarting the runtime, and a syntax error that leaves the last good bundle running.

So did `window.create`. `bun run e2e:window` creates four windows through the command, three of which load a document that reports back from inside itself, in 61 assertions: a relative `url` resolved against the document the platform recorded for an open window, an absolute one loaded as given, a live label refused with nothing released, and a closed label re-created with its page loading again — plus `invalid-size` as a fraction and as zero, and `invalid-url`. The tag set is compared before anything else and exactly, so a page that dies early fails rather than passing on a subset.

---

## Errors at a glance

Every bridge failure carries a machine-readable `code` (`src/bridge/errors.ts`). Page code branches on `error.code`, not on a status.

| code | HTTP | raised by |
| --- | --- | --- |
| `unauthorized` | 401 | missing or wrong bearer token |
| `bad-origin` | 403 | absent or foreign `Origin` header |
| `not-found` | 404 | unknown route, or `fs.readTextFile` on a missing file |
| `unknown-plugin` | 404 | `PluginRegistry.invoke` only — the bridge flattens names and reports `unknown-command` |
| `unknown-command` | 404 | no `<plugin>.<command>` handler, including an unknown plugin over the bridge |
| `bad-json` | 400 | invoke body is not JSON |
| `bad-request` | 400 | malformed payload, bad argument, or a `definePlugin` violation |
| `handler-error` | 500 | a handler threw something that was not a `CrustError` |
| `too-large` | 413 | body over 2 MiB |
| `not-implemented` | 501 | a command returned `notImplemented(...)` |

`not-implemented` is measured end to end, not inferred; the body is in [plugins.md](plugins.md#the-not-implemented-error-shape).
