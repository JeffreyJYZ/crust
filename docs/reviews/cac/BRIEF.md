# Replace the hand-rolled CLI parser with cac

The objective: **the crust CLI completely uses the `cac` CLI framework.** Today it is a 141-line
hand-written parser (`src/cli/parse.ts`), a hand-written help string (`src/cli/usage.ts`), and a
dispatch `switch` in `src/cli/index.ts`.

`cac@7.1.0` is on the registry: MIT, **zero dependencies**, 41 KB unpacked. It bundles into the
standalone binary like any other dependency.

Shared rules: one tree, `rg`/`fd`, foreground builds, 200-line cap (split, never trim), never
`bun fmt` without a path list, only your own files. Hand focus back with `probe-run -c '<command>'`.

## The behaviours that must survive

This is the contract. Every line is current behaviour, most of it pinned by `src/cli/parse.test.ts`
and `src/cli/first-run.test.ts`; read both before you start.

| argv | today |
| --- | --- |
| `--version`, `-v` | prints `VERSION`, exit **0** |
| `--help`, `-h` | prints help, exit **0** |
| no arguments | prints help, exit **1** |
| `crust nope` | `crust: unknown command "nope"` + hint, exit **1** |
| `crust nope --help` | still exit **1** — a typo plus `--help` must not read as success |
| `crust build --help` | only build's help, exit **0** |
| `--dir`, `--config`, `--entry`, `--format` | take a value; a following flag is not eaten as that value |
| missing value (`crust build --dir`) | `--dir needs a value`, exit **1** |
| unknown option (`crust build --wat`) | `unknown option --wat`, exit **1** |
| `crust init a b` | `unexpected argument b`, exit **1** |
| `crust init a --dir b` | `init takes one directory — pass <dir> or --dir, not both` |
| `crust init a --react --next` | refused, naming each scaffold |
| `--react`/`--next`/`--svelte`/`--vue` on a non-init command | `--react only applies to init`, exit **1** |
| `--format` on a non-package command | `--format only applies to package`, exit **1** |
| `--format` repeated | collects every value; parsed by `parseFormats` in `package/format.ts` |
| `crust dev app.tsx` / `crust build app.tsx` | the positional is the single-file app (`options.single`) |
| `crust init my-app` | the positional is the directory |
| `--help` or `--version` present | answers even when another flag would fail validation |
| a command that throws | `crust <command>: <message>`, exit 1, plus the `crust init` hint when the error is a missing config |

`CliOptions` (`src/cli/util.ts`) is what every command receives — `dir`, `config`, `entry`, `single`,
`formats`, the four scaffold booleans. Do not change that shape; commands depend on it.

## The hard part, stated plainly

cac's default `--help` handling **exits 0**, and it will print help for an argv whose command it does
not recognise. Two current behaviours fight that:

- `crust nope --help` must exit **1**.
- no arguments must exit **1** while still printing help.

So the design has to inspect cac's parse result before letting it answer. `cli.parse(argv, { run:
false })` returns without executing; `cli.matchedCommand` tells you what it matched. Work out the
exact sequence, and **write down what you measured** — do not assume cac's behaviour from its README.
If cac genuinely cannot express one of the rows above, say which and how you preserved it.

## Lane R1 — `pin-the-contract`

Before the refactor lands, pin the table above so the rewrite cannot quietly change it.

Add `src/cli/cli-contract.test.ts`: a data-driven test that spawns the **real entry point**
(`src/cli/index.ts`, the way `first-run.test.ts` already does) once per row and asserts exit code,
stdout and stderr. Cover every row of the table that can run without a project, a certificate or a
display: the help/version/unknown/missing-value/flag-scope rows, and the `init` refusals that fail
before touching disk. Leave out anything that builds, signs or opens a window.

Use a table, not 20 separate `test()` blocks, and name each row so a failure says which behaviour
moved.

Own: `src/cli/cli-contract.test.ts` only.

Prove: `bun test src/cli/cli-contract.test.ts` green against the **current** parser — that is the
point; it is the baseline the refactor must keep.

## Lane R2 — `cac-refactor`

Do the rewrite. Own: `src/cli/index.ts`, `src/cli/parse.ts` (delete), `src/cli/usage.ts` (delete),
`src/cli/parse.test.ts` (delete, superseded), `src/cli/commands.test.ts` (it asserts `USAGE` contains
every command — rewrite it against whatever now owns the command list), and `package.json`.

1. `bun add cac` — a **dependency**, not a devDependency: the standalone binary must carry it.
2. Build one cac instance in `src/cli/index.ts`: name, version, help, then one `.command()` per
   entry of `COMMANDS` with its options and a one-line description, and `.action()` calling the
   existing handler. The handlers do not change.
3. Keep the help **useful**, not just generated: cac's per-command descriptions and option
   descriptions must still tell a reader what `init`'s four scaffolds are and what
   `--format` accepts. The prose in today's `USAGE` is the content to preserve, redistributed.
4. Preserve every row of the contract table. Where cac needs help to get there (pre-parse
   inspection, `run: false`, custom error handling), say so in a comment with what you measured.
5. `crust doctor` and every handler signature stay as they are.

Prove, and paste the output:
- `bun test src/cli` green, including R1's contract file if it has landed.
- `bun run src/cli/index.ts --help`, `--version`, `nope`, `nope --help`, `build --help`, `build --dir`
  (missing value), `init a --react --next` — show exit codes.
- `bun check`, `bun run check:lines`.
- `bun run e2e:package` still 22/22 (wrapped in `probe-run`), because the standalone build embeds the
  dependency graph.

Final message under 12 lines: the cac sequence you used for the exit-code rows, anything cac could
not express, and the files deleted.
