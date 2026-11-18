# Finish the cac move: let cac print the help

The refactor landed: cac owns argv parsing, option typing and the command list, `parse.ts` and
`usage.ts` are gone, and the contract holds — `--version` bare, no-args exit 1, `nope --help` exit 1,
`build --dir` names the missing value, `build --wat` names the option. 1900 tests pass.

What is **not** cac's yet is the help output. `src/cli/help.ts` still hand-writes a 50-line `USAGE`
block and `commandHelp()` slices it, so there are two descriptions of every command: the one-line
descriptions registered with cac (`COMMAND_DESCRIPTIONS`, used only for `cli.command(...)`) and the
prose block actually printed. Those can drift, and the objective is "completely use cac".

cac can print both help screens itself — measured from `node_modules/cac/dist/index.d.ts`:

```
line 78   Command#outputHelp(): void      // one command's help
line 170  CAC#outputHelp(): void          // the whole CLI
line 163  CAC#example(example)            // appended to the global help
line  56  Command#example(example)        // appended to one command's help
```

None of them exits, so the exit-code rules stay yours.

## What to do

1. **Global help** — print `cli.outputHelp()`. Move the content that matters out of the hand-written
   block and into what cac renders:
   - `TAGLINE` stays as the first line (cac prints `name/version` above; decide whether to keep that
     and say why).
   - The notarize credentials paragraph and the published-limits paragraph become `cli.example(...)`
     blocks, so they still appear.
   - The per-scaffold breakdown (`--react: React + Vite`, …) moves into the four option descriptions
     already in `OPTION_DESCRIPTIONS`, which cac renders.
2. **Per-command help** — print the matched command's `outputHelp()`. cac renders its usage line,
   its options and its description from what `index.ts` already registers.
3. **Delete** `USAGE` and `commandHelp` from `help.ts`, leaving only the description tables. If the
   file becomes trivial, say so and fold the tables into `index.ts` instead of keeping a file for
   two objects — but only if `index.ts` stays under 200 lines.
4. **Keep every contract row.** `src/cli/cli-contract.test.ts` is the acceptance test: 28 rows,
   spawn-tested. It asserts substrings (`stdout contains …`), so cac's layout is fine, but rows like
   "no args prints help and exits 1" and "`nope --help` exits 1" must still hold. Run it.
5. **Check the docs still describe what they show.** `site/app/docs/reference/cli/page.mdx` and
   `site/public/SKILL.md` quote the CLI's commands; if the help's wording changes materially, those
   are yours to correct — but do not touch `SKILL.md`'s generated region
   (`<!-- skill:commands:begin -->` … `end`), which `bun run skill:check` owns.

## Prove, and paste the output

- `bun run src/cli/index.ts --help` — the whole screen, showing the examples block.
- `bun run src/cli/index.ts init --help` — one command's screen.
- `bun run src/cli/index.ts --version`, with no args, `nope --help`, `build --dir`, `build --wat` —
  exit codes, unchanged.
- `bun test src/cli` green, including the 28 contract rows.
- `bun check`, `bun run check:lines`, `bun run check:links`, `bun run skill:check`.

## Own

`src/cli/help.ts`, `src/cli/index.ts`, and — only if the wording changes — `reference/cli/page.mdx`
and `SKILL.md` prose outside the generated markers.

Final message under 12 lines: what cac now prints, what you deleted, and the five exit codes.
