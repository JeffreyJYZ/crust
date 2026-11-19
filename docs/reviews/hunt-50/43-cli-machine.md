# Hunt 50 · 43 · CLI machine assumptions

Scope: `src/cli/util.ts` (+ `util.test.ts`, `util-resolver.test.ts`), `src/cli/first-run.test.ts`, and `src/cli/` template code (`init.ts`, `assets.ts`, `package/options.ts`, `build/wrapper.ts`). Callers read for reach only.

Method: read the files, then `rg` over `src/cli` for `process.platform`/`sh`/`cwd`/`node_modules`/hard-coded paths and their call sites. No source edits, no probes that touch the screen.

**Count: 5 findings (2 high, 2 medium, 1 low). Worst is #1.**

---

## 1. HIGH (worst) — `missingInstall` assumes a local `node_modules`; a hoisted workspace install is reported as missing and aborts dev/build

`src/cli/util.ts:192` treats "declared deps in `package.json` and no `node_modules` *in the project dir*" as the only possible installed state:

```
if (await exists(join(dir, "node_modules"), "dir")) return undefined;
```

Reached by:

- `crust dev` with a `dev.beforeDevCommand` → `src/cli/dev.ts:117-118` calls `missingInstall(projectDir)` and `return fail(...)` on any message.
- `crust build` → `src/cli/build.ts:57-58` does the same, unconditionally.

In a Bun/pnpm workspace the dependencies are hoisted to the workspace root, so a member project has no local `node_modules` while its packages resolve correctly from the ancestor. Both commands then abort with "node_modules is missing in `<dir>` — run `bun install` first", even though `bun install` has already been run and would not create a local `node_modules` under the workspace linker. The check also has no notion of `nodeLinker: isolated`/global-cache installs where no `node_modules` directory exists at all.

Worst because it is a false *fatal* on a valid setup, on every platform, and the message points at the wrong remedy. The two unit tests (`util.test.ts:16-36`) only model a bare directory or a local `node_modules`, so the hoisted case is invisible.

## 2. HIGH — `runShell` hard-codes `sh -c`

`src/cli/util.ts:71-78` builds every command with `cmd: ["sh", "-c", command]`, and the same literal is duplicated in `src/cli/dev.ts:122-127` for `beforeDevCommand`.

Reached by `crust build` with `build.beforeBuildCommand` → `src/cli/build/resolve-assets.ts:27-31` → `runShell`. On Windows `sh` is not on `PATH`, so `Bun.spawn` throws `Could not spawn sh: ENOENT`; `resolveAssets` has no try/catch and the build aborts with a raw spawn error attributed to crust. Even where a POSIX `sh` exists, the command string is interpreted by POSIX `sh` regardless of the machine's shell, so Windows-flavoured commands (`&&`, `%VAR%`, `cmd /c` syntax) are not portable. Windows is a supported artefact target (`package/options.ts:57-67` builds NSIS, `findBuildArtifact` handles `win32`), so this is a host gap, not a hypothetical. No `SHELL` or platform branch exists.

## 3. MEDIUM — `crust init` prints an unquoted `cd <absolute path>`

`src/cli/init.ts:138` emits the next-steps block with `cd ${target}`, where `target = resolve(options.dir)` (`init.ts:75`) is an unquoted absolute path.

Reached by `crust init "My App"` (or any path whose segments contain spaces, e.g. `~/Documents/My Apps/demo`): the command just created that directory, then prints `cd /Users/…/My App/demo`, which fails in a shell as three arguments. `bun install` and `bunx crust dev` that follow are unusable until the user fixes the line by hand. The same assumption shows up in the hint strings (`init.ts:42-50`) and in `resolve-assets.ts:16-17`, all of which embed shell snippets with no quoting.

## 4. MEDIUM/LOW — `findRoot` identifies the crust root by an ancestor literally named `templates`

`src/cli/util.ts:11-22` walks at most six ancestors of `import.meta.dir` and returns the first directory containing a `templates` entry; otherwise it falls back to `resolve(start, "..", "..")` (line 19). `crustRoot` is then used by `init.ts:101,121`, `assets.ts:59,76`, `framework.ts:43` and the doctor checks.

Reached when crust is installed without its own `templates/` directory (the case `init.ts:97-103` explicitly reports) under a path that itself has a `templates` component — e.g. a checkout at `/home/me/templates/crust` whose `templates/` was stripped. The walk stops at `/home/me/templates` and returns it as the root; `init` then looks for `<wrong>/templates/default`, and the doctor reports template paths that do not exist. The six-level bound and the `..`, `..` fallback likewise assume a checkout/embedded layout rather than discovering the root from a marker that cannot collide.

## 5. LOW — init's "empty directory" test knows only macOS's `.DS_Store`

`src/cli/init.ts:83` filters exactly one name:

```
const entries = (await readdir(target)).filter((name) => name !== ".DS_Store");
```

Reached by `crust init <dir>` on Windows or Linux where the directory holds `Thumbs.db`, `desktop.ini`, or a `.Spotlight-V100`/`.fseventsd` leftover: the directory is judged non-empty and `init` refuses it, even though nothing of the user's would be overwritten by those files. The inverse assumption (that `.DS_Store` is the only ignorable artifact) is machine-specific.

---

## Notes / non-findings

- `src/cli/first-run.test.ts` has no machine-assumption defect: it spawns via absolute `process.execPath`, uses `tmpdir()` for scratch, and `config/load.ts:55-61` does not walk ancestors, so a stray config above the temp dir cannot make the configless cases flaky.
- `findBuildArtifact` (`util.ts:155-170`) uses a consistent `crust-app` name and handles `win32` `.exe`; the compile callers pass the same `BINARY_NAME` (`build.ts:140`, `package/options.ts:16`). No mismatch.
- `dev/interpreter.ts:15-23` deliberately probes `Bun.which("bun")` and falls back to `BUN_BE_BUN=1 <executable>`, so the compiled-executable case is handled; no defect.
- `init.ts:158-166` normalises Windows backslashes for the `link:` spec and falls back to an unpinned `github:` ref for dev versions. That assumes git/network for a release install, which is inherent to the chosen dependency spec, not a bug.
