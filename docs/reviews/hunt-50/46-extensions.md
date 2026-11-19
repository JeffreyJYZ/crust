# Hunt 50 · 46 · Extension loading

Scope: every file in `src/extensions/` (`load.ts`, `define.ts`, `project.ts`, `entry-source.ts`, `registry.ts` and their tests). Consumers were read for reach only: `src/cli/build.ts`, `src/cli/dev.ts`, `src/cli/dev/entry.ts`, `src/cli/build/wrapper.ts`, `src/single-build.ts`, `src/plugins/registry.ts`, `src/plugins/define.ts`, `src/runtime.ts`, `src/config/validate-extensions.ts` and `site/app/docs/guides/extensions/page.mdx`.

Method: `fd`/`rg` to enumerate and cross-reference, then read every file in scope and its callers. Read-only; no source edits and no screen-touching probes.

**Count: 7 findings (1 high, 3 medium, 3 low). Worst is #1.**

---

## 1. HIGH (worst) — the build path registers every default export unvalidated, so a broken extension fails at app startup instead of at the command that loaded it

`src/extensions/entry-source.ts:35-41` generates:

```
try { extensions.push((await import(<path>)).default); } catch { ... }
return extensions;
```

There is no `isExtension(value)` check and no duplicate-name check in that block. `src/extensions/entry-source.ts:53` then emits `registry.register(...(await extensionPlugins()));`.

The dev path avoids this only by filtering the inputs first: `src/cli/dev.ts:99` calls `loadProjectExtensions`, which runs `loadExtensions`; `src/extensions/load.ts:127-148` (`loadFile`) rejects "no default export", rejects a default export that fails `isExtension`, and catches a throw on import; `load.ts:63-84` refuses duplicate names. `src/cli/dev.ts:140` passes only `extensions.loaded`, so every file the generated dev entry imports is already valid.

The build path does none of that. `src/cli/build.ts:106-114` calls `resolveExtensionFiles` (which only resolves paths) and checks `exists(file)` — it never calls `loadExtensions`. Every resolved file, valid or not, goes into `wrapperSource` (`src/cli/build/wrapper.ts:31-35, 53-63`) and therefore into `extensionEntrySource`.

Reached by any of these in a project with `crust build`:

- `extensions/clock.ts` with no default export → generated code pushes `undefined`; `src/plugins/registry.ts:24` throws `register: not a plugin definition`.
- `export default definePlugin({ name: "clock", ... })` instead of `defineExtension` → `isExtension` is false, but the build ships it and `registry.register` accepts it; `src/runtime.ts:92-96` then registers it into a registry that also contains core plugins. A reserved name such as `fs` (which `definePlugin` permits) throws `plugin "fs" is already registered` at bridge creation.
- two files declaring the same extension name → `src/extensions/load.ts` would refuse both in dev, but the build embeds both and `src/plugins/registry.ts:27-32` throws `plugin "clock" is already registered`.

The generated `try/catch` covers import errors only; `registry.register` runs after it and outside it. `crust build` exits successfully in all three cases, and the compiled app throws before `startApp` finishes, so no window opens. Under `crust dev` the same files are reported with a file and a reason and the window keeps running. That is the exact dev/prod divergence the module doc at `src/extensions/project.ts:1-6` and the guide at `site/app/docs/guides/extensions/page.mdx:59` say cannot happen: "crust dev generates the same extension blocks ... so a project behaves the same either way." The blocks are the same; the inputs are not.

Worst because it is a silent fail-late: the command (build) that could have reported the defect succeeds, and the failure appears only when the recipient launches the binary, with no file name and no error about which extension was at fault.

## 2. MEDIUM — `discover` turns any directory error into "no extensions"

`src/extensions/load.ts:99-108` wraps the whole `readdir` in `catch { return [] }`. ENOENT, EACCES, EISDIR and a transient I/O error are indistinguishable from an absent directory.

Reached by `crust dev` or `crust build` on a project whose `extensions/` exists but is not readable (wrong ownership, a mounted path with a failed permission). Both commands print "none" and proceed; `src/cli/build.ts:115-120` logs no `"extensions"` line at all. The user sees an app whose commands answer `unknown-plugin` with no hint that a directory was skipped. The "absent directory is no extensions" test at `src/extensions/load.test.ts:136-142` pins only the benign case; there is no test that a non-ENOENT error is surfaced.

## 3. MEDIUM — a symlinked extension file is silently skipped by discovery

`src/extensions/load.ts:102` filters with `entry.isFile()`. With `withFileTypes: true`, a `Dirent` for a symbolic link reports `isFile() === false`, even when the link targets a regular `.ts` file.

Reached by a monorepo or shared-config project where `extensions/clock.ts` is a symlink into another checkout: discovery omits it, so `crust dev` loads nothing and `crust build` embeds nothing, with no error line. A named config entry (`src/extensions/load.ts:127-129`) would load the same file because `stat` follows symlinks, so discovery and explicit naming disagree on the same disk.

## 4. MEDIUM — an absolute config name never gains its `.ts`, unlike a bare name

`src/extensions/load.ts:119-125`:

```
if (isAbsolute(name)) return name;
...
return extname(path) === "" ? `${path}.ts` : path;
```

The `.ts` append happens only on the relative branches. An absolute entry `/abs/clock` is returned unchanged.

Reached by `extensions: ["/abs/clock"]` where `/abs/clock.ts` is the real file: `loadFile` reports `no such file` and `src/cli/build.ts:110-113` fails with `extensions entry /abs/clock does not exist`. The documented rule at `site/app/docs/guides/extensions/page.mdx:45` — "a bare name gets its `.ts` back" — is stated without qualification and covers absolute names too as written. Bare `clock` and absolute `/abs/clock` therefore behave differently for the same omission.

## 5. LOW — the brand is a process-global symbol and `isExtension` does not check shape

`src/extensions/define.ts:15` uses `Symbol.for("crust.extension")`, a key in the global symbol registry. `src/extensions/define.ts:49-54` (`isExtension`) checks only that property, not `name` or `commands`.

Reached by any code in the same realm that sets `[Symbol.for("crust.extension")] = true` on an object. `loadFile` (`src/extensions/load.ts:142-145`) then accepts it as valid, the dev registry passes it to `src/plugins/registry.ts:22-26`, and the crash moves from the loader to bridge creation. The global symbol is likely deliberate so two bundled copies of `define.ts` share the brand, but the consequence is that "a plain plugin can never be mistaken for one" (`define.ts:4-5`) holds by convention, not by construction.

## 6. LOW — the generated dynamic import uses a raw path where the loader uses a file URL

`src/extensions/entry-source.ts:34-36` emits `await import(JSON.stringify(path))` with an absolute filesystem path. `src/extensions/load.ts:135` imports the same kind of path through `pathToFileURL(file).href`.

Reached by a Windows build: `JSON.stringify("C:\\project\\extensions\\clock.ts")` puts backslashes into the generated specifier, which is then handed to dynamic `import` rather than a `file://` URL. The loader side already uses the URL form that handles drive letters and escapes, so the two import paths are not equivalent.

## 7. LOW — `renderExtensionImports`' comment describes a different generated form

`src/extensions/entry-source.ts:49-53` says "A default import already binds the module's default export", but the function emits a register call over the array filled by `extensionEntrySource`'s dynamic imports; there is no default import. Documentation only, but it is the comment a reader uses to reason about whether the default export was validated.
