# crust

Bun-native macOS desktop framework: system `WKWebView` driven from Bun over a shipped `.c`
shim compiled at launch by TinyCC. No Rust, no bundled Chromium. Design and measured evidence
live in `DESIGN.md`; research reports in `research/`.

## Working rules for this repo

- **Never fewer than 3 subagents in flight here**, unless the provider is genuinely unavailable
  (user, 2026-11-13) — the work partitions cleanly by directory, and one lane at a time serialises
  what could run beside it. Give each lane a disjoint file set; two writers in one file is how
  edits disappear.
- **Every lane is `opencode-go/deepseek-v4.1-flash#high`** and pins it explicitly, since the global
  config sets no `model`. (Command Code was the lane until 2026-11-13; the OpenCode Go shelf
  replaced it when that usage reset.)
- **The gate is `bun check` && `bun run test` && `bun run e2e`**, plus `bun run e2e:notes` when the
  multi-file path is touched, `bun run e2e:single` when the single-file mode is touched,
  `bun run e2e:dev:react` when the dev-server path is touched (it drives a real Vite through
  `crust dev`), `bun run e2e:window` when the `window` plugin is touched, and
  `bun run e2e:dogear` when a plugin surface changes — it is the widest example and exercises
  `fs`, the window title and the tray from a page. A green gate is the only proof a landing is safe.
- **Never `open` a built bundle** — it routes through LaunchServices and raises Gatekeeper dialogs.
  Run `X.app/Contents/MacOS/<bin>` directly; that is also the only launch path that reports exit 0.

## Things that cost a crash or a wrong answer

Recorded in `DESIGN.md` §2 and `docs/architecture.md`; the short list, because each was measured
the hard way:

- `[[NSWindow alloc] init]` is not a valid initializer — use `initWithContentRect:…` with the rect
  built on the C stack.
- A short ASCII `NSString` is a tagged pointer and cannot cross `bun:ffi`; objects stay in C.
- `-windowNumber` never clears after `-close`; liveness is `visible || miniaturized || appHidden`.
- Every `bun:ffi` declaration's arity must match its C prototype — `src/platform/darwin/arity.test.ts`
  fails the suite otherwise.
