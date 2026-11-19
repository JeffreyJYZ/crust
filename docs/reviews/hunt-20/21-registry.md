## HIGH — non-darwin arm crashes at startup when `fs.scope` is configured
- where: `src/runtime-plugins.ts:54-57` (`scoped` uses `createFsPlugin`), `:82-95` (early return to the non-darwin arm), `:118` (`createFsPlugin` bound only in the darwin destructure); applied at `src/runtime-plugins-other.ts:68`.
- mechanism: `scoped` closes over `createFsPlugin`, a `const` bound by the dynamic-import destructure that runs only in the darwin branch. The non-darwin arm returns at line 83 before that destructure executes, so `createFsPlugin` stays in the temporal dead zone. When `fs.scope` is set, `scoped(fsPlugin)` evaluates `createFsPlugin({ allow: fs.scope })` and throws `ReferenceError`.
- reachable by: any Linux or Windows app whose config sets `fs.scope` (a validated option, `src/config/types.ts:99-101`); `startApp` (`src/runtime.ts:73-78`) always passes a named options object, so `fs` is extracted and the crash fires before the bridge is built. `measured` on macOS through the injectable `os` parameter: `nativePlugins(corePlugins, undefined, { fs: { scope: ["/tmp"] }, app: "x" }, "linux")` and the same with `"win32"` both throw `ReferenceError: Cannot access 'createFsPlugin' before initialization`. Not a Windows or Linux runtime observation — the OS arm was forced by the parameter.
- smallest fix: add `createFsPlugin` to the shared destructure at `src/runtime-plugins.ts:58-67` (or a static import) so it is initialized before `scoped` is applied on both arms.

## MEDIUM — a bare/fs-only options object silently loses its filesystem scope
- where: `src/runtime-plugins.ts:31-34` (`optionsOf`), `:49`, `:54-57`.
- mechanism: `named` checks only `shell`, `updater`, `app`. A call passing the documented `NativePluginOptions` shape with alone `fs` is re-wrapped as `{ shell: options }`, so `fs` is undefined, `scoped` returns the fs plugin unchanged, and the intended sandbox is never applied.
- reachable by: calling the exported `nativePlugins(core, platform, { fs: { scope: [...] } })`. `measured`: with `{ fs: { scope: ["/Users/jyz/dev/crust/src"] } }`, `fs.readTextFile({ path: "/etc/passwd" })` returned the file contents instead of `outside-scope`. Note this is independent of the HIGH finding: fixing that one leaves this silent lie in place.
- smallest fix: add `"fs" in options` to the `named` test in `optionsOf`.

## LOW — `PluginRegistry.invoke` answers inherited `Object.prototype` members as commands
- where: `src/plugins/registry.ts:74-80`.
- mechanism: `plugin.commands[commandName]` walks the prototype chain; built-in command maps are plain objects, so a key such as `toString` resolves to a function and passes `typeof handler === "function"`.
- reachable by: any direct caller of the public `invoke` with a prototype key. `measured`: `registry.invoke("x", "toString", {}, {})` returned `"[object Undefined]"` instead of `unknown-command`. Page invokes take the `handlerMap` flat `Map` path, so they are not affected.
- smallest fix: require an own property (`Object.hasOwn(plugin.commands, commandName)`) before accepting the handler.

## LOW — `PluginRegistry.handlers()` silently overwrites duplicate flat keys
- where: `src/plugins/registry.ts:89-97`, `:100-107`, `:115-117`.
- mechanism: `handlers()` flattens with `Map.set`, so a dotted command name on one plugin and a plain command on a plugin whose name is the prefix collapse to one key. `handlerMap`'s `addHandler` duplicate guard never sees the collision because `handlers()` already collapsed it — a namespace is silently shadowed, the exact opposite of the registry's stated contract.
- reachable by: registering two hand-built definitions `{"name":"a","commands":{"b.c":fn}}` and `{"name":"a.b","commands":{"c":fn}}`; `register()` accepts dotted names and commands because it only type-checks `name` and `commands`. `measured`: `handlers()` keys were `["a.b.c"]` and the second handler won. `definePlugin` forbids dotted names/commands, so built-ins cannot produce this.
- smallest fix: route `handlers()` through `addHandler` and re-validate command names in `register()`.

## LOW — keychain selection ignores the injectable `os` argument
- where: `src/runtime-keychain.ts:14-27`, called from `src/runtime-plugins.ts:79`.
- mechanism: every other per-OS selector in this path (`windowPlugins`, `coreNamespacePlugins`, `nonDarwinScreenPlugin`, `nonDarwinDialogPlugin`) takes `os` so the arm is testable off that OS; `platformKeychainPlugin` reads `process.platform` directly.
- reachable by: any `nativePlugins` caller passing an explicit `os` different from `process.platform` — including the registry tests, which build a win32/linux set carrying the host's keychain adapter. `read`. No production impact: `os` defaults to `process.platform`.
- smallest fix: thread `os` into `platformKeychainPlugin(os)` and dispatch on it.

## LOW — clipboard's no-adapter refusal names the wrong platform off macOS
- where: `src/plugins/clipboard-contract.ts:73-78`.
- mechanism: `missingCommand()` hardcodes NSPasteboard/AppKit in both message and `requires`, and is the answer for a `null` read or for the bare no-adapter plugin on any OS.
- reachable by: a no-adapter arm (bare `clipboardPlugin` registered when no clipboard adapter exists, e.g. `os="freebsd"`); a page calling `clipboard.read` gets a macOS refusal. The Linux and Windows clipboard adapters throw instead of returning `null`, so those arms do not produce this message. `read`.
- smallest fix: parameterize `missingCommand` by the platform's required API, as `nonDarwinScreenPlugin` does with `requires`.

## Checked and clean
- Adapter replacement sets: `REPLACED` in `runtime-adapters-other.ts:29-32` and `ADAPTED`/`ADAPTED_WIN32` in `runtime-plugins-other.ts:45-47` drop exactly the bare namespaces that `coreNamespacePlugins`/`windowPlugins` re-add; both arms register each name once (also asserted in `runtime-adapters-other.test.ts:129-139` and the two window registry suites). `read`, plus `measured` plugin counts of 32 for the linux/win32 arms.
- Tray pump slot: `coreNamespacePlugins` calls `setActive*Tray` on each arm, and both platform modules import `pollTrayTick`, so `tray.setMenu` is not an ok:true with no click relay. `read`.
- Bridge invoke lookup: `createRunner` uses `handlers.get(key)` on a `Map` (`src/bridge/server/invoke.ts:52`), so the prototype issue above cannot be reached from a page request. `read`.
- Clipboard write verdicts: the Linux and Windows `writeText` adapters throw on an unopened clipboard rather than returning `missing` (`platform/{linux,windows}/clipboard.ts`), so the wrong-platform `missingCommand` branch is not produced on those arms. `read`.
- Darwin arm: `createFsPlugin` is initialized at line 118 before `scoped` is applied at line 158, so `fs.scope` does not crash macOS. `measured` — the darwin arm with a platform attached and a scope returned normally.
