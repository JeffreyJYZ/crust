# Recon: which app gaps crust can close, and what each one costs

Seven capabilities are missing from an app built on crust. The question for every lane is **not**
"can an app fake it" but **"does the gap belong inside crust, and what would closing it take"**.

| # | gap | app's own verdict |
| - | --- | ----------------- |
| 1 | voice | crust 0.2.5 ships mic capture; the app's provider path is text+image, no realtime audio session |
| 2 | browser | "genuinely blocked: no webview inside a webview in crust" |
| 3 | terminal | "genuinely blocked: macOS script exits on piped stdin (EPIPE); a real pty needs FFI openpty" |
| 4 | office | "blocked by renderers: no docx/xlsx in the page, no system QuickLook in a webview" |
| 5 | updater | "blocked by keys, not code: needs `updater.pubkey` + endpoint from a signed feed you own" |
| 6 | pairing | "over-stated: a loopback server and a token exist, so a Connect panel is buildable" |
| 7 | SSH/WSL | "blocked by transport: the server binds loopback; opencode connects to remote servers" |

## Every report answers the same shape

1. **Verdict** — one of `crust feature`, `crust tooling`, `crust config`, `app side`, `blocked by the
   platform`, plus one sentence of why.
2. **Evidence** — `path:line` for every claim about the current code. A claim with no line is a guess.
3. **What it would take** — the smallest honest design: the API a page or app calls, the platform work
   per OS, new files, and which existing seam it plugs into (`Platform`, a plugin, CLI, config key).
4. **What breaks** — security, the 200-line cap, test/e2e shape, and anything that would make crust worse.
5. **Estimate** — S / M / L with a reason, not a number of days.
6. **What stays the app's job** — the half crust should not absorb.

## Rules for every lane

- **Read-only for the repo**: the only file you may write is your own report under
  `docs/recon/app-gaps/`. No builds, no `bun install`, no GUI launches, no network dependency.
- `rg`/`fd` only, never `grep`/`find`; `sd` never `sed`.
- Cite the line that proves it. If a thing does not exist, say which search proves the absence.
- Do not describe what crust *could* do without naming the file where it would live.
- Judge crust's side only. The app's product decisions are not yours to make.
- Never truncate to look concise: a short report that leaves a question unanswered is a failed one.
