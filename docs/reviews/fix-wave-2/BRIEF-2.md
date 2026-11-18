# Fix wave, second brief: lanes F6–F10

Same shared rules as `docs/reviews/fix-wave-2/BRIEF.md`. Read that file first. One tree, `rg`/`fd`,
foreground builds, never `bun fmt` without paths, 200-line cap, quotes over numbers, only your own
files, report what you do not fix.

Lanes F1–F5 already own: the bridge capability model, `src/plugins/updater*`,
`src/plugins/shell-env.ts`, `package.json`, the darwin C shim, `src/cli/build.ts`,
`src/packaging/build.ts`, svelte/vue dev, and `site/app/docs/**`. Do not touch any of those.

## Lane F6 — `fix-platform-wiring`

Read `docs/reviews/next-wave/platform-gaps.md`.

1. `linuxScreenAdapter` and `windowsScreenAdapter` exist and their shims compile, but the non-darwin
   branch never imports them — so `screen.list` refuses on Linux and Windows for want of an import,
   not a capability. Own: `src/runtime-screen.ts` (or wherever the adapter is selected) and
   `src/runtime-plugins.ts`.
2. Seventeen darwin-only plugin names are unregistered on Linux and Windows, so a page calling them
   gets `unknown-plugin` instead of `not-implemented`. Register them so the refusal names the
   concept, the way `define.ts` already does for others. Own: `src/runtime-plugins.ts`, the
   `src/runtime-*.ts` files that build those plugin sets.
3. Windows `keychain.list` is `not-implemented` for want of `CredEnumerateW`, and `CredFree` is
   already resolved in the same unit. Bind it. Own: `src/platform/windows/keychain*.ts`,
   `src/platform/windows/shim/48_keychain.c` — but note lane F3 also edits that file for the
   access-denied path, so make your keychain edit additive and re-read the file before you write.

If Linux keychain (libsecret) turns out to be a project rather than a binding, say so with the
evidence and leave it refused.

Prove: a test per platform arm that the plugin set contains the name and the refusal is
`not-implemented`, not absent. Windows and Linux code cannot run here, so the test is on the
selection logic, not the OS.

## Lane F7 — `fix-accessibility-i18n`

Read `docs/reviews/next-wave/accessibility-and-i18n.md`.

1. RTL: the templates hardcode `lang="en"` and nothing binds `dir`/`lang` to the configured locale.
2. Plurals collapse `zero/two/few/many` into `_other` (measured on Arabic).
3. `i18n.locale` reports the system language while `translate` uses the configured one — two answers
   to one question.

Own: `src/plugins/i18n*.ts`, `src/plugins/accessibility*.ts`, `templates/*/index.html`,
`templates/*/src/**` for the `lang`/`dir` attribute only, and tests beside them. Do not restructure
a template; add the attribute binding and nothing else. Do not touch `site/`.

Prove: a test per fix — a plural table with Arabic counts; a locale test where the configured and
system language differ; a template test that `lang` and `dir` come from the config.

## Lane F8 — `fix-hollow-tests`

Read `docs/reviews/next-wave/test-quality.md` findings 2 and 3.

1. `scripts/release/targets.test.ts:18-22` rebuilds its expected key with the same conditional
   `hostTarget()` uses, so on darwin the branch never runs and the test duplicates the one above it.
   Make it assert a fixed table instead of recomputing the answer.
2. `src/packaging/extension-bindings-abi.test.ts:85` and `src/platform/darwin/screen.test.ts:41`
   `return` before any `expect` when a tool or screen is absent — bun reports those as passes with
   zero assertions. A skip must say it skipped, not pass.

Own: those files and any test in `src/**` or `scripts/**` with the same shape you find while there.
Do not change production code to make a test pass; if a test reveals a real defect, report it.

Prove: each repaired test is red when the thing it names is broken — show the red once, then leave
it green.

## Lane F9 — `fix-binary-size`

Read `docs/reviews/next-wave/perf.md`.

The measured binary is 86.18 MiB against a documented 85.27 MiB, and the report says the existing AOT
branch is the lever. Evaluate that branch honestly: build with and without, measure both, and take
the smaller only if the gate stays green and the built app still runs (`bun run e2e:package`).

Own: `scripts/build-standalone.ts`, `src/packaging/build.ts` — coordinate by re-reading before you
write, since lane F4 also edits that file for sidecars.

Do not edit `site/` — the perf numbers on the docs page belong to lane F5. Report the numbers you
measured so F5 can use them.

If AOT costs more than it saves, say so and change nothing: a measured "not worth it" is a result.

Prove: the measured size before and after, `bun run e2e:package` 22/22, and `bun run test` green.

## Final message

Under 12 lines. Bullets. What changed, what proved it, what you did not fix.
