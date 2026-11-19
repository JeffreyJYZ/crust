# Docs coverage: three measured holes

Measured on `865d79b` by enumerating the live registry and scanning `site/app/docs/**/*.mdx`.

```
registry      32 namespaces · 184 commands          all names appear in docs
api sections  28 of 32 have their own section under reference/api*
CLI           5 commands                            all documented
config        10 root keys                          all on reference/config
```

## Hole 1 — `screen` has no reference anywhere

`screen` registers `list` and `primary`. Neither has a section, a guide, or a stated arg/answer
shape; the only mentions are passing references inside the window, tray and opener guides.

Give it a real section: args, answers and the failure codes, in the `reference/api*` page a reader
would look in — judge by that page's existing headings rather than by guesswork, and cross-link from
the positioner material if `screen` is what you use to decide where to put a window.

## Hole 2 — `site/public/SKILL.md:275` promises a shape the site does not have

It says `/docs/reference/api` is "one page per namespace". There are eight grouped pages:
`api`, `api-app`, `api-desktop`, `api-fs`, `api-ui`, `api-updater`, `api-web`, `api-window`.

Correct the sentence to the real shape. Do not touch the generated `skill:commands` region — only
prose outside the markers.

## Hole 3 — nothing checks per-command semantics

`scripts/docs-reference.test.ts` pins spot facts: `notification.notify` exists, `WINDOW_COMMANDS.length`
appears, `app.run()` not `app.start()`. No test compares a documented arg shape to the implementation,
so a table row can be wrong while every gate is green.

Close it with a namespace-level check in that file, following its existing rule that every assertion
maps to a written defect: **every registered namespace must have a reference heading under
`reference/api*`, or a guide whose heading names it.** The failure message lists the uncovered
namespaces, so the next gap names itself instead of waiting for a person to notice.

Do not attempt an args-level checker as part of this — that is a larger design question. Record it in
the test's comment as the known remaining hole, in one sentence.

## Rules

`rg`/`fd`, never `grep`/`find`; `sd`, never `sed`; never `bun fmt` without a path list; 200-line cap;
no `src/**` changes.

Own: `site/app/docs/**`, `site/public/SKILL.md` (prose only), `scripts/docs-reference.test.ts`.

Prove, pasted: `bun run site:build`, `bun run check:links`, `bun run check:parity`,
`bun run skill:check`, `bun run test`, `bun check`, `bun run check:lines`, plus the namespace count
before and after your new test exists, and that the new test fails when you temporarily delete a
section heading (restore it after).
