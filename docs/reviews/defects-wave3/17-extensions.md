# Extensions (src/extensions/, native Zig/Rust/C path, e2e:native scripts)

## Findings

### 1. A broken extension embedded by `crust build` kills the app at startup — HIGH
`src/extensions/entry-source.ts:42`
`crust build` embeds every file `resolveExtensionFiles` returns after an existence check only (`src/cli/build.ts:97-100`); it never imports or validates them the way `crust dev` does (`src/cli/dev.ts:52-62`). The generated entry then `await`s every extension import at top level with no catch, so one throw rejects the whole entry before `startApp` runs.
**Breaks:** Build the `examples/native` project and the app dies before the bridge opens: a native extension's dylib is never in a standalone bundle (`examples/native/README.md:36-41`), so the `dlopen` at `src/packaging/extension-bindings.ts:142` throws during module evaluation, the generated entry's top-level await rejects, and the process exits. A syntax error or missing default export in any extension does the same. `crust dev` reports these and keeps running, so build and dev diverge — the exact split `src/extensions/project.ts:2-6` claims to prevent.
**Evidence:** `return "registry.register(...(await extensionPlugins()));";` — no `try`/`catch` around `await import(...)` at `entry-source.ts:30`; build only checks `if (!(await exists(file)))` at `build.ts:98`.

### 2. Dylib name and compile flags are hardcoded for macOS — HIGH
`src/packaging/extension-compile.ts:31`
`dylibName()` always appends `.dylib`, and the C command uses `clang -dynamiclib`, which is a macOS-only flag. The bindings generator's default is also `.dylib` (`src/packaging/extension-bindings.ts:131`). The docs present these as *the* command lines with no platform caveat (`site/app/docs/guides/native-extensions/page.mdx:17-19,25`).
**Breaks:** On Linux a `.c` native extension fails to compile (`-dynamiclib` is invalid; it should be `-shared`), and Zig/Rust sources emit `.dylib` instead of `.so`. On Windows the expected artifact is `.dll`. The generated module then `dlopen`s a `.dylib` path on all three platforms, so two of three are wrong by name as well as by flag. The docs' cross-platform claim and `crust doctor`'s per-platform toolchain report have no working native-extension target behind them.
**Evidence:** `return kind === "rust" ? \`lib${stem}.dylib\` : \`${stem}.dylib\`;` and `return { tool: "clang", argv: ["clang", "-dynamiclib", "-o", out, file] };`

### 3. `findTool` cannot find Windows executables — MEDIUM
`src/packaging/extension-tools.ts:34`
The PATH scan joins the bare tool name (`zig`, `rustc`, `clang`) onto each directory and checks it with `accessSync`. On Windows the installed names are `zig.exe`, `rustc.exe` and `clang.exe`; `fs.accessSync` does not apply PATHEXT extension resolution, so the check misses them.
**Breaks:** On Windows `crust doctor` reports every native toolchain missing and `compileExtension` returns `<tool> is not on PATH` for every source, even with all three compilers installed — native extensions are dead on that platform before any dylib is involved.
**Evidence:** `const candidate = join(dir, name);` followed by `accessSync(candidate, constants.X_OK);` — no `.exe` probe.

### 4. Compiled dylib is loaded with no ABI/version check and its symbols are cached once — MEDIUM
`src/packaging/extension-bindings.ts:142`
The generated module `dlopen`s whatever file sits at the path and binds the declared signatures to it; there is no ABI marker, version symbol or identity check. Each symbol is then resolved once at module evaluation into an exported `const`. A dylib replaced or rebuilt after that point leaves the running process holding the old `ffi.symbols` function.
**Breaks:** A stale or incompatible dylib binds silently to the generated declarations — a changed return type reads garbage or faults instead of failing the call. In `crust dev` the runtime restarts only on `.ts` edits in the extension directory (`src/cli/dev/runtime.ts:132-137`, `recursive: false`); a recompiled `native/*.zig` or replaced `extensions/generated/*.dylib` is not watched, so the old cached symbols stay live until an unrelated `.ts` edit restarts the child.
**Evidence:** `const ffi = dlopen(join(import.meta.dir, ${JSON.stringify(dylib)}), {` and `export const ${symbol.name} = ffi.symbols.${symbol.name} as ` — no version field or check in the generated module.

