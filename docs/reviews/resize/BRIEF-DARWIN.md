# macOS windows cannot be resized — the page never follows the window

Reported by the owner: "apps can't be resized". One app (`probability-bet`) reproduces it; it is
**read-only, do not open, edit or run anything in it**.

## Measured, not guessed

A probe built a real `NSWindow` through `createNativeWindow` and read both frames with
`shim_frame_num`:

```
initial    window 1100x792  content 1100x760  webview 1100x760
resized    window 1600x840  content 1100x760  webview 1100x760   ← window grew, page frozen
```

The window resizes. The webview stays at its initial size, so the page area never changes — which
is what "can't be resized" looks like.

## Root cause, both halves

`src/platform/darwin/window-create.ts` sets up Auto Layout wrongly:

1. **Line 90** — `S.vb1(content, "setTranslatesAutoresizingMaskIntoConstraints:", 0)` on the
   **content view**. With no constraints sizing it, AppKit leaves it at `0x0`. Measured by removing
   only the fixed-size constraints below: `content 0x0  webview 0x0`.
2. **Lines 99-100** — two `shim_constraint_simple(web, 7n/8n, 0n, width/height)` constraints pin the
   webview to the *initial* width and height. They also fight the four edge constraints above them,
   and they are the only reason the content view had a size at all.

## The fix, measured

Removing **both** — the content-view `translates` line and the two fixed-size constraints, leaving
the webview's four edge pins (`top`, `bottom`, `leading`, `trailing`) and
`web.setTranslatesAutoresizingMaskIntoConstraints: 0` — produces:

```
initial    window 1100x792  content 1100x760  webview 1100x760
resized    window 1400x840  content 1400x808  webview 1400x808
shrunk     window 900x600   content 900x568   webview 900x568
```

Grow and shrink both track. That is the shape to land.

## What to do

1. Make that change in `src/platform/darwin/window-create.ts`, and **replace the comments** so they
   state the measured reason: the content view keeps its autoresizing behaviour because the window
   sizes it, and the webview is pinned on all four edges with no size of its own. Delete the
   `shim_constraint_simple` calls; if nothing else uses that symbol, leave the shim alone (other
   platforms' tests may reference it — check before deleting anything).
2. **Prove it in the gate, not by hand.** Add a regression to the window e2e so a future change
   cannot re-freeze the page:
   - `scripts/window/proof.ts` / `scripts/e2e-window.ts` already launch a real bundle whose page
     reports its own URL and `invoke` answers. Extend that page (and the backend it talks to) so it
     reports `window.innerWidth`/`innerHeight`, then have the backend call
     `window.setSize(label, { width, height })` for a size clearly different from the initial one and
     assert the reported viewport changed to match.
   - Resize **both larger and smaller** — one direction can pass with a one-way constraint.
   - Keep every existing assertion in that e2e passing.
3. If `examples/*` or the docs describe window sizing, check whether anything now reads wrong. Do
   not touch `site/public/SKILL.md`'s generated region (`<!-- skill:commands:begin -->` …
   `end`) — `bun run skill:check` owns it.

## Own

`src/platform/darwin/window-create.ts`, `scripts/e2e-window.ts`, `scripts/window/**`. Nothing else.
Another lane is auditing the Windows and Linux platforms concurrently — do not edit those.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without
  a path list. 200-line cap — split, never trim.
- Never `agent-desktop`, never move the cursor. The e2e launches a GUI app: run it as
  `probe-run -c 'bun run e2e:window'` so the app that was frontmost is restored afterwards.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- The probe measurement before and after, in the shape shown above (initial / larger / smaller).
- `bun run e2e:window` green, with the new resize assertions visible in its output.
- `bun run test`, `bun check`, `bun run check:lines`.

Final message under 12 lines: what you removed, the three measured frames, and the e2e assertions
you added.
