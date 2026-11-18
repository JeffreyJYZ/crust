# Prove the page follows the window on Windows arm64

A macOS defect just landed: the window resized and the page stayed frozen at its opening size,
because two fixed-size Auto Layout constraints pinned the webview. An audit read the Windows path
(`20_class.c` handles `WM_SIZE`, sizes from `GetClientRect`, `42_webview.c` no-ops an early size) and
called it correct — **but that verdict is read-from-code, never measured**, and this class of bug is
invisible unless something asserts the page's own viewport.

`.github/workflows/windows-arm-runtime.yml` is the only proof that runs on real Windows arm64. Today
it asserts two things: `window open` and the `greet` answer. It says nothing about size.

## What to do

Extend that workflow so it also asserts the **page** resized, not just the window.

1. Read the workflow and `templates/default/` first. The workflow scaffolds a fresh app with
   `crust init` and runs the built binary; its comment insists nothing is copied from `examples/`, so
   the scaffold stays the thing under test.
2. Add a resize step to the scaffolded app **in the workflow** (a small, clearly-labelled patch after
   `crust init`), because the default template must not grow a debug surface:
   - the page reports `window.innerWidth` and `window.innerHeight` through `invoke`;
   - the backend calls `window.setSize("main", …)` with a size clearly different from the opening
     one, and prints the viewport the page reported before and after.
   - **Resize smaller as well as larger** — a one-way constraint passes a one-way test.
3. Assert in PowerShell that both reported viewports changed to match, with a deadline like the
   existing loop, and that a mismatch throws naming the numbers (`viewport stayed 1100x760 while the
   window became 1400x900`). Then extend the final `PASS` line to say resize was proved too.
4. Keep the existing `window open` and `greet` assertions exactly as they are.

**You cannot run this workflow.** `windows-arm-runtime` is `workflow_dispatch` + `v*` tags, and the
runner is `windows-11-arm`. So: write it, prove it is syntactically valid, and say plainly that the
runtime verdict comes at the next tag.

## Prove, and paste the output

- The workflow parses: `ruby -ryaml -e 'YAML.load_file(".github/workflows/windows-arm-runtime.yml")'`
  and print what it says (an unquoted `:` in a step name has broken this file's class before, and
  GitHub then fails every run in 0 s with a workflow-file error).
- The patch text you add to the scaffold, quoted.
- `bun check`, `bun run check:lines` (the workflow is not TypeScript; these are for the repo).
- If you touch anything under `scripts/`, run `bun run test`.

## Own

`.github/workflows/windows-arm-runtime.yml` and, only if unavoidable, `scripts/**` for a helper.
Do **not** edit `templates/`, `src/platform/**`, or `scripts/window/**` — other lanes are in those.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt`.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Do not claim a Windows runtime result you did not observe.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

Final message under 10 lines: the assertions added, the YAML check result, and what the next tag will
prove that this release did not.
