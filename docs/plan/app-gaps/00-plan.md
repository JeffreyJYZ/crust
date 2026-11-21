# Plan: close the app gaps, small things first, a patch release per wave

Six recon reports in `docs/recon/app-gaps/` say which gaps belong to crust. This is the order they ship:
defects first, then foundations, then features, each wave gated and released as its own patch before
the next begins.

## Release points

| release | wave | contents |
| ------- | ---- | -------- |
| 0.2.8 | 0 | shell reaping, updater redirects, media-src, single-file security, dev/build CSP parity |
| 0.2.9 | 1 + 2 | config sections and registration (one lane), then the pty plugin (POSIX + ConPTY) |
| 0.2.10 | 2 | macOS QuickLook preview, released with pty if both land |
| 0.2.11 | 2 | darwin embedded browser surface |
| 0.2.12 | 3 | browser on Windows (shim handle refactor) and Linux (per-window child) |
| 0.2.13 | 3 | Windows preview host (COM `IPreviewHandler`) — Linux documents "no system preview" |

A wave ships only when its own e2e exists. A feature without a proof does not become a version.

## File ownership

One writer per file, always. These are the shared files, and who may touch them:

- `src/runtime-plugins.ts`, `src/config/types.ts`, `src/app-types.ts`, `site/lib/nav.ts`: **wave 1 only**,
  in one lane, before any feature lane starts. Every later lane reads them and does not edit them.
- `src/app.ts`: wave 0 lane 1 (shell reaping) only.
- `site/app/docs/**`: one page per lane, never two lanes in one page. Wave 4 does the index and parity
  rows after the features exist.
- `src/platform/windows/shim/**`: one lane per unit file; the shared unit list is read, never rewritten
  by feature lanes. If a lane needs a new exported shim unit, it owns the file and the preflight entry.

## Waves

**Wave 0 — the five defects.** Three lanes, disjoint: shell reaping + quit path; updater redirects +
guide corrections; CSP (`media-src`, single-file `security`, dev/build parity) + its docs. Then gate,
`0.2.8`.

**Wave 1 — the foundation, one lane.** `config/types.ts` gains `pty`, `preview`, `browser`; plugin names
join the built-in list; grants vocabulary gains `pty:open`, `preview:show`, `browser:open`; nav entries
and empty guide pages. Small, and it exists so wave 2 lanes never collide.

**Wave 2 — three features in parallel.** pty (`src/plugins/pty*.ts`, `windows/shim/63_pty.c`, POSIX via
`Bun.Terminal`), preview (`platform/darwin/preview.ts`, `shim/125_preview.c`, `plugins/preview.ts`),
browser darwin (`platform/darwin/browser.ts`, `shim/131_browser.c`, `plugins/browser.ts`). Each owns its
own files; `runtime-plugins.ts` was already wired in wave 1.

**Wave 3 — parity.** Windows browser needs the shim's singleton webview turned into a handle table
before a second surface can exist; Linux needs one child webview per window and per-webview load state.
Windows preview is a COM host; Linux states plainly that no system preview API exists.

**Wave 4 — docs and proof.** One guide page per feature, parity rows, `SKILL.md`, and an e2e per feature
(`e2e:pty`, `e2e:preview`, `e2e:browser`) so each is rediscoverable rather than remembered.

## Rules that carry across waves

- The 200-line cap splits, never trims; a shared header becomes its own module.
- A page-reachable pty is command execution: `pty:open` is its own grant, never implied by `shell`.
- The updater's security boundary is the pinned pubkey, not the hostname — redirects may change host.
- Every exclusive-surface feature states the other platforms' behaviour in its own docs.
