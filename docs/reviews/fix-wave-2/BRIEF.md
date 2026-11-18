# Fix wave: the eleven-lane hunt, ranked

Six lanes, disjoint files, one writer each. Every lane fixes what it owns, adds a test that is red
before the fix, and leaves the gate green.

## Shared rules

- One tree, no worktree. Work in `~/dev/crust`.
- `rg`, never `grep`/`find`. `fd` for paths. Never scan from `/`, `~` or a repo root without a path.
- Run every build and test in the foreground and wait for it inside the same call.
- `bun check` is the type gate. `bun run test` is the suite (never bare `bun test` — it sweeps the
  vendored `research/electrobun` mirror and reports ~68 spurious failures). `bun run check:lines`
  is the 200-line cap: split a file, never trim it.
- Never run `bun fmt` without an explicit path list.
- Never `open` a built bundle; never move the cursor or synthesize input on the user's screen.
- Do not write to the global `AGENTS.md`. Record what you learned in `docs/agents/<lane>.md`.
- A claim needs a command behind it. Quote the command, not just the number.
- Touch only the files your lane owns. If you spot a defect outside your files, report it — do not
  fix it.

## Context: where the evidence is

`docs/reviews/next-wave/` holds eleven reports and their red probes. Read the one your lane names
before you start. The probes under `docs/reviews/next-wave/probes/` are not collected by the gate;
use them, and if your fix makes one pass, say so.

## Lane F1 — `fix-capabilities` (highest priority)

Read `docs/reviews/next-wave/defects.md` §1 and the probe
`docs/reviews/next-wave/probes/capability-spoof.test.ts`.

The defect: `src/bridge/server/invoke.ts:129` takes the window label from the request body and
`:49` uses it for `capabilities.allows`. One process-wide token means any page holding it can claim
any label. `src/bridge/window-identity.ts:15` states the opposite — "a label is a routing hint,
never authority" — so the code and the design note disagree.

Fix: bind the label to the credential. Record token→label when the document is served
(`handler.ts:52-65`), mint a token per document, and authorise on the bound label — ignoring the
body field for authorisation. Keep the body field working for routing where a label is genuinely
just routing, and keep the single-token path working for a dev-server page that never went through
the document route.

Own: `src/bridge/server.ts`, `src/bridge/server/{invoke,handler,capabilities,types}.ts`,
`src/bridge/window-identity.ts`, and the tests beside them.

Prove: the probe goes green, and a new test shows a second window's document gets only its own
grants. If a per-document token breaks the dev-server path, that test says so.

## Lane F2 — `fix-updater` + `fix-shell-env` + gate list

Three small defects, one lane, because each is a narrow file.

1. `docs/reviews/next-wave/defects.md` §2: `updater.check` fetches a page-supplied URL with no
   scheme check while `download` has one. Own: `src/plugins/updater*.ts`. Apply the same URL policy
   `download` uses, and prove it with a test.
2. `defects.md` §3: the shell env injection blocklist misses a lowercase spelling. Own:
   `src/plugins/shell-env.ts`. Fold before the check.
3. `docs/reviews/next-wave/test-quality.md` finding 1: `package.json:31`'s test path list omits
   `src/config/`, `src/extensions/`, root `src/*.test.ts` and `examples/` — 171 tests in 29 files
   never run in the gate or CI. Own: `package.json`. Add the paths, run `bun run test`, and report
   the new totals. If any newly-collected test fails, that is a real defect: fix it if it is in your
   files, else report it and exclude nothing silently.

Own: `src/plugins/updater*.ts`, `src/plugins/shell-env.ts`, `package.json`, and tests beside them.

## Lane F3 — `fix-native-leaks`

Read `docs/reviews/next-wave/native-surface.md` §leaks.

Own: `src/platform/darwin/shim/113_network_serve.c`, `src/platform/darwin/shim/110_network.c`,
`src/platform/darwin/shim/downloads/00_prelude.c`, `src/platform/windows/shim/48_keychain.c`, and
the darwin/windows ffi or adapter files those touch.

Fix the leaks the report names: owned NSData / NSHTTPURLResponse / NSStrings never released per
serve and per refused task; `dl_nsstring` returning +1 with no release in `dl_start` and
`dl_file_url`; and `48_keychain.c:121,137-139` collapsing access-denied into "not stored" rather
than a refusal the adapter can report.

Remember the documented trap: never `free()` GLib memory in the Linux shim, and here never hand a
Cocoa object to `free` — release it through its own `-release`. `bun fmt` cannot parse `.c`; check
with `clang -fsyntax-only -std=c99 -Wall` against the assembled shim source.

Prove: whatever is testable in Bun gets a test; for the C, a comment stating the ownership rule plus
a syntax check is the floor, and a live assertion is better.

## Lane F4 — `fix-sidecars-and-dev`

Two gaps, both from the reports.

1. `docs/reviews/next-wave/packaging.md` finding 1: `build.sidecars` is validated and documented but
   never passed to `buildApp` — `src/cli/build.ts:125` omits it, so a built app's manifest is empty
   and every `sidecar.spawn` name is refused. Own: `src/cli/build.ts`, `src/packaging/build.ts`.
   Wire it and prove a built app's manifest names its sidecars.
2. `docs/reviews/next-wave/first-run.md` finding 1: `crust dev` on the Svelte and Vue scaffolds dies
   `crust: document is not defined` with no window. Builds are fine, so it is dev-only. Own:
   `src/runtime*.ts`, `src/cli/dev*.ts`, `templates/{svelte,vue}/**` if the fault is there.

Own: `src/cli/build.ts`, `src/packaging/build.ts`, `src/cli/dev*.ts`, `src/runtime*.ts`,
`templates/svelte/**`, `templates/vue/**`, and tests beside them. Do not touch `templates/next/**`,
`templates/react/**` or `templates/default/**`.

Prove: a test for the manifest; `crust dev` on svelte and vue actually opening a window, driven in
a temp dir you delete afterwards.

## Lane F5 — `fix-docs-truth`

Read `docs/reviews/next-wave/docs-truth.md`.

Four false claims: the pump interval (docs say 0.25 ms, the shim passes 4 ms), `reference/api`'s
`app.on` listing 2 events while `AppEvent` has 6, the logging guide's 4 levels and unbounded file
against the plugin's 5 levels and 1 MiB rotation, and the perf page's stale binary size and idle
footprint (`docs/reviews/next-wave/perf.md` measured 86.18 MiB and 120.7 MiB).

A claim gets corrected to what the code measures, never the code bent to the claim — unless the
claim is the better behaviour and the change is one line, in which case say so and make it.

Own: `site/app/docs/**`. Do not touch `src/`.

Prove: `bun run site:build` and `bun run check:links` pass, and the truth tests
(`rg -l truth src scripts`) still pass.

## Final message

Under 12 lines. Bullets. What changed, what proved it, what you did not fix.
