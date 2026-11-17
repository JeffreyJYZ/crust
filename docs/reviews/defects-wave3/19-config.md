# App config schema and `src/config/`
Area: every key an app may set, its validator, and the consumer that reads it.

## Findings

### 1. `shell.cwdRoot` accepts a relative path; the runtime resolves it against process cwd — HIGH
`src/config/validate-shell.ts:34` / `src/plugins/shell-resolve.ts:75`
The validator only checks that `cwdRoot` is a non-empty string, so `cwdRoot: "data"` or `".."` is accepted. The consumer does `resolve(options.cwdRoot ?? process.cwd())`, i.e. resolves a relative root against the **process cwd**, not the project or app root. The same trap is explicitly refused for the sibling `fs.scope` (`validate-fs.ts:30` refuses anything not `isAbsolute`, with the reason "resolved against whatever cwd the process was launched with"). In `crust dev` the cwd is the project; in a built app it is `/` (`site/app/docs/guides/shell/page.mdx:17`), so the same config yields two different shell boundaries. A relative `".."` from `/` resolves to `/`, making `inside()` true for every path and silently removing the cwd boundary.
**Breaks:** A project-relative `cwdRoot` (natural, since `build.assets` and `extensions` are project-relative) points at a nonexistent or wrong directory in a built app; shell `cwd`/relative-program grants silently broaden or narrow between dev and production. The docs advise naming it absolutely but nothing enforces that, contrary to the schema's own "never a silent default" contract.
**Evidence:** `v.string(shell, "cwdRoot", "shell", false);` vs `const named = resolve(options.cwdRoot ?? process.cwd());`

### 2. `app.id` accepts path separators; consumers build data paths from it unvalidated — MEDIUM
`src/config/validate-app.ts:10` / `src/plugins/window-persist-store.ts:26`
Validation requires only a non-empty string for `id`, so `"../../evil"` passes. But `defaultStateRoot(appId)` does `join(homedir(), "Library", "Application Support", app)`, and `startCrashGuard` calls `mkdirSync(root, {recursive:true})` on it at launch, so a separator escapes the app support directory. The single-instance plugin refuses exactly this shape (`single-instance.ts:76`: `id === "." || id === ".." || id.includes("/") || id.includes("\\")`) and the launch path folds it to `_` (`runtime-single.ts:72`), so two consumers interpret the same config id differently.
**Breaks:** A malformed id accepted at config validation creates directories outside `~/Library/Application Support` and splits the app's state across a folded name (lock) and an unfolded name (crash/store/download/window-state roots). The "every key validated at startup" promise is false for this key.
**Evidence:** `v.string(app, "id", "app", true);` vs `if (id === "." || id === ".." || id.includes("/") || id.includes("\\")) throw new TypeError(...)`.

### 3. `store.json` ignores `app.id` — every crust app shares one store — MEDIUM
`src/runtime-plugins.ts:76`
`nativePlugins` receives `app: config.app.id` and threads it to crash, downloads and window-state (`defaultStateRoot(appId)`), but builds the store with `createStorePlugin()` and no adapter, so `defaultStoreRoot` falls back to the literal `"crust"`. Docs say the store sits "under the app's data directory" (`site/app/docs/reference/api-fs/page.mdx:38`) and the factory test is named "the default root is the app's Application Support directory" (`store.test.ts:125`).
**Breaks:** Two different crust apps launched by the same user read and write the same `~/Library/Application Support/crust/store.json`; a key set by one appears in the other, and a `store.save`/`clear` in one erases the other's data. `app.id` is documented as the per-app identity but is silently dropped for this plugin.
**Evidence:** `const storePlugin = createStorePlugin();` (no `appId`/`root`), while the same function passes `app: appId` to downloads and `root: appRoot` to crash.

### 4. `reference/config` calls itself the "full table" but omits four root sections and one build key — MEDIUM
`site/app/docs/reference/config/page.mdx:62`
`ROOT_KEYS` (`src/config/schema.ts:21`) has ten keys: app, windows, dev, build, plugins, extensions, security, fs, shell, updater. The reference documents six (no `extensions`, `fs`, `shell`, `updater`), and its `build` table (lines 60–64) omits `urlScheme` even though the validator accepts it and `crust build` writes it into `Info.plist`. `site/app/docs/start/files/page.mdx:62` directs readers here as "The full table".
**Breaks:** An app author following the config reference will not learn that `fs.scope`, `shell.allow/cwdRoot`, `updater.*`, `extensions` or `build.urlScheme` exist; they are only in scattered guides, so the central contract undercounts the schema.
**Evidence:** "The full table ... is in [Config]" vs a page whose `##` sections stop at `security`.

### 5. `plugins` default documented as five built-ins; runtime registers far more — LOW
`site/app/docs/reference/config/page.mdx:70-72` / `src/plugins/core.ts:25`
The docs state "Absent or `[]` registers `fs`, `dialog`, `notification`, `tray` and `window`" ("all five"). `corePlugins` actually holds seven (`fs`, `dialog`, `notification`, `tray`, `autostart`, `logging`, `stronghold`), and `nativePlugins` appends `window`, `store`, `shell`, `updater` plus ~16 darwin-only plugins before `selectedPlugins` returns the whole array when `plugins` is absent. The documented error string `v1 ships fs, dialog, notification, tray, window` also cannot match the real message, which is built from the live `known` list (`runtime-shim.ts:44`).
**Breaks:** Users cannot predict what `plugins` selects by omission, and the documented unknown-plugin message is wrong, so the doc's account of this config key is not the code's behaviour.
**Evidence:** "all five" vs `export const corePlugins = [fsPlugin, dialogPlugin, notificationPlugin, trayPlugin, autostartPlugin, loggingPlugin, strongholdPlugin]`.

## Coverage
Read all of `src/config/` (schema, types, load, issues, validator, all ten `validate-*.ts` and their tests) and the consumers in `src/runtime.ts`, `src/runtime-plugins.ts`, `src/runtime-shim.ts`, `src/runtime-single.ts`, `src/app-loop.ts`, `src/plugins/{shell,shell-resolve,updater,updater-types,store,store-file,single-instance,window-persist-store,core}.ts`, `src/extensions/entry-source.ts`, `src/cli/{build,dev}.ts` and `src/bridge/server*`. Cross-checked `site/app/docs/reference/config`, `start/files`, `guides/shell`, `guides/files`, `guides/extensions`, `guides/updater`, `guides/package` and `reference/api*`. Did not run the suite (house rule) or open other hunters' reports. Next I would verify whether `build.assets`/`app.icon` absolute values or a newline in `security.csp` reach a consumer that rejects them, and whether any root key is accepted but never read on non-darwin platforms.
