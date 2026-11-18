# Next wave, lanes 4–11

Same shared rules as `BRIEF.md` — one tree, `rg`/`fd`, foreground builds, never `bun fmt` without
paths, no file over 200 lines, quotes over numbers, only your own files.

Each lane owns exactly two paths: `docs/reviews/next-wave/<lane>.md` and `docs/agents/<lane>.md`.
Do not edit source. Do not fix what you find — report it.

## Lane 4 — `docs-truth`

Field: the docs site against the code. Every claim on `site/app/docs/**` that describes behaviour is
a testable statement. Find the ones that are now false, stale, or were never true.

Read `site/app/docs/**` and check each behavioural claim against `src/`. There are truth tests
already (`rg -l 'truth' src scripts`) — read them to see what is already pinned, then look at what is
not. A page that describes a config key, a return shape, a refusal or a platform limit is the
highest-value target. Quote the page line, quote the code line, say which one is wrong.

Rank by how badly a reader would be misled.

## Lane 5 — `perf`

Field: measured cost. Startup time, memory, bridge throughput, bundle size, the C shim's per-call
overhead.

Measure, do not speculate. `bun build`, `bun --smol`, `hyperfine` if present, `time`, `vmmap
-summary`, a loop of 10k invokes. Compare against what the docs claim and against a plain Bun server
doing equivalent work. Name what you measured with the exact command.

Report the three worst costs and whether each is fixable without an architectural change.

## Lane 6 — `first-run`

Field: the experience of a person who has never seen crust. Scaffold, run, build, hit an error.

Do it for real: `bun run start init` in a temp dir for each template, `bun install`, `bun run dev`,
`crust build`. Time each step. Note every message that is unclear, every wait with no output, every
error that does not say what to do next. Also try the wrong things a person tries: no Bun, wrong
directory, an existing dir, a template name that does not exist, `--help` on every subcommand.

Do not leave scaffolds behind — clean up your temp dirs.

## Lane 7 — `test-quality`

Field: tests that pass for the wrong reason, and behaviour with no test at all.

Find assertions that cannot fail (asserting a constant against itself, a `toContain` on a string the
test itself built, a mock whose fake never runs the real code), tests gated behind a platform check
that never runs here, and files with meaningful logic and no test. A passing suite that proves less
than it appears to is the defect.

For each: the file:line, why the assertion is hollow, and what would actually prove it. Do not
rewrite the tests.

## Lane 8 — `packaging`

Field: build, sign, install, update, ship. The whole path from `crust build` to a person running it.

Read `src/packaging/`, `scripts/build-standalone.ts`, `scripts/release/**`, `.github/workflows/`.
Look for: what a real shippable app still needs that crust does not do, MSI/dmg/pkg/AppImage, code
signing per platform, auto-update in a signed bundle, crash symbolication, version skew between the
binary and the app. Check the release workflow's actual steps against what `crust build` produces.

Rank by what blocks shipping a real app.

## Lane 9 — `api-design`

Field: the developer-facing surface. Config keys, plugin API, typed IPC, error shapes, the CLI.

Compare against Tauri and Butter where it matters (read the parity page first, do not re-litigate
settled rows). Find: a name that lies, a return shape that is awkward, a place where the obvious
call is the wrong one, an error that does not say which key, a config key with no default documented.
Read `src/plugins/define.ts`, `src/config*`, `src/types*`, `templates/*/crust.config.ts`.

Rank by how often a developer would hit it.

## Lane 10 — `native-surface`

Field: the C shim itself. Memory, arity, error paths, leaks, the ffi boundary.

Read `src/platform/darwin/shim/*.c`, `src/platform/{linux,windows}/shim/*.c`, and every `*-ffi.ts`
declaration. Check each declaration's arity against its C prototype, each allocation against its
release, each error code against its caller. Look for the classes of bug that have already bitten
this repo: a `void*` where a `long` is returned, a dictionary reused wrongly, a handle leaked on the
error path, a selector sent with the wrong argument count.

For each: file:line, the mismatch, and how it manifests. Rank by whether it crashes, leaks, or
silently lies.

## Lane 11 — `accessibility-and-i18n`

Field: a real app's users who are not you. Screen readers, keyboard-only, locale, RTL.

Check `src/plugins/accessibility*`, `src/plugins/i18n*`, the templates' HTML, and what a keyboard
user can reach in a crust app versus a plain web page. Note what the platform does not expose (AX
tree from a WebView, focus order across windows, menu accessibility). Say what is genuinely absent
versus what is the OS's own limit.

Rank by what would block a real product shipping.

## Final message

Under 12 lines. Bullets. Your top three findings with one clause each.
