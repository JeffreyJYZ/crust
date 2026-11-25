# Fix wave — shared contract (hunt-21)

Each lane owns the field named in its prompt, fixes **every** finding in that report, and carries the
test that would have caught it. Rule from the owner: after the hunt, fix all defects, not a shortlist.

## What a fix must contain

1. **A test that fails before the fix and passes after** — measured both ways, and say so in the PR.
   A defect fixed without a regression test is a defect that returns.
2. **The smallest change that removes the class**, not the reported instance. If two findings share a
   root cause, fix the root; if the report names one path into it, look for the sibling paths.
3. **No behaviour change to anything else.** If a fix needs a contract change (a new field on an
   answer, a new refusal code), update the docs and `site/public/SKILL.md` in the same commit —
   `bun run skill:check` fails otherwise.

## What a fix must not contain

- A defensive guard for a state the code cannot reach. A reviewer's hypothetical is not a finding.
- A rewrite of the surrounding code because the fix was easier that way.
- A new dependency. If one is genuinely required, stop and say why instead of adding it.

## Gate, before you report

```
bun check
bun run test
bun run check:lines
```

plus whichever e2e owns the path you touched (`bun run e2e:browser`, `e2e:preview`, `e2e:pty`,
`e2e:notes`, `e2e:fullscreen`, `e2e:single`, `e2e:dogear`). Never `bun fmt` without a path list.
Every file stays at or under 200 lines — split, never trim a comment that records a measured reason.

## Delivering

Commit on your branch, push with the bot remote, open the PR, and report: the PR number, the gate
numbers you saw, and one line per finding saying fixed or skipped-with-reason. Do not merge; the
owner's merge step follows the review.
