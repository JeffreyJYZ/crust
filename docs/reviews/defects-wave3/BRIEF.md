# Defect hunt, wave 3 — shared brief

You are one of 20 parallel hunters in `/Users/jyz/dev/crust`: a Bun-native desktop app
framework in TypeScript, no Rust, system WebView, platforms darwin / linux / windows.

Your own area and your own report path are in your task message. Read this file once, then work
only your area.

## Write the report first

Create your report file immediately with a title and a one-line "area" header, then append findings
as you find them. Your turn can be cut at any moment; a report that exists only in your final
message is lost.

Shape:

```
# <area>

## Findings

### 1. <short title> — HIGH
`path/file.ts:123`
What is wrong, in one or two sentences.
**Breaks:** what a user sees.
**Evidence:** the shortest decisive quote from the source.

## Coverage
What you read, what you did not, and what you would look at next.
```

Order by severity. No file:line, no finding — drop it.

## House rules, non-negotiable

- `rg`, never `grep`. `fd`, never `find`. `sd`, never `sed`. Always pass a path to `ls` (the shell
  `ls` is eza and prints nothing without one).
- **READ ONLY on source.** The single file you may write is your report. Do not edit, create or
  delete anything under `src/`, `scripts/`, `templates/`, `examples/`, `site/`, or any package file.
- Never run `bun fmt`. Never run the full test suite, `bun check`, or a build — another agent is
  working in this tree. `bun test <one test file>` is fine when a single test is decisive.
- Never use `agent-desktop`. Never move the mouse or synthesize input.
- Do not read another hunter's report. Nineteen others cover other areas; stay in yours.
- Do not stop early because you found something good. Keep going until your area is covered.

## What counts as a defect, in priority order

1. A bug producing a wrong result, a crash, or a hang at runtime, reachable by ordinary use.
2. A claim in code or docs the code does not do: a docstring that lies, a test that asserts the
   opposite of its name, a documented flag that does not exist.
3. A trap: an ordering requirement nothing enforces, an unchecked return, a silent failure that
   reads as success to the caller.
4. Dead code, a second implementation of something that already exists, an export nothing calls.
5. A gate hole: a test that cannot fail, an assertion that is always true, a path the suite never
   exercises.

## Not defects — do not report

- Style, naming, formatting, "consider adding a comment".
- A hypothetical state the code cannot reach. Say how it is reached, or drop it.
- A missing feature nobody asked for.
- Anything you did not open the source to confirm.
- A test that is slow but correct.

## Repo facts that save you time

- The gate is `bun check && bun run test && bun run e2e && bun run check:lines`.
- Every file is capped at 200 lines, tests included, enforced by `bun run check:lines`.
- `src/` holds the framework; `scripts/` the probes and release tooling; `templates/` the scaffolds
  `crust init` writes; `site/` the Next.js docs site; `examples/` the samples.
- Platform code is one barrel per OS: `src/platform/{darwin,linux,windows}/`.
- Plugins are `src/plugins/<name>.ts` behind `src/plugins/index.ts` and a barrel.
- Known and already fixed — do not re-report as new: the Windows `__chkstk` frame trap (any local
  array of 4096 bytes or more), the `CoInitializeEx` i64/i32 width, and the `win32` vs `windows`
  target-key mapping in `scripts/release/targets.ts`.
