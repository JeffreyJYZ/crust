# Defect hunt — 20 lanes, one field each

A hunt across the whole framework. Your prompt names **your field**; this file is the shared contract.

## What counts as a finding

A defect is a path from something that can actually happen to something that goes wrong. State the
path: what input, what state, what call order. **A hypothetical the code cannot reach is not a
finding** — a minified input the generator cannot emit, a config combination the validator refuses, a
state no code path produces. If you cannot say how it is reached, it is a note, not a finding.

Ranked by what it costs: data loss or a security hole first, then a wrong answer a user would notice,
then a crash, then a silent lie (a command answering success that did nothing), then a wart.

## What to look for, in general

Correctness against the platform's documented behaviour, unhandled error paths, resource leaks,
injection and traversal, unvalidated input crossing a trust boundary, `bun:ffi` declarations whose
arity or width drift from the C prototype, sync work on the event pump, unbounded growth, races
between a window closing and a callback, and anything that answers `ok: true` without doing the work.

## How to report

Write **one file**, the path your prompt names:

```
## <severity> — <one-line title>
- where: path:line
- mechanism: what happens, in one or two sentences
- reachable by: the concrete path from input or state to the defect
- smallest fix: one or two sentences
```

Order findings worst first. Then a final section:

```
## Checked and clean
- <area>: what you looked for and why it is fine
```

That section is not padding: it is the difference between "found nothing" and "looked". If you find
nothing, say so plainly and name the two or three things you checked hardest — a hunt that invents
problems to seem useful is worse than one that reports none.

## Rules

- **Report only. Do not edit any file** except the one you write. Other lanes are reading the same tree.
- `rg`/`fd`, never `grep`/`find`. `sd`, never `sed`. Never run `bun fmt`.
- **Never run an e2e suite, never launch a GUI app, never use `agent-desktop`, never move the cursor.**
  These take the screen; that is not yours to take.
- Bound anything that might hang with `timeout N`. Run builds and tests in the foreground.
- **Label every claim `measured` (you ran it) or `read` (you read the code).** Never present a read as
  a measurement, and never claim a Windows or Linux runtime observation — nothing here can run either.
- A test that passes is not proof a path is safe; say what the test would have to assert.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Final message

Under 10 lines: the count by severity, the single worst finding in one sentence, and the report path.
