# CLI (`src/cli/`)

## Findings

### 1. Value-taking flags swallow the next flag as their value — MEDIUM
`src/cli/parse.ts:52-54`

`--dir`, `--config`, `--entry` and `--format` take `argv[++index]` with only an
`undefined` check; a following flag is consumed as the value. So `crust init --dir --help`
sets `dir` to the literal string `"--help"` (and `init` creates a directory with that
name), and `crust package --format --help` reports `unknown format "--help"` instead of
printing help. `--help`/`--version` after a value flag are silently lost.
**Breaks:** a forgotten value turns into a bogus path/format error or a stray directory,
and the documented `--help`/`--version` flags are ignored in that position.
**Evidence:** `const value = argv[++index]; if (value === undefined) return { ... error: \`${arg} needs a value\` };`
Probe: `parse(["init","--dir","--help"])` → `{command:"init", help:false, dir:"--help"}`.

### 2. `crust doctor` false-fails valid `.html`/`.ts`/`.js` single-file apps — MEDIUM
`src/cli/doctor/environment.ts:18,38,87,98`

Doctor's configless-single detection uses `PAGE_EXTENSIONS = new Set([".tsx", ".jsx"])`,
but single-file mode accepts `.tsx/.jsx/.ts/.js/.html` (`src/single-detect.ts:10-16`).
A directory holding only `app.html` (or `app.ts`/`app.js`) and no config is therefore
not recognised as a single-file app: doctor prints `config [fail]` and exits 1, and its
own hint says `crust dev <file.tsx>`, excluding the very extensions it rejects.
**Breaks:** `crust doctor` in a working single-page project reports a hard failure;
the exit code is wrong for a state `crust dev`/`build` support.
**Evidence:** `const PAGE_EXTENSIONS = new Set([".tsx", ".jsx"]);` vs
`SINGLE_EXTENSIONS: ReadonlySet<string> = new Set([".tsx",".jsx",".ts",".js",".html"])`.
Probe: a temp dir with only `app.html`, `crust doctor --dir <dir>` →
`config [fail] ...`, `2 checks failed`, exit 1. No test in `doctor/command.test.ts`
covers a non-`.tsx` single file.

### 3. `--help` omits `.html` from the supported single-file extensions — LOW
`src/cli/usage.ts:12`

The help text lists only `.tsx/.jsx/.ts/.js` as single-file inputs, but `.html` is a
supported input that bypasses the bundler (`src/single-build.ts:71-79`).
**Breaks:** users are not told that a plain HTML file can be opened with
`crust dev <file>`/`crust build <file>`.
**Evidence:** usage line: `with a .tsx/.jsx/.ts/.js file, run that one file as the app`;
detector: `".html"` is in `SINGLE_EXTENSIONS`.

### 4. `--entry` default in help names only one of two fallbacks — LOW
`src/cli/usage.ts:32`

Help says `--entry … (default: src/main.ts)`, but `resolveBackendEntry` tries
`src/main.ts` and then `main.ts`. A minimal app with `main.ts` at the project root
works while help claims it needs `src/main.ts`.
**Breaks:** misleading requirement in `--help` for the documented three-file app.
**Evidence:** usage: `(default: src/main.ts)`; `src/cli/util.ts:89-92` loops
`for (const candidate of ["src/main.ts", "main.ts"])`.

### 5. `--help`/`--version` do not short-circuit command-specific validation — LOW
`src/cli/parse.ts:99-119`, `src/cli/index.ts:11-23`

`parse()` validates `--react`/`--next`/`--format` against `command` before the caller
checks `help`/`version`. Combinations like `crust --help --react` or
`crust --version --format dmg` return an error, so `index` prints the error and exits 1
instead of printing help/version and exiting 0.
**Breaks:** the global help/version flags are overridden by unrelated flag validation.
**Evidence:** `parse(["--help","--react"])` → `{help:true, error:"--react only applies to init"}`;
`index` checks `parsed.error` before `parsed.version`/`parsed.help`.

## Coverage

Read in full: `index.ts`, `parse.ts`, `parse.test.ts`, `commands.ts`, `commands.test.ts`,
`usage.ts`, `util.ts`, `init.ts`, `dev.ts`, `build.ts`, `sign.ts`, `dmg.ts`, `package.ts`,
`package/format.ts`, `notarize.ts`, `doctor.ts`, `build/single-app.ts`, `dev/single.ts`,
`dev/runtime.ts`, `doctor/check.ts`, `doctor/environment.ts`, `doctor/command.test.ts`,
`doctor/fixtures.ts`, `single-app` build path, `framework.ts`. Confirmed underlying build
primitives (`packaging/build.ts`, `sign.ts`, `dmg.ts`, `nsis.ts`) throw on failure, so
the CLI's ignored return values there do not hide exit-1 cases. Probed `parse()` with
11 argv shapes and ran `crust doctor` against a scratch `.html`-only project.

Not inspected: the individual `doctor/*` checks beyond environment/bundle/command,
`build/resolve-assets.ts`, `ignore.ts`, assets/wrapper generators and their tests — those
are build- and doctor-internals rather than arg parsing, exit codes or help text. Next
would be a full matrix of `--config`/`--entry` interactions with `doctor` on single-file
projects, and an end-to-end exit-code table for every subcommand failure branch.
