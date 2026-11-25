# crust

Agent workflow, the gate and the traps that cost a crash. Install paths, API explanations and
measurements live in the docs site under `site/app/docs`; the design reasoning is at `site/app/docs/design/page.mdx`.

## Lanes

- **Never fewer than 3 subagents in flight**, unless the provider is genuinely unavailable — the work
  partitions by directory, and one lane at a time serialises what could run beside it.
- **Every dispatch and every continue pins `opencode-go/hy4-flash-free#high`** — the global config sets
  no `model`, so an unpinned call inherits the session's own paid lane, and the owner's standing rule is
  ALWAYS HY4 FLASH (user, 2026-11-21). This repo line said `deepseek-v4.1-flash#high` until 2026-11-25 and
  four capture lanes were dispatched on it before the owner caught it; the global rule outranks a stale
  repo line, so prefer HY4 and treat this bullet as the place a repo may narrow, never contradict.
- **One writer per file.** Give lanes disjoint file sets; two agents on one file is how a merge
  silently keeps one of them.
- **Merging and tagging here need no permission** — the owner waived the approval step for crust on 2026-11-17, so land PRs and cut tags directly; a tag push is still one tag at a time (user, 2026-11-17).
- **After every release is published, refresh the installed skill: `skills update crust`** (user, 2026-11-20) — `~/.agents/skills/crust` is a copy of `main` taken at install time, so without the update it keeps the previous tag's pin and silently misses docs that landed after the last install; verify with `rg -n "v0\\.2\\.[0-9]" ~/.agents/skills/crust/SKILL.md` matching the tag you just cut.
- **The same refresh covers the two installed CLIs: `brew upgrade crust` and `bun add -g github:JeffreyJYZ/crust#<tag>`** (user, 2026-11-20) — `~/.bun/bin` precedes `/opt/homebrew/bin`, so the Bun copy is what `crust` resolves to and brew updates a binary nobody invokes; update both and verify with `which -a crust` plus each path's own `--version`.
- **The trio is for crust's own release only** — an app that consumes a crust tag bumps `package.json` to `github:JeffreyJYZ/crust#vX.Y.Z`, runs `bun install` and confirms `node_modules/crust/package.json`; it never runs `skills update crust` or the global installs (user, 2026-11-21, caps: "ONLY FOR CRUST").
- **Never mint a version with no content** (user, 2026-11-21: "no need for tag if no content") — a tag ships a change; when parallel lanes land several roadmap items under one version, the missing numbers are retired rather than faked with empty releases.
- **Every release includes a docs and SKILL.md review, not just a pin bump** (user, 2026-11-20, caps: "EVERY RELEASE HAS TO HAVE U REVIEW DOCS AND SKILL.MD UP TO DATE") — read each new command, config key and app-facing API against the code, because 0.2.6 shipped the framework log documented and `log.info` missing from the skill.
- **`scripts/release.ts` never writes `CHANGELOG.md`, so a tag ships with the file still on the previous version** (2026-11-25: `0.2.19` and `0.2.20` both shipped that way) — add the version section in the same turn as the tag, one bullet per user-visible change, naming the symptom and what changed rather than the PR number.
- **`skill:check` proves only the command table, so a new entry point, export or config key needs an actual read of `site/public/SKILL.md` and its guide, by the agent that changed it** (user, 2026-11-22: "remember to actually check the skill and docs", then "u read") — never a human-read checklist and never a claim, because the checker cannot see prose and a missing import path is exactly what a consuming app hits first; grep the new symbol in both and quote the line.
- **The log redactor matches field names, so an over-broad pattern silently deletes data** — a field named `keys` shipped as `[redacted]` and an app renamed it to `shape` to get its array back (perch-crust, 2026-11-20); the pattern is curated to secret names and their suffixes now, and `keys`/`key`/`publicKey` survive, because over-redaction costs the caller information nothing can recover.

## The gate

`bun check` && `bun run test` && `bun run verify:package` && `bun run e2e` && `bun run check:lines`,
plus `bun run site:build` and `bun run check:links` when you touch `site/`, and whichever e2e owns
the path you touched:

- `bun run e2e:notes` — multi-file apps, `fs` against a real folder, the window title
- `bun run e2e:fullscreen` — the window's collection behaviour and a real fullscreen transition
- `bun run e2e:single` — single-file mode
- `bun run e2e:dev:react` — a real Vite driven through `crust dev`
- `bun run e2e:window` — the `window` plugin
- `bun run e2e:dogear` — any plugin surface, the widest example
- `bun run e2e:preview` — the QuickLook panel, `hide()`, and the `fs.scope` refusal
- `bun run e2e:browser` — the second WKWebView: capture, origins, `window.open`, capture denial
- `bun run e2e:notify` — `notification`; diagnostic rather than a gate step, because it needs a
  person to answer the permission prompt

A green gate is the only proof a landing is safe.

- **`verify:package` is a release gate** — it packs, installs and runs `crust --help`; 0.2.14 passed
  `check`, `test` and `skill:check`, shipped a CLI that could not load, and was caught by CI only
  after the tag. `scripts/release/gate.ts` runs it before bump, tag or push.
- **Every file stays at or under 200 lines, tests and examples included** — `bun run check:lines` is
  the measurement, so an oversized file fails the gate instead of relying on memory. Split by
  responsibility; never trim a comment that records a measured reason to reach the number.
- **`check:parity` reads every `| … |` table in the parity page as feature rows** — a status-count
  table made it report 48 rows and list `status, same, via Bun` as unlisted features; keep counts as
  bullets (2026-11-16).
- **Never run `bun fmt` without a path list here** — it rewrites every file it can reach, including
  lanes' in-flight work, and a tree-wide sweep has already reformatted ~135 files at once; format the
  files you changed, or wait for the lanes to land (2026-11-16).
