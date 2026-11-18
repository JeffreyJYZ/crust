# Fix wave, eighth brief: the things nobody has looked at yet

Read `docs/reviews/fix-wave-2/BRIEF.md` for the shared rules. One tree, `rg`/`fd`, foreground builds,
200-line cap (split, never trim), never `bun fmt` without a path list, only your own files.

**Hand focus back when you finish**: wrap anything that launches a GUI app in
`probe-run -c '<command>'`.

A1–A3 and B1–B8 own their areas. These lanes take what every previous wave named in passing and never
looked at directly.

## C1 — `windows-arm-runtime`

Windows arm64 now ships. It has never run crust *doing anything* on arm64 Windows — only
`--version`, because that is what the release workflow proves.

Read `.github/workflows/release.yml` and `.github/workflows/ci.yml` (the `windows` job) and then, in a
temp dir you delete:

1. Write a workflow job that, on `windows-11-arm`, does `crust init`, `bun install`, `crust build`
   and runs the built binary with a trivial page, asserting the window opened and one invoke
   round-tripped. That is the smallest thing that proves the *shim* works on arm64, not just the
   binary format.
2. If a runner for that is not available on every PR, gate it to `workflow_dispatch` plus the
   release tag, and say so in a comment with the reason.
3. Check the parts of the Windows shim that this wave touched for aarch64 assumptions: `34_slots.c`
   `RECT` by value, `36_probe.c`, `42_webview.c`, `48_keychain.c`.

Own: `.github/workflows/**`, and `docs/agents/windows-arm-runtime.md`. Do not touch `src/` unless you
find a concrete arm64 defect — then fix it and say which.

Prove: the workflow YAML parses, and if you can dispatch it, paste the run id and result. If you
cannot dispatch, say exactly that: an unrun job is unproven, and this lane's job is to make the proof
possible rather than to claim it.

## C2 — `extensions-example`

`examples/extensions/` exists and the docs describe the extension API. Nobody has run it in this
wave.

Read it, run it, and check it against `src/extensions/`, `src/packaging/extension-*.ts` and
`site/app/docs/guides/extensions/page.mdx`. Then check the other examples the same way, quickly:
`hello`, `multi-window`, `native`, `vite`, `dogear`, `notes`, `parity-probe` — does each still build
and run with the current API?

Own: `examples/**`, tests beside them, and `docs/agents/examples-audit.md`.

Prove: for each example, the command you ran and its result. An example that does not build is a
defect a new user hits first.

## C3 — `error-messages`

Every error a user can reach should tell them what to do next. This wave fixed the CLI's, and there
are others.

Walk the paths a user actually hits: a config that fails validation, a bridge that cannot bind, a
build with no entry, a missing asset directory, a plugin that throws, a bad capability grant, a
missing frontend dependency, a `crust dev` with no `main.ts`. For each: does the message name the
key, the file, and the fix?

Own: the error sites you improve (likely `src/config/`, `src/cli/`, `src/bridge/server/`,
`src/packaging/`) and tests beside them. Do not change an error *code* — only its message and any
missing context.

Prove: a test per improved message asserting it names the thing.

## C4 — `updater-end-to-end`

The updater is now macOS-only and refuses elsewhere. Nobody has run a real update.

Read `src/plugins/updater*.ts`, `site/app/docs/guides/updater/page.mdx`, and the release guide's
publisher recipe. Then:

1. Write a probe under `docs/reviews/next-wave/probes/` that publishes a fake update (a second
   version with the documented manifest + signature), points the updater at it, and asserts the whole
   chain: check finds it, download verifies the hash and signature, install stages it, relaunch would
   exec it. Stop before actually replacing a running bundle — say where you stopped and why.
2. If a step cannot be driven headlessly, that is a finding: name the step and what it needs.

Own: the probe, plus `src/plugins/updater*.ts` only if the probe finds a defect, and
`docs/agents/updater-e2e.md`.

Prove: the probe's output, and a red case (a manifest with a bad signature must be refused).

## C5 — `measure-refusals`

Every `not-implemented` in the tree is a promise that something genuinely cannot be done. Audit them.

`rg -n 'notImplemented\(|not-implemented' src/` and, for each refusal reachable from a page: is the
reason still true? A refusal written before this wave may now be false (Linux keychain was one). List
each with the file:line, the concept it names, and whether it still holds.

Fix the ones that are now false. For the ones that hold, keep them — and where the message is vague
("not supported"), make it name what would have to exist.

Own: whichever `src/` files hold a false refusal, plus `docs/agents/refusals-audit.md`.

Prove: the count before and after, and a test for each refusal you corrected.

## Final message

Under 12 lines. Bullets. What you found, what you fixed, what remains unproven.
