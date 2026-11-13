# crust API reference

`crust` 0.1.0, macOS arm64 only for v1. This page documents every export of the package root (`import … from "crust"`) and the second entry point (`import … from "crust/plugin"`). Nothing here is aspirational: each signature, default and error message was read from the source file named beside it, and every behavioural claim (what throws, what the wire returns) was checked by running it against this checkout on 2026-11-13.

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
```

Nothing in this package is imported by a page. Page code uses the global `window.crust` the bridge injects; see [plugins.md](plugins.md).

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
- A handler that throws *while running* does not throw at registration: it rejects `app.invoke`, and over the bridge it becomes a `handler-error` (HTTP 500) carrying the thrown message.

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

Starts the app: `platform.start()`, one `platform.createWindow(…)` per `config.windows` entry, emit `ready`, then `platform.pump(16)` (`PUMP_INTERVAL_MS`). Resolves once the app is up; the process stays alive on the pump timer and the bridge afterwards. There is no "run until closed" promise to await — completion is observed through `quit()` or process exit.

With nothing attached, `run()` loads the config from the current directory and lazily imports `src/platform/darwin/index.ts`, which is what keeps the AppKit layer out of a process that never opens a window.

Window URLs are resolved per window (`windowUrl` in `src/app.ts`):

1. `config.dev.url`, if set, wins **verbatim for every window** — `window.url` is ignored in that case;
2. otherwise `bridgeUrl + window.url` (default `/`);
3. otherwise `run()` throws.

**Failure modes**, all measured against this checkout:

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

Wires the platform, config and bridge URL into the instance. `startApp` calls it before importing `main.ts`; tests call it with a fake platform. Public because `App` is a class with no package-private access, but it is not a user-facing option: calling it yourself is only correct in a test.

Throws `crust: cannot attach a platform to a running app` after `run()` has started.

---

## `App`, `createApp`, `PUMP_INTERVAL_MS`

```ts
class App { /* command, on, run, quit, invoke, attach */ }
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

Shown without a call site on purpose: `crust` has no public hook to mount your own plugin yet. Read [plugins.md](plugins.md#a-third-party-plugin-in-your-own-project) for exactly how far a project-local plugin gets today.

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
| `app.id` | yes | — | reverse-DNS `CFBundleIdentifier` written to `Info.plist` |
| `app.name` | yes | — | app name; also names platform failures |
| `app.version` | yes | — | `CFBundleShortVersionString` |
| `app.icon` | no | unset | resolved against `--dir` by `crust build`; a missing file fails the build |
| `windows` | yes | — | must be a non-empty array; an empty or missing array is a config error |
| `windows[].label` | yes | — | the key `platform.window(label)` and `window` commands use |
| `windows[].url` | no | `"/"` | appended to the bridge URL (`src/app.ts`, `windowUrl`) |
| `windows[].width` | no | `1100` | applied by `DarwinPlatform.createWindow` |
| `windows[].height` | no | `760` | same |
| `windows[].minWidth` | no | — | accepted by the schema and carried in `WindowOptions`, but **no implementation reads it**: the macOS window ignores it |
| `windows[].title` | no | unset | applied from C and read back; a mismatch throws |
| `dev.url` | no | unset | when set, every window loads it verbatim and `windows[].url` is ignored |
| `dev.beforeDevCommand` | no | unset | started (not awaited) by `crust dev` via `sh -c`, in the project directory |
| `build.beforeBuildCommand` | no | unset | run by `crust build` via `sh -c`; a non-zero exit aborts the build |
| `build.minimumSystemVersion` | no | `"13.0"` | `LSMinimumSystemVersion`; default in `src/cli/build.ts` |
| `plugins` | no | all five built-ins | `crust:` prefix optional; naming any restricts registration to exactly those named |
| `security.csp` | no | `DEFAULT_CSP` | `src/bridge/server.ts`; must keep `connect-src 'self'` or every invoke becomes a CSP violation |

`plugins` deserves the extra sentence: absent or `[]` means `fs`, `dialog`, `notification`, `tray` and `window` are all registered. `["crust:fs"]` registers `fs` only — every other plugin name then answers `unknown-command` on the bridge. An unknown name fails startup with `crust: unknown plugin "nope" — v1 ships fs, dialog, notification, tray, window`. The `app` namespace is always registered, whatever `plugins` says.

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

Exported because `App.attach` takes one and tests pass a fake, not because it is a supported extension point. v1 has exactly one implementation, `src/platform/darwin/`, and there is no registration mechanism for a second: the only construction site is `app.run()`'s lazy import, which builds `darwin.createPlatform({ appName })`.

Behaviour worth knowing even so, because `App` depends on it:

- `start()` is idempotent within an instance and throws when any preflighted selector is missing, naming every one at once.
- `pump(intervalMs)` throws unless the interval is a finite positive number.
- `createWindow` throws on an empty label and on a duplicate label.
- `window(label)` returns `undefined` once that window has closed; on macOS liveness is `-windowNumber !== 0`, never visibility, because a minimised window is still open.
- `quit()` exits the process (`DESIGN.md` §3 explains why the pump must own the loop instead of `[NSApp run]`).

Why the seam exists and what it costs to add a second platform is `DESIGN.md` §6.

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
