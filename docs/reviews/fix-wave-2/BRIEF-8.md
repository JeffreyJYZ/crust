# Fix wave, seventh brief: eight lanes

Read `docs/reviews/fix-wave-2/BRIEF.md` for the shared rules. One tree, `rg`/`fd`, foreground builds,
200-line cap (split, never trim), never `bun fmt` without a path list, only your own files, quotes
over numbers.

**Hand focus back when you finish**: wrap any run that launches a GUI app in
`probe-run -c '<command>'`, or capture the frontmmost app first and restore it after.

Lanes A1–A3 already own: accessibility page tree + DOM focus, `48_keychain.c` frames,
`findAppBundle`. Do not touch those files.

## B1 — `perf-sync-handler`

`docs/reviews/next-wave/perf.md` measured three 200 ms synchronous handlers taking 600 ms of wall
time. Do **not** change the plugin contract — that decision is the user's. Do this instead:

1. Write a reproducible benchmark under `docs/reviews/next-wave/probes/` that starts a real bridge,
   registers a handler that sleeps 200 ms, fires three invokes, and prints the wall time plus the
   gap in pump ticks. It must be runnable by one command and print one summary line.
2. Measure what a user actually feels: whether the window repaints during that window, and whether a
   second invoke queues or runs concurrently.
3. Write `docs/reviews/next-wave/perf-sync-handler.md`: the numbers, the two candidate fixes
   (per-plugin worker; second process) with the cost each imposes on plugin authors, and a one-line
   recommendation. No code change to the bridge.

Prove: run the benchmark, paste its output, and state which number a user would notice.

## B2 — `e2e-capability-binding`

The capability spoof was fixed with unit tests. Prove it end to end, on the real platform.

Read `scripts/e2e-window.ts` and `scripts/e2e-dogear.ts` for the harness shape, then add an e2e that
serves two windows with different grants and asserts, from the page's own script: window A cannot
reach window B's command even when it puts `window: "B"` in the request body, and window B can.

Own: a new `scripts/e2e-capability.ts`, its `package.json` script, and `docs/agents/e2e-capability.md`.
Add the script name to the gate list in `package.json` only if the brief's rules allow (a second
script is fine).

Prove: the e2e passes, and fails if you revert the authority to the body label.

## B3 — `docs-arm64`

Every place a release asset is described must name six, including Windows arm64.

Read `site/app/docs/start/install/page.mdx`, `limits`, `reference/platforms`,
`reference/parity`, `guides/release`, and `README.md`. Check each names the arm64 Windows asset and
that no page claims five. Also check the Homebrew section says macOS only (the formula is a source
install for darwin).

Prove: `bun run site:build`, `check:links`, `check:parity`, and `rg -c 'windows-arm64'` on each page
you touched.

## B4 — `docs-linux-keychain`

Linux keychain now exists. Document it honestly.

Read `src/platform/linux/shim/70_keyring.c`, `src/platform/linux/keychain.ts`,
`src/plugins/keychain.ts`, `site/app/docs/guides/keychain/page.mdx`, `limits`.

Assert against the code: which commands work (`set`/`get`/`delete`), which refuses (`list`, naming
`secret_service_search_sync`), what a missing provider answers, and that secrets never cross into
Bun's allocator. Correct any page that still says Linux is not-implemented or that says `list` works.

Prove: `site:build`, `check:links`, truth tests, and quote the code lines you checked each claim
against.

## B5 — `parity-new-commands`

The parity page predates this wave's new surface. Add or correct rows, each with a Proof cell naming
something that runs:

- `app:<name>` capability grants (and that `app:invoke` stays a broad alias)
- `updater.install`/`relaunch` refusing `unsupported-platform` off macOS
- `keychain` on Linux
- window/tray typed failures now answering a non-200 status
- the six release assets including Windows arm64

Read `docs/agents/butter-coverage.md` first. Butter has no equivalent for some of these — that is a
`framework guarantee` row, not a `same` row, and the page already has that section.

Prove: `check:parity` PASS plus `site:build`/`check:links`, and name the test or sweep case behind
each Proof cell.

## B6 — `changelog-truth`

`CHANGELOG.md`'s 0.1.27 section makes dozens of specific claims. Verify each against the tree, the way
the docs-truth lane verified pages.

Read `CHANGELOG.md` lines 1–60 and check every claim: the six-asset release, the libsecret sync API,
the `./src` path fix, the AOT detection, the capability binding, sidecars, the svelte/vue dev fix,
the leak counts (9 per serve), the chunked body cap, the non-200 failure mapping, plurals/RTL, the
seven doc pages, and the parity Proof cells.

Anything false or overstated gets corrected to what the code does. A claim you cannot verify from the
tree gets softened or dropped — a changelog is read as fact.

Prove: quote the code or test behind each corrected claim.

## B7 — `skip-allowlist`

`bun run test:no-skips` exists and allows a small list of skips. Audit it.

1. List every actual `<skipped` in a real run and compare against the allowlist.
2. For each allowed skip, verify the reason is still true — a skip whose precondition has since been
   met is a test that has stopped running.
3. Confirm no skip is allowed that would hide a platform-specific regression on CI (darwin-only skips
   are the interesting case: CI has all three platforms).

Prove: run `bun run test:no-skips`, print the count, and show the allowlist diff.

## B8 — `flake-hunt`

This wave has already produced three flakes: a focus-dependent AX refusal, a mid-edit type error, and
a `Segmentation fault at address 0x11` reported once by a lane. Find the rest before a user does.

1. Run the full suite three times back to back and diff the results.
2. Grep for the classic shapes: a `sleep` used as synchronisation, a test that reads a real clock, a
   test that asserts on process order, a `Bun.spawn` without a timeout, a test that binds a port.
3. For anything found, fix the timing rather than the assertion — poll a condition with a deadline,
   inject a clock, or take a lock.

Own: whatever files you need to fix, plus `docs/agents/flake-hunt.md`. Do **not** delete a test to
make the suite stable; a removed test is a removed check.

Prove: three consecutive runs with identical pass/fail counts, and the red-then-green for each fix.

## Final message

Under 12 lines. Bullets. What you changed, what proved it, what you measured as impossible.