### 5. Duplicate-extension comment promises both are refused; only the second is — LOW
`src/extensions/load.ts:4`
The module doc says two extensions claiming one name "are refused together", but the loader keeps the first and only records an error for the second.
**Breaks:** A user who reads the contract expects neither extension to load; in fact one namespace is silently served, which is the shadowing the comment says is prevented. The test pins the opposite behavior.
**Evidence:** comment "two extensions claiming one name are refused together" vs `extensions.push(outcome);` at `load.ts:68` and `expect(extensions.map((extension) => extension.name)).toEqual(["clock"]);` at `src/extensions/load.test.ts:82`.

### 6. e2e-native passes a host path unescaped into a `pgrep -f` regex — LOW
`scripts/e2e-native.ts:35`
`CONFIG` is an absolute path handed to `clearSurvivors`/`survivorsOf`, which forward it to `pgrep -f` as an extended regular expression with no escaping.
**Breaks:** A repo path containing regex metacharacters (`.`, `(`, `[`, `+`) over-matches or misses — cleanup can `SIGKILL` unrelated processes and the survivor check can report false positives. The path used here already contains dots (`/Users/jyz/dev/crust/examples/native/crust.config.ts`), so it matches more than the one file.
**Evidence:** `const SURVIVOR_PATTERNS = [CONFIG, "dev --dir examples/native"];` reaches `runCommand(["pgrep", "-f", pattern], process.cwd())` at `scripts/harness/process.ts:11`.

### 7. The C/clang compile path is never exercised by a real compiler — LOW
`src/packaging/extension-compile.test.ts:126`
The "with the real toolchain" block lists only `zig` and `rustc`. The clang command's argv is asserted against a recorder (`extension-compile.test.ts:79`), but no test ever runs `clang -dynamiclib` and then `dlopen`s the result.
**Breaks:** A wrong or unbuildable C command passes the suite. This is the path finding 2 flags as invalid on Linux, and nothing in CI would catch it.
**Evidence:** `const REAL = [` with entries `tool: "zig",` and `tool: "rustc",` only; no `clang` entry before `] as const;`.

## Coverage
Read in full: every `src/extensions/*.ts` (definition, loader, project bridge, generated-entry source, all four test files); every `src/packaging/extension-*.ts` (bindings, compile, discover, doctor, tools, barrel) and their five test files; `src/packaging/exec.ts`; `scripts/native-extensions.ts`; `scripts/e2e-native.ts`; `scripts/harness/process.ts`; the `examples/native` sources, generated bindings, config and README; the native-extensions docs page. Traced callers in `src/cli/build.ts`, `src/cli/dev.ts`, `src/cli/dev/entry.ts`, `src/cli/dev/runtime.ts`, `src/cli/build/wrapper.ts`, `src/cli/doctor/extensions.ts`, `src/plugins/registry.ts`, `src/bridge/server/invoke.ts` and `src/runtime.ts` to establish reachability.

Confirmed by probe: zig is installed here and `zig build-lib -femit-bin=<out>` did not write a cache dir into the temp CWD, so I did **not** report a "build emits into the source tree" defect — the generated dir in `scripts/native-extensions.ts` is declared build output and discovery is non-recursive. The committed dylibs are arm64 Mach-O; a rebuild via `build:native` replaces them, so arch mismatch alone was not reported. I did not run the full gate, `bun fmt`, or any build, per the brief. Next I would check `src/cli/doctor/build-assets.ts` and the packaging sign/notarize path for other host-path-into-command flows, and the platform shims' own `dlopen` handling for the same ABI-version gap.
