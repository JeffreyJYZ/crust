# Docs wave: prove every page against the code

58 pages under `site/app/docs/`. The last audit checked four and found four false claims, which is a
proof that sampling does not work. This wave covers all of them, one lane per group, and each lane
reads the code before it writes a verdict.

Shared rules as `docs/reviews/fix-wave-2/BRIEF.md`: one tree, `rg`/`fd`, foreground builds, 200-line
cap, never `bun fmt` without a path list, only your own files, quotes over numbers.

**Hand focus back when you finish**, to whichever app was frontmost before you started (capture it
with `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
first), not necessarily Ghostty.

## What "correct" means

For every behavioural claim on a page — a config key, a return shape, a refusal, a default, a
platform limit, a number — find the code that makes it true or false. Quote the page line and the
code line. Three verdicts:

- **accurate** — the claim matches the code. Say so in one line; do not pad.
- **wrong** — the code does something else. Fix the page to the code, unless the claim is the better
  behaviour and the change is small and belongs to you — then say so and make it, in your files only.
- **unprovable** — nothing in the tree answers it (a measurement of a machine, an OS version).
  Say what would prove it and leave the sentence alone.

A page that is right needs no diff. Reporting "checked, accurate" for most of your pages is the
expected result and is not a wasted lane.

## Verification every lane runs

```
bun run site:build
bun run check:links
bun run check:parity
rg -l truth src scripts     → run every file it lists
```

## Ownership: one lane per group, no two lanes on one file

- **D1 `docs-start-limits`** — `site/app/docs/start/**`, `site/app/docs/limits/page.mdx`,
  `site/app/docs/design/page.mdx`, `site/app/docs/evidence/page.mdx`.
  The platform table, the install matrix (does it name all six assets including windows-arm64?), the
  distributions section, every number on the evidence page.
- **D2 `docs-guides-a`** — guides alphabetically through `g`: accessibility, autostart, clipboard,
  crash-reports, database, dev, dialogs, dock, downloads, extensions, files, find-in-page, frontend,
  i18n.
- **D3 `docs-guides-b`** — guides from `k` through `pa`: keychain, lifecycle, logging, native-extensions,
  navigation, network, notarize, notifications, opener-and-os, package-formats, package, permissions.
 Consider `permissions` and `release` are the two newest pages and the most likely to describe
  behaviour that changed under them this wave.
- **D4 `docs-guides-c`** — guides from `po` through `z`: power, release, screen, shell, shortcuts,
  sidecar, single-instance, theme, tray, typed-ipc, updater, window, window-state.
- **D5 `docs-reference-a`** — `reference/api/page.mdx`, `api-app`, `api-desktop`, `api-fs`, `api-ui`,
  `api-updater`, `api-web`, `api-window`. Every signature against the plugin that implements it.
- **D6 `docs-reference-b`** — `reference/cli`, `reference/config`, `reference/errors`,
  `reference/platforms`. Every flag, every config key, every error code and status.
- **D7 `docs-parity`** — `reference/parity/page.mdx` only. The table's rows against
  `docs/agents/butter-coverage.md` and the live sweep in `scripts/butter-sweep-commands.ts`. A row
  marked `same` must name a command the sweep actually drives, or state why it cannot be driven.
  This page has been wrong three times; treat every `same` as unproven until the sweep row exists.

## The one thing that matters most

Anything this wave changed must be described correctly: the capability model (`app:<name>`, the token
as authority), the CSP nonce, the content world, sidecars reaching every build path, six release
assets including `windows-arm64`, the updater refusing off macOS, the non-darwin plugin refusals,
`app.invoke` honouring both refusal forms, and the gate's `./src` path. If a page still describes
the old behaviour, that is the finding.

## Final message

Under 12 lines. Bullets: pages checked, wrong claims found and fixed, anything left unprovable.
