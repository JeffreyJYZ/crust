# Doc addition: the `app:<name>` capability action

Same shared rules as `docs/reviews/fix-wave-2/BRIEF.md`. One tree, `rg`/`fd`, foreground builds,
200-line cap, never `bun fmt` without paths, quotes over numbers.

**Hand focus back when you finish.** If anything in your run launched or activated a GUI app, end with
`open -a Ghostty`.

## The change this documents

Lane L4 made page-called app commands checkable per command: `app.invoke` now gates on
`app:<command-name>`, with the flat `app:invoke` kept as a broad alias so existing apps and the
scaffolds keep working. The finest matching action is the one named in a refusal.

Read `src/bridge/server/actions.ts` (`effectiveAction`, `candidateActions`) and
`src/bridge/server/app-command-grants.test.ts` before writing a word — the doc must match what those
two do, including the wildcard caveat L4 recorded: `app:notes.*` matches every `app:notes.*` command,
so scoping to one command needs an exact action.

## What to add

1. `site/app/docs/guides/permissions/page.mdx` — a short section after the existing capability
   explanation: what `app:invoke` means now, how `app:<name>` narrows it, that `app:invoke` is still
   a broad alias, and the wildcard caveat above with a worked pair of grants showing
   `app:notes.save` allowed and `app:notes.delete` refused.
2. `site/app/docs/reference/config/page.mdx` — one row or sentence in the capability section stating
   the two forms and which wins.
3. If `templates/*/crust.config.ts` grant `app:invoke`, say in the guide that this is deliberate: a
   scaffold grants the broad form so a new app's own commands work without a second config edit.

Do not restate the whole permission model — link to the guide from the config page rather than
copying it. A second copy is a second thing to drift.

## Own

`site/app/docs/guides/permissions/page.mdx`, `site/app/docs/reference/config/page.mdx`. Nothing else.

## Prove

`bun run site:build`, `bun run check:links`, `bun run check:parity`, and the truth tests
(`rg -l truth src scripts`) still pass. Quote the command output.

## Final message

Under 8 lines. Bullets.
