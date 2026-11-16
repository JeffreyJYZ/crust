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
- **`check:parity` reads every `| … |` table in the parity page as feature rows** — a status-count
  table made it report 48 rows and list `status, same, via Bun` as unlisted features; keep counts as
  bullets (2026-11-16).
- **Never run `bun fmt` without a path list here** — it rewrites every file it can reach, including
  lanes' in-flight work, and a tree-wide sweep has already reformatted ~135 files at once; format the
  files you changed, or wait for the lanes to land (2026-11-16).
- **When a formatting sweep lands, keep the formatting edits — never revert** — reverting wiped two
  lanes' first passes at 15:39 on 2026-11-16, while a formatting-only diff costs nothing; a revert
  destroys real work, so keep it and carry on (user, 2026-11-16).

## Traps

- `[[NSWindow alloc] init]` is not a valid initializer — use `initWithContentRect:…` with the rect
  built on the C stack.
- A short ASCII `NSString` is a tagged pointer and cannot cross `bun:ffi`; objects stay in C.
- `-windowNumber` never clears after `-close`; liveness is `visible || miniaturized || appHidden`.
- Every `bun:ffi` declaration's arity must match its C prototype — `src/platform/darwin/arity.test.ts`
  fails the suite otherwise.
- AX visibility is gated on app activation, not on the window — AppKit lists only windows on the active
  Space, and `-[NSApplication activate]` is silently refused for a directly-exec'd process, so its window
  is off screen and absent from `AXWindows` while `AXChildren` holds the menu bar alone;
  `-activateIgnoringOtherApps:` is the call that lands (measured 2026-11-16).
- Never `free()` GLib memory in the Linux shim — Bun links mimalloc and exports its own `malloc`/`free`,
  so the shim's `free` resolves to Bun's allocator and handing it a GLib string faults (measured at
  `0xA6D0`); resolve `g_free` and use that (2026-11-16).
- WebKitGTK follows `load-failed` with `FINISHED`, so the shim keeps a failure sticky until the next
  `STARTED`; a refused connection never emits `load-failed` at all — it commits WebKit's own error page
  and finishes, so only a real load error proves that path (2026-11-16).
- **Crash reports are in `~/Library/Logs/DiagnosticReports/<binary>-<date>.ips`** (system-wide ones
  under `/Library/Logs/DiagnosticReports`) — read the `signal` and `indication` fields, and list with
  `ls -1 --sort=date`, never `ls -1t`, which eza reads as `--time <FIELD>` and errors into silence.
- **Hardened runtime needs `com.apple.security.cs.allow-unsigned-executable-memory`, not just
  `allow-jit`** — TinyCC writes code into ordinary unsigned executable memory, so `--options runtime`
  without it gives an app that launches, creates no page, prints nothing and exits 0 (the `.ips` says
  `SIGKILL (Code Signature Invalid)`, `Invalid Page`). Fixed in `src/packaging/sign.ts`, asserted in
  `src/packaging/sign.test.ts`.
- **A template change moves the standalone gate's expected file counts** — `scripts/build-standalone.ts`
  pins how many files `crust init --next/--react/(none)` writes (the glob skips `.gitignore`, which is
  checked separately). Adding the `/about` route took `--next` from 7 to 8 and left the macOS job red
  until the number was updated, so change the count in the same commit as the template.
- **Never `open` a built bundle** — it routes through LaunchServices and raises Gatekeeper dialogs.
  Run `X.app/Contents/MacOS/<bin>` directly; that is the only launch path that reports exit 0.
- **After a probe that launches or activates a GUI app, hand focus back to Ghostty**
  (`open -a Ghostty`) — otherwise the human is left looking at a test window. Capture before touching
  the shell: a screenshot taken after a command shows the terminal, not the app.
- **Say so before anything that takes focus, moves a window or asks for a physical click** — their
  screen is theirs. A performed click they reported outranks a missing log line, because
  instrumentation may predate the log file.

## Docs site (`site/`)

- **The UI is built on `@ui-sdk/react`** — read `site/node_modules/@ui-sdk/react/docs/llms.txt` first
  and only the component pages a change needs; it ships no styles, so every look comes from the site's
  own tokens in `site/app/globals.css`.
- **Every page carries the `jyz.land` backlink** from the root layout footer; a new subdomain without
  it is unfinished.

## Platform contract

- **A page loads from the bridge URL** — `http://127.0.0.1:<port>/`, navigated by the platform's own
  call (darwin `-loadRequest:`); no platform registers a custom scheme to serve a page.
- **`crust://` is never the framework's** — `urlScheme` is optional app config with no default, so a
  page-serving scheme would collide with an app's own deep links.
- **A new platform implements `Platform` and nothing more** — five methods; inventing a page-serving
  scheme is the defect that put `crust://` in two layers at once (2026-11-16).
