# The docs claim more than the code does

Three changes just landed that the docs do not reflect, and one claim that is now wrong:

1. **macOS resizes properly again.** The webview is four edge pins with no size of its own; a fixed
   width/height pair used to pin the page to the size the window opened at, which is why "apps can't
   be resized" looked true. Worth stating where the design talks about layout, because the reason is
   subtle and someone will "simplify" it back.
2. **`e2e:window` asserts the page's viewport**, both larger and smaller. If a page follows the window
   on one axis only, that is now a gate failure rather than a discovery.
3. **Windows arm64 has a runtime proof that includes resize.** The workflow patches the scaffold so
   the page reports its own viewport and the backend resizes the real HWND; it is `workflow_dispatch`
   + `v*` tags, so it runs at a tag.
4. **The design page's claim that `setFrame:` appears nowhere was already false** and has been
   corrected in `site/app/docs/design/page.mdx` — `window.setSize` and `window.setPosition` reach it
   inside the shim. Check no other page repeats the old claim.

## What to do

Read the relevant pages and correct what is wrong or missing:

- `site/app/docs/design/page.mdx` — layout and the ffi story (already partly corrected; verify the
  correction reads well and matches the code).
- `site/app/docs/reference/cli/page.mdx` and any window/API page — `window.setSize`, `window.getSize`
  and the resize behaviour.
- The **parity page** — it is the one place a reader goes to ask "does this work on my OS". Read what
  it says about windows and resizing, and make it match what is true today. **Do not turn a status
  count into a table row**: `bun run check:parity` reads every `| … |` row in that page as a feature,
  so a table of counts reports 48 phantom features. Keep counts as bullets.
- Any page claiming a platform limitation that a recent commit removed.

## Rules for the writing

- State what the code does and how it was measured, not what sounds reassuring. If a thing is only
  read-from-code on Windows, say that.
- No page may claim a runtime observation nobody made.
- One sentence of reason beats a paragraph of adjectives.

## Own

`site/app/docs/**` only. Do **not** touch `site/public/SKILL.md`'s generated region
(`<!-- skill:commands:begin -->` … `end`) — `bun run skill:check` owns it — and do not edit source.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt`.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- `bun run site:build`, `bun run check:links`, `bun run check:parity`, `bun run skill:check` — all
  green, output pasted.
- `bun run check:lines`.
- A one-line summary per page you changed.

Final message under 10 lines: the pages changed, and the one claim you found that was plainly false.
