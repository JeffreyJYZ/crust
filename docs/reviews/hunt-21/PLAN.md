# hunt-21 → fix wave

Rule from the owner (2026-11-21): after every hunt lane reports, fix **all** defects found, not a
shortlist. Nothing here starts until the 20 reports are in and the synthesis has ranked them.

## Order

1. Synthesis: dedupe across fields, drop anything a hunter could not reach, rank
   security/data-loss → wrong answer → crash → silent lie → wart. One row per defect with its
   report path and its `where:` line.
2. Fix wave, highest severity first. A lane owns a **directory**, not a file list, and may add as
   many files as the work needs.
3. Each fix ships with the test that fails before it and passes after — a defect fixed without a
   regression test is a defect that returns.
4. Gate on the merged tree: `bun check`, `bun run test`, `bun run check:lines`, plus the e2e that
   owns the touched path. A red gate is not a landed fix.
5. One PR per lane, `pr-land` on green, then a single `main` CI watch with its URL.

## Not in scope

- A finding whose only evidence is a hypothetical the code cannot reach — it stays a note in the
  report, not a fix.
- Anything a hunt-20 report already logged as fixed and a re-read confirms fixed.
- New features. This wave closes defects; it does not add surface.
