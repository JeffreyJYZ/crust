# dock-badge — Lane M (butter parity)

## Verdict
BRIEF-4.md Lane M premise is wrong: butter's dock badge takes text, never an image path. No code change, no test — parity row already correct.

## Evidence (butter source, read-only)
- `~/dev/resources/butter-src/src/plugins/dock/index.ts:38-40`: `setBadge(text)` sends `invoke("dock:setbadge", { text: text })` — a string, no path/image argument.
- `~/dev/resources/butter-src/src/shim/darwin.m:1859-1864`: handler reads `dockData[@"text"]` then `[[NSApp dockTile] setBadgeLabel:text ?: @""]` — AppKit badge *label* (text), never `contentView` or `NSImage`.
- `~/dev/resources/butter-src/tests/plugins.test.ts:395-400`: `handler("3")` returns `{ ok: true }` — text-label proof.
- rg over all butter-src for `setbadge|badge.*image|NSDockTile|dockTile|setBadgeLabel` finds only these files; no image-path branch exists.

## crust side (already matches)
- `src/plugins/dock.ts:104-115`: `badge` takes `label: string`, empty clears; rejects non-string with `bad-request` — no silent ignore.
- `src/platform/darwin/dock.ts:53-59` + `src/platform/darwin/shim/104_dock.c:67-84`: `bytesOf(label)` → `crust_dock_set_badge` → `setBadgeLabel:`. Same AppKit selector butter uses.
- `site/app/docs/reference/parity/page.mdx:65`: Dock row already reads "badge text" / "same" — accurate, no limitation note needed.

## Decision
Nothing to fix: adding image-path support would invent a butter feature that does not exist. Filed as wrong finding per fix-wave BRIEF.md:13-14.
