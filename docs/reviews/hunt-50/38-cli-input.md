# Hunt 50 · 38 · CLI near-miss inputs

Scope: `src/cli/argv.ts`, `src/cli/commands.ts`, `src/cli/help.ts` (caller `src/cli/index.ts` read for reach).
Method: read the four files, then `bun` probe of `cli.parse` + `validate` + `translate` over 40 near-valid argv shapes. No source edits.

**Count: 5 findings** (1 high, 3 medium, 1 low). Worst is #1.

---

## 1. HIGH — `--` end-of-options tokens are silently dropped

`src/cli/argv.ts:16` lists bare `"--"` in `KNOWN`, so a `--` token passes validation. cac puts everything after it into `options["--"]`, not `parsed.args`. `translate` at `src/cli/argv.ts:36-39` reads only `positional` (= `parsed.args[0]`), and `validate` at `src/cli/argv.ts:59-60` counts only `parsed.args`. Nothing consumes `raw["--"]`.

Reached by:
- `crust dev -- foo.ts` → `parsed.args = []`, `raw["--"] = ["foo.ts"]`; `validate` returns OK, `translate` yields `{dir: cwd}` with no `single`. The named file is ignored; dev either runs project mode or reports "no crust config".
- `crust init -- my-app` → same shape; `dir` falls back to `process.cwd()` and scaffolding lands in the current directory instead of `my-app`.
- `crust init -- --react` → the literal directory name `--react` is dropped; help/validate never see `raw.react`, so it would scaffold into cwd.
- `crust doctor -- extra` / `crust package -- extra` → extra token accepted and ignored (the `positionals.length > allowed` check cannot see it).

Worst because it is silent: no error, valid-looking exit, and the user's target directory or entry file is replaced by cwd.

## 2. MEDIUM — repeated value flag becomes an array and is ignored, falling back to cwd

`src/cli/argv.ts:33-35` accepts `raw.dir`/`config`/`entry` only when `typeof === "string"`. `validate` at `src/cli/argv.ts:61-66` rejects a value flag only when its value is `true` or an array containing `true`; an array of strings passes. mri/cac collapses `--dir a --dir b` to `dir: ["a","b"]`.

Reached by `crust dev --dir a --dir b` (and the same with `--config` or `--entry`): validation is OK, `translate` returns `{dir: process.cwd()}` — both supplied values discarded. `crust dev --dir ""` likewise resolves to cwd. The repeat is a plausible user mistake and the fallback is invisible.

## 3. MEDIUM — help promises `--notarize` implies `--sign`; the build refuses it

`src/cli/help.ts:39` registers `notarize` as "notarize and staple the signed app **(implies --sign)**". Actual behavior at `src/cli/build/stages.ts:38-42` is the opposite: `notarize && !sign` is a hard refusal ("notarize requires --sign — an ad-hoc signature cannot be submitted"). `src/cli/help.ts:27` itself lists all three flags (`--sign --notarize --dmg`) as required, contradicting line 39.

Reached by `crust build --notarize`: `validate` (argv.ts:73-75) only checks that the flag applies to build, so it passes; the build then fails with the refusal. A user following the per-option help gets an error, not the implied signing.

## 4. MEDIUM — `--help`/`--version` detection is byte-exact and ignores cac parsing

`src/cli/index.ts:83-84` decides help/version by `argv.some(a => a === "--help" || a === "-h")` before cac parses. cac accepts `--help=true`, `--h`, `-h` grouped, and short/long `=` forms and normalizes them to `help:true`, but those argv tokens never equal the literal strings.

Reached by `crust dev --help=true` → cac sets `help:true`/`h:true`, `argv.some(...)` is false, `validate` (argv.ts:56-58, `KNOWN` has `help`/`h`) returns OK, and the `dev` command runs instead of printing help. Mirror case `crust dev --version=true` runs the command instead of printing the version. `argv.ts:20-23` is the vocabulary that makes these keys legal but unhandled.

## 5. LOW — `--help` after `--` is treated as a request for help

Same byte-exact scan (`src/cli/index.ts:83`) looks past the `--` boundary. `crust dev -- --help` puts `--help` in `raw["--"]` (a positional per cac), yet `help` is true and `main` prints help and exits 0. The literal argument is never available to the command. Same root cause as #1 but the visible symptom is help output rather than a dropped path.

---

## Notes / non-findings

- `commands.ts:24` uses `Object.hasOwn`, so `toString`/`__proto__` are correctly rejected (asserted at `commands.test.ts:18-23`). No near-miss command defect.
- Multiple scaffold flags (`crust init --react --next`) are rejected in `init.ts:70-73`, not a gap in `validate`.
- `parseFormats` (`package/format.ts:20-28`) rejects near-miss format strings (`DMG`, `dmg `) with a precise error; no defect there.
- `validate`'s unknown-option wording (`argv.ts:57`) prefixes single-char keys with `-` and longer ones with `--`, matching the old strings.
