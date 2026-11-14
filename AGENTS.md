# crust

Agent workflow, the gate and the traps that cost a crash. Install paths, API explanations and
measurements live in the docs site under `site/app/docs`; the design reasoning is at `site/app/docs/design/page.mdx`.

## Lanes

- **Never fewer than 3 subagents in flight**, unless the provider is genuinely unavailable — the work
  partitions by directory, and one lane at a time serialises what could run beside it.
- **Every dispatch and every continue pins `opencode-go/deepseek-v4.1-flash#high`** — the global
  config sets no `model`, so an unpinned call inherits the session's own paid lane.
- **One writer per file.** Give lanes disjoint file sets; two agents on one file is how a merge
  silently keeps one of them.

## The gate

`bun check` && `bun run test` && `bun run e2e` && `bun run check:lines`, plus `bun run site:build` and
`bun run check:links` when you touch `site/`, and whichever e2e owns the
path you touched:

- `bun run e2e:notes` — multi-file apps, `fs` against a real folder, the window title
- `bun run e2e:single` — single-file mode
- `bun run e2e:dev:react` — a real Vite driven through `crust dev`
- `bun run e2e:window` — the `window` plugin
- `bun run e2e:dogear` — any plugin surface, the widest example
- `bun run e2e:notify` — `notification`; diagnostic rather than a gate step, because it needs a
  person to answer the permission prompt

A green gate is the only proof a landing is safe.

- **Every file stays at or under 200 lines, tests and examples included** — `bun run check:lines` is
  the measurement, so an oversized file fails the gate instead of relying on memory. Split by
  responsibility; never trim a comment that records a measured reason to reach the number.

## Traps

- `[[NSWindow alloc] init]` is not a valid initializer — use `initWithContentRect:…` with the rect
  built on the C stack.
- A short ASCII `NSString` is a tagged pointer and cannot cross `bun:ffi`; objects stay in C.
- `-windowNumber` never clears after `-close`; liveness is `visible || miniaturized || appHidden`.
- Every `bun:ffi` declaration's arity must match its C prototype — `src/platform/darwin/arity.test.ts`
  fails the suite otherwise.
- **Crash reports are in `~/Library/Logs/DiagnosticReports/<binary>-<date>.ips`** (system-wide ones
  under `/Library/Logs/DiagnosticReports`) — read the `signal` and `indication` fields, and list with
  `ls -1 --sort=date`, never `ls -1t`, which eza reads as `--time <FIELD>` and errors into silence.
- **Hardened runtime needs `com.apple.security.cs.allow-unsigned-executable-memory`, not just
  `allow-jit`** — TinyCC writes code into ordinary unsigned executable memory, so `--options runtime`
  without it gives an app that launches, creates no page, prints nothing and exits 0 (the `.ips` says
  `SIGKILL (Code Signature Invalid)`, `Invalid Page`). Fixed in `src/packaging/sign.ts`, asserted in
  `src/packaging/sign.test.ts`.
- **Never `open` a built bundle** — it routes through LaunchServices and raises Gatekeeper dialogs.
  Run `X.app/Contents/MacOS/<bin>` directly; that is the only launch path that reports exit 0.
- **After a probe that launches or activates a GUI app, hand focus back to Ghostty**
  (`open -a Ghostty`) — otherwise the human is left looking at a test window. Capture before touching
  the shell: a screenshot taken after a command shows the terminal, not the app.
- **Say so before anything that takes focus, moves a window or asks for a physical click** — their
  screen is theirs. A performed click they reported outranks a missing log line, because
  instrumentation may predate the log file.
