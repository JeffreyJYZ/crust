# Fix wave — shared brief

You are one of 13 lanes fixing defects already found and written down in
`docs/reviews/defects-wave3/`. Your task message names **your report file** and **the files you own**.
Everything else in that directory is another lane's — do not touch them, do not read them unless your
own findings need the reference.

## Your job

Read your report. Fix every finding in it, in the source. Then write a test that fails without your
fix and passes with it — a finding whose fix has no test is half done, and the next wave re-finds it.

If a finding is wrong, say so in `docs/agents/<lane>.md` with the evidence and **do not change the
code**. A wrong report is worth more corrected than obeyed.

## File ownership, non-negotiable

- **You may write only the files your task message lists**, their tests, and
  `docs/agents/<lane>.md`.
- **Never edit a file another lane owns.** If your fix needs it, say so in your final message instead.
- **Never edit `AGENTS.md`, `CHANGELOG.md`, `package.json`, or anything under `site/` unless your list
  says so.**
- **Never run `bun fmt` without an explicit path list** — it rewrites every file it can reach,
  including twelve other lanes' work in progress. `bun fmt <your files>` only.
- Do not revert, reformat or "tidy" anything you did not change.

## Checks to run before you report

```sh
bun check                                        # type-check, must be clean
bun test <your own test files>                   # must pass
bun fmt <the files you changed>                  # formatting
bun run check:lines                              # 200-line cap; split, never trim
```

`bun run check` covers the whole tree, so a type error in another lane's half-finished file is not
yours to fix — name it and move on. `bun test` on your own files is the proof you must show.

**Do not run the full suite, `bun run e2e`, or a build** — twelve lanes are writing at once and a
whole-tree gate is the coordinator's job at the end.

**Every file stays at or under 200 lines.** When a fix pushes a file over, split it by
responsibility; never delete a comment that records a measured reason.

## House rules

- `rg`, never `grep`. `fd`, never `find`. `sd`, never `sed`. Always pass a path to `ls`.
- Never use `agent-desktop`, never move the mouse, never synthesize input.
- Never run `bun fmt` bare. Never touch another lane's processes or `agent-browser` sessions.
- A launch or GUI probe that steals focus must hand it back with `open -a Ghostty`.

## Reporting back

One message, no preamble:

- **fixed** — file:line → what changed, for each finding
- **tests added** — the file and the case
- **not fixed** — the finding, the reason, whose file it belongs to
- **do not stop early.** If you finish your list, re-read your report and check each fix actually
  holds; a fix that compiles but does not change behaviour is not done.

Record anything durable (a trap, a measurement, a decision) in `docs/agents/<lane>.md` before you
report, because the next lane starts from those files and cannot see this conversation.