- **A perf number measured while sibling lanes build is not the app's cost** — record `sysctl -n vm.loadavg` and the `bun` process count before and after each run, and label any run over 2.0 `contaminated`, because load drift manufactures wins that then get attributed to the change.
- **Interleave A/B perf arms and keep a same-flag-vs-itself control row** — sequential-then-sequential under drifting load invents a winner, and a delta smaller than that control row's spread is not a win.
- **An inactive probe window is occluded, so WebKit renders 0 fps** — `testing.activation: "none"` is the right way to avoid focus theft and the wrong way to measure frames; disable window occlusion detection in the probe scaffold (dev-only, never a shipped default), and fail the run when the drawn frame count is zero.
- **No shippable WKWebView flag moves crust frame time** — measured 21-24 ms p50 / 26 ms p95 with `drawsBackground`, `wantsLayer`, `layerContentsRedrawPolicy`, `suppressesIncrementalRendering` and a fresh process pool each varied, so attack work on the main thread, not webview configuration.
- **The published package ships `src`, `templates` and `docs` only, so a `src/` import must never escape `src/`** — `src/cli/perf` imported `scripts/perf/**` and the red was `Cannot find module '../../../scripts/perf/conditions.ts'` from an installed consumer; run `bun run verify:package` after adding CLI code, because typecheck and the suite both stayed green while the artefact was broken.
- **A new plugin must be re-exported from a `src/plugins/barrel-*.ts`, or no app can mount it** — `perf` shipped with a collector, an overlay and a CLI while `crust/plugin` answered `createPerfPlugin: undefined`, because tests import `./perf` directly and never notice; `verify:package` now mounts it from the installed tarball.
- **`mock.module` must run before the module under test is imported** — a static import binds the real module first, so the hook never fires and a race test silently exercises the real `realpath`; dynamic-import the subject after `mock.module` or the TOCTOU test proves nothing (2026-11-25, fs scope).
- **A wall-clock deadline on a timer-driven run loop measures starvation, not a stall** — the macOS pump is a `setTimeout` chain, so an eval budget in ms fires against a loop that never got a turn; measure it in pump progress (`pumpProgressMs`) or a loaded runner reports a good page as dead (2026-11-25, three CI reds).
- **A fix merged after a tag is in no published artefact** — 0.2.15 was cut from `cf902b1` while the barrel export of `createPerfPlugin` landed at `717fabf`, so two releases shipped a profiler no app could mount; verify against the installed tag (brew's `libexec`, or `bun add github:…#vX`) rather than `main`, and cut a new version instead of assuming the merge reached users.
- **When a formatting sweep lands, keep the formatting edits — never revert** — reverting wiped two
  lanes' first passes at 15:39 on 2026-11-16, while a formatting-only diff costs nothing; a revert
  destroys real work, so keep it and carry on (user, 2026-11-16).

## Traps

- `[[NSWindow alloc] init]` is not a valid initializer — use `initWithContentRect:…` with the rect
  built on the C stack.
- **`NSWindowCollectionBehaviorFullScreenAuxiliary` (256) disqualifies a window as fullscreen-primary,
  so the green button becomes a zoom `+` that stops at the visible frame** — measured 923 pt fullscreen
  against 840 pt zoomed on a 956 pt display, which is why "the window got bigger" proves nothing.
  `moveToActiveSpace | fullScreenPrimary` = 130 is the pair that keeps the launch-on-active-Space
  behaviour and the real button; `canJoinAllSpaces` contradicts `fullScreenPrimary` because a window
  on every Space has none to transition into (2026-11-19).
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
- A `WKURLSchemeHandler` cannot fetch its own scheme with `+[NSData dataWithContentsOfURL:]` — that
  answers nil for a scheme it does not know, so the bytes must come from the rule; a `fetch` from the
  bridge origin also needs `Access-Control-Allow-Origin`, and `<img>` is refused on a custom scheme
  while `<script src>` and `fetch` work (measured 2026-11-16).
- WebKitGTK's `EventSource` sends **no `Origin` header** on a same-origin GET, so an origin gate that
  refuses a null `Origin` kills the whole event stream on Linux while the POST invoke path keeps
  working — the token is the credential, and a cross-origin page always sends `Origin` (measured
  2026-11-16).
- **A `bun:ffi` vtable call declared to return `shim_i64` reads an undefined top half of RAX when the method returns a 32-bit `HRESULT`** — `< 0` can then read `S_OK` as a failure, so declare `int` and widen only where stored (measured 2026-11-16).
- **`CoGetApartmentType` answers `0` STA, `1` MTA, `2` neutral, `3` main STA, `-1` not initialised** — `1` is MTA, so a probe reading it as STA inverts the verdict (2026-11-16).
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
- **A template capability names its commands, so a CI proof that patches in one must grant it** — `windows-arm-runtime` added a `viewport` command while the scaffold granted only `app:greet`, so the bridge refused it deny-by-default and the workflow stayed red on five tags (2026-11-20).
- **A page `.catch` is invisible in a built app** — the log mirror is off unless `logging.console`, so a refused invoke reads as silence and waits out whatever timeout the harness set; set `console: true` in a proof app so a refusal prints `forbidden` with its reason (2026-11-20).
- **`bun test <dir>` matches a vendored path by substring** — `bun test scripts/windows` also runs `research/electrobun/repo/package/scripts/windows-release-validation.test.mjs`, whose 5 s watchdog test fails here, so a subset run reads 1 fail while the gate is clean (2026-11-20); name the file, not the directory.
- **Never `open` a built bundle** — it routes through LaunchServices and raises Gatekeeper dialogs.
  Run `X.app/Contents/MacOS/<bin>` directly; that is the only launch path that reports exit 0.
- **After a probe that launches or activates a GUI app, hand focus back to whichever app was frontmost
  before it started — not necessarily Ghostty** (user, 2026-11-18) — capture it first with
  `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`
  and restore that same app, falling back to Ghostty only when the capture failed. The point is the
  human is never left looking at a test window; yanking them to a terminal they were not using is its
  own theft. Capture before touching the shell too: a screenshot taken after a command shows the
  terminal, not the app.
- **Every crust launch now activates**, because the accessibility fix sends `-activateIgnoringOtherApps:`
  when the app is not already active — so a probe steals focus where it used to steal nothing, and any
  harness that launches a built app must hand focus back when the run ends (2026-11-16).
- **`process.exit()` does not run a `finally`** — a harness tail shaped `try { process.exit(await main()) }`
  never reaches its cleanup, so the restore has to be `let code … finally { await restoreFocus() }`
  then `process.exit(code)` (measured 2026-11-16).
- **Say so before anything that takes focus, moves a window or asks for a physical click** — their
  screen is theirs. A performed click they reported outranks a missing log line, because
  instrumentation may predate the log file.
- **A focus-dependent test failure is probably the human, not the code** (user, 2026-11-18) — AppKit
  answers `AXWindows` only for a window on the active Space, so switching apps mid-run makes
  `accessibility.elementCount` refuse honestly and the sweep look broken. The control is a deliberate
  switch: 3 s in passed, 0.4 s in failed. Reproduce that before calling it a defect, and make the
  harness independent of who is frontmost rather than tolerating a flaky local gate.

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
- **An adapter contract added in `src/plugins/**` is inert until every `src/platform/**` adapter calls it** — `onNavigate` shipped declared, built and consumed only by the fake, so `browser.origins` still gated entry only in every built app; land the native caller in the same wave or the boundary is prose (2026-11-21).
