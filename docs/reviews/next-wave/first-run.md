# Lane 6 — first run

Field: the experience of a person who has never seen crust — scaffold, install, run, build, hit an error.

Method: real probes in a temp dir, one scaffold per template, no network-free shortcuts. Commands:
`bun run src/cli/index.ts init <tmp>/<tpl> [--tpl]`;
`cd <app> && bun install`;
`cd <app> && timeout 12 bunx crust dev` (output captured to a transient `<tpl>.dev.log`);
`cd <app> && bunx crust build`.
Dev logs were deleted with their temp dirs, so the `dev log` line numbers below are from capture
and are not re-openable files.
Also probed wrong inputs (no args, unknown command, bad flag, two flags, existing dir, file as dir,
empty dir, no `node_modules`, single file) and `--help` on every subcommand. All temp dirs removed;
focus handed back with `open -a Ghostty`; no orphan `vite`/`next dev` processes left (`ps -Ao ... | rg`).
Only the two owned files were written; no source or template touched.

## Measured timings (wall seconds, this machine, 2026-11-18)

| template | init | install | dev startup | build | binary |
|---|---|---|---|---|---|
| vanilla | 0 | 0 (`link:`) | Vite n/a, window + greet | 0 | 86.19 MiB |
| react | 0 | 6 | Vite ready 1714 ms, window + greet | 0 | 86.42 MiB |
| next | 0 | 7 | Next ready 161 ms, self-restart, no greet in 12 s | 3 | 86.82 MiB |
| svelte | 0 | 6 | Vite ready 3139 ms, then crash | 0 | 86.24 MiB |
| vue | 0 | 8 | Vite ready 1515 ms, then crash | 1 | 87.55 MiB |

`crust build` exited 0 for all five and printed the honest Gatekeeper refusal line every time:
`gatekeeper refused on another machine until a Developer ID signature exists`.

## Ranked findings

### 1. Svelte and Vue: `crust dev` dies with `crust: document is not defined`, no window

- Command `cd <svelte|vue-app> && timeout 8 bunx crust dev` → after `frontend http://localhost:5173 answered` and a blank line, prints `crust: document is not defined` and stops; exit 124 is the timeout, but no `bridge`, `window` or `greet` line ever appears. Reproduced on both templates in two runs (12 s and 8 s): svelte dev log line 13, vue dev log line 11.
- The identical command on vanilla and react reaches `window main created`, `window open`, `greet hello … (page call answered)` (vanilla dev log lines 7-10, react dev log lines 14-17).
- `crust build` succeeds for svelte and vue, so the break is dev-only — a newcomer can build a bundle that they could never run in development.
- The `crust: ` prefix matches the runtime child's top-level handler `src/runtime.ts:195` (`console.error(\`crust: ${text}\`)`). The message carries no file, no cause and no next step; a first-timer cannot act on it.

### 2. Next template: first `crust dev` rewrites the scaffold and restarts the app

- Next dev log lines 17-24: `We detected TypeScript in your project and reconfigured your tsconfig.json file for you`, `allowJs was set to true`, `include was updated to add '.next/dev/types/**/*.ts'`, then `Generated AGENTS.md for AI agents. Set \`agentRules: false\` in next.config to disable.`
- Line 25: `restart   backend changed`; the window is torn down and rebuilt (`main number 11453` → `11459`, active space 0 → 1). No `greet … answered` within 12 s, unlike vanilla and react.
- The trigger is upstream Next inside `beforeDevCommand`, but `src/cli/dev/runtime.ts:112-127` treats those generated files as backend changes and restarts, rotating the bridge and reopening the window. A first run silently edits files the user did not author and reloads itself once.

### 3. `crust dev` / `crust build` in a project-less directory give no next step

- `bun run src/cli/index.ts dev --dir <empty>` → `crust dev: no crust config in <dir>: expected crust.config.ts or crust.json in the project root` (exit 1). `build --dir <empty>` is the same line with a `build` prefix.
- Contrast `crust doctor --dir <empty>`, which says `fix the key named above, run \`crust init\` for a new project, or use single-file mode (\`crust dev <file>\`, which needs no config)`. Same knowledge, actually useful to a stranger.
- A person who runs `crust build` one directory too high is told what is missing but not what to do about it.

### 4. `--help` is one global wall; no per-command help, and a typo with `--help` exits 0

- `crust init --help`, `dev --help`, `build --help`, `sign --help`, `dmg --help`, `package --help`, `notarize --help`, `doctor --help` all print the identical ~50-line `USAGE`; nothing is command-specific.
- `crust bogus --help` prints that same text and exits 0, so a mistyped command with `--help` looks like a success.
- Cause: `src/cli/parse.ts:33-35` decides help globally before command validation, and `src/cli/index.ts:20-22` short-circuits to `USAGE` with return 0. The reader must scan the whole wall for the one flag they need.

### 5. Minor: React dev greets twice; single-file "no config needed" still needs an install

- React dev log lines 17-18 print `greet hello react (page call answered)` twice in one startup. Cosmetic, but confusing as a readiness signal.
- `crust --help:15` says single-file mode needs `no config`; `crust dev <tmp>/solo.ts` with `import { app } from "crust"` and no `node_modules` → `Could not resolve: "crust". Maybe you need to "bun install"?` (exit 1). Honest error, but "no config" reads as "no setup".

## Already good — do not re-report

- Every error probed (unknown command, `--angular`, two template flags, `--bogus`, `--dir` without a value, `--format` outside `package`, `--react` outside `init`, non-empty dir, file as dir, both dir forms) is specific, names the bad token and exits 1.
- `crust doctor` on an empty directory is the model first-run diagnostic: each check names what it expected and how to fix it.
- `crust init` lists every created file and prints a copy-paste `cd / bun install / bunx crust dev` block, with an extra `bun run build` line for Vite and Next templates.
- No scaffold, install or build left stray artifacts; all five templates build to exactly one `.app` in `dist/`.

## Top three

- Svelte and Vue scaffolds cannot run under `crust dev` — they crash with `crust: document is not defined` while React and vanilla open a window.
- Next's first dev run rewrites the scaffold and self-restarts, so a newcomer sees an unexplained window reload and new files.
- Errors outside a project say what is missing but never point to `crust init`; `--help` is one global wall that exits 0 for a mistyped command.
