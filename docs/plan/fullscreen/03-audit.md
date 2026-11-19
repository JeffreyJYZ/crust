# Lane C — parity audit (read-only)

Read `docs/plan/fullscreen/BRIEF.md` first.

## Own

- `docs/plan/fullscreen/audit.md` (new). Nothing else — this lane writes no source.

## The user's words

"crust apps in dev and built modes are weirdly cant go full screen. normal windows green btn is full
screen but in crust apps its a plus icon that expands to fill screen but not full screen."

Two claims to audit, because the fix in lane A only touches one code path:

1. **Dev and built really are the same window.** Find every path that creates a native window on
   darwin — `src/platform/darwin/window-create.ts` is the obvious one, but check the dev server, the
   `crust dev` launcher, any separate window plugin path, sheets/dialogs, and anything that builds a
   window without going through `createNativeWindow`. If dev differs, name the file and line where.
2. **Nothing else takes the fullscreen entitlement away.** Search the whole tree for
   `setCollectionBehavior`, `collectionBehavior`, `setStyleMask`, `setResizable`, `setMovable`,
   `setFullScreen`, `toggleFullScreen`, `NSWindowStyleMaskFullScreen`, and for any plugin command
   that could rewrite the style mask after creation. A second writer would make lane A's fix
   silently ineffective, and that is the failure worth finding now rather than after a release.

Also check the **windows** and **linux** platforms: does either implement fullscreen in a way that
suggests the darwin one is missing a step (a saved frame, a style bit, a level)? Report the
difference, do not change it.

## Rules

- Read-only. Do not edit `src/**`, `scripts/**`, `site/**`.
- Cite `file:line` for every claim, and quote the line. A claim with no line is not a finding.
- Distinguish measured from read: if you did not run it, say "read, not run".
- If you find nothing, say "nothing found" for that question — do not pad.

## Final message

Under 12 lines: for each of the two claims, the verdict and the line that decides it. Plus any other
writer you found.
