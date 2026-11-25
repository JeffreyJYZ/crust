# Hunt 22 — CLI (`src/cli`: init, build, dev, package, argv)

Read-only review. No source files changed. Findings are reachable states, not hypotheticals.

## New findings

### 1. Medium — `crust init` silently corrupts generated files when the target directory name contains `$`

- where: `src/cli/init.ts:118-133` (token values) and `src/cli/init.ts:179-186` (`applyTokens`).
- mechanism: `applyTokens` calls `text.replaceAll(token, value)` with a **string** replacement. JavaScript replacement strings interpret `$&`, `$'`, `` $` ``, `$1`, etc. The `{{name_text}}` value comes from `JSON.stringify(name).slice(1, -1)` and `{{name_html}}` from entity escaping, so neither neutralises `$`. A directory name containing `$&` inserts the matched token back into the text; a name containing `$'` inserts everything after the match; `` $` `` inserts everything before it. `init` still returns 0 and prints a normal `created` list, so the user gets a scaffold whose `crust.config.ts` and HTML are malformed or contain raw template tokens. `{{package}}` is safe because `packageName` maps `$` to `-`, but the human-facing name fields are not.
- reachable by: measured. Ran `init` directly against three scratch directory names in a temp dir, then read back `crust.config.ts`:
  - `my$app` → `name: "my$app"` (no `$` replacement pattern, so fine).
  - `my$&app` → `name: "my{{name_text}}app"` — the `$&` expanded to the matched token.
  - `a$'b` → `name: "a"` followed by the rest of the template file spliced in — the `$'` expanded to the suffix of the string.
- evidence: probe script at `/private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode/init-probe.ts`, run with `bun <path>` from the repo root; output line for the second case: `{"name":"my$&app","code":0,"config":"\tapp: { id: \"app.crust.my-app\", name: \"my{{name_text}}app\", version: \"0.1.0\" },"}`. Isolated JS check: `"a {{name_text}} b".replaceAll("{{name_text}}", "my$&app")` → `"a my{{name_text}}app b"`. Token substitution also runs sequentially, so a directory literally named `{{package}}` would be rewritten again by a later token; same root cause.
- smallest fix: use a replacer function, e.g. `text.replaceAll(token, () => value)`, in `applyTokens`. Optionally add a test with a `$&` and a `$'` directory name asserting the generated config still parses and contains no `{{`.

### 2. Low — `perf` is a working CLI command but is absent from global `--help`

- where: `src/cli/index.ts:83-86` (perf bypasses cac), `src/cli/index.ts:60-75` (only `COMMANDS` are registered), `src/cli/help.ts:24-30` (`COMMAND_DESCRIPTIONS` has no `perf`).
- mechanism: `main` dispatches `argv[0] === "perf"` to `runPerf` before cac sees it. `crust perf --help` prints two usage lines, so the command exists and is supported, but `crust --help` lists only `init`, `dev`, `build`, `package`, `doctor` and its closing hint says "run any command with the `--help` flag" without mentioning perf. A user who does not already know the command cannot discover it from the CLI.
- reachable by: measured — `bun src/cli/index.ts --help` lists five commands, no `perf`; `bun src/cli/index.ts perf --help` prints `crust perf record ...` and `crust perf diff ...`, exit 0.
- evidence: those two commands and their stdout.
- smallest fix: add a `perf` row to help output (a literal example line or an entry in a help-only command list) while keeping perf out of `COMMANDS`, since it owns its own argv.

### 3. Low — dev-server timeout tells the user to read a `beforeDevCommand` output that was never produced

- where: `src/cli/dev.ts:121-138` and `src/cli/dev.ts:159-168`.
- mechanism: the readiness failure message always ends with "Check the beforeDevCommand output above". When `config.dev.url` is set but `config.dev.beforeDevCommand` is not, no `before` line and no child output exist; the user is sent looking for output that was never printed. This is a normal supported config shape (an already-running external dev server), so the 30 s wait can end in a misleading instruction.
- reachable by: read — `frontend` stays undefined without `beforeDevCommand`, and the failure branch does not test that before naming its output.
- evidence: `src/cli/dev.ts:123` (`if (beforeDevCommand)`) and `src/cli/dev.ts:165-167` (the fixed hint text).
- smallest fix: pick the hint from the config — name `beforeDevCommand` only when it was set, otherwise say the URL did not answer and name the configured URL.

## Still live from hunt-20 (re-verified, not new)

These were reported in `docs/reviews/hunt-20/11-cli.md`; current `main` still has them. Recorded here so the coordinator knows they were checked, not re-derived as new work.

- **Value flags coerced by cac/mri are dropped.** Probe: `cli.parse([...,"dev","--dir","123"])` → `dir: 123`; `translate("dev", undefined, {dir:123})` → `{dir: process.cwd()}`; `validate` → `undefined`. Repeated `--dir a --dir b` → `["a","b"]`, same silent fallback. `src/cli/argv.ts:62,102-107`.
- **`--` separator discards the single-file positional.** Probe: `cli.parse([...,"dev","--","app.tsx"])` → `args: []`, `options: {"--":["app.tsx"]}`; `translate` sees no `single`. `src/cli/argv.ts:28,65-68,87`.
- **Unknown command plus `--version` exits 0.** `bun src/cli/index.ts nope --version` → `0.2.18`, `exit=0`; the version branch at `src/cli/index.ts:94-97` returns before the `isCommand` guard at line 109.
- **Svelte/Vue component edits restart the backend.** `isFrontendSource("App.svelte")` and `isFrontendSource("App.vue")` both return `false` while `.tsx` returns `true`; `src/cli/ignore.ts:30`.

## Checked and clean

- `stageRefusal` order (`src/cli/build/stages.ts:35-63`): platform and credential checks run before any build step; `--notarize` without `--sign`, `--sign`/`--dmg` off darwin, and missing identity or notary credentials are all refused by name. Single-file builds go through the same gate at `src/cli/build.ts:41`.
- `package` format handling (`src/cli/package/format.ts`, `src/cli/package.ts:92-98`): bad values are refused before builders run, repeats dedup, a failed format sets exit 1 without stopping the remaining formats.
- `findBuildArtifact` (`src/cli/util.ts:175-190`): exact app-name lookup on darwin, flat binary elsewhere, so a stale bundle of another name cannot satisfy `package`.
- `init` overwrite safety (`src/cli/init.ts:89-105`): a non-directory target and a non-empty directory (other than `.DS_Store`) stop before any write; two scaffolds are refused with both names.
- `waitForDevServer` (`src/cli/dev/frontend.ts:33-59`): bounded 30 s TCP poll, no unbounded wait; its false-positive risk (any listener counts as ready) is a documented trade-off, not a new defect.
