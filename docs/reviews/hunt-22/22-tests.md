# Hunt 22 — defects in the tests themselves

Every claim below is `read` (source inspection). No build, e2e, GUI app, cursor or
`bun test` run was used; the tree is unchanged apart from this report. Scope is the
490 `*.test.ts` files shipped under `src/`, `examples/` and `scripts/` (the three
`TEST_ROOTS` in `scripts/test-files.ts:16`), plus the gate/harness scripts that decide
which of them run. The three red probes under `docs/reviews/next-wave/probes/` are
deliberately outside the suite and are not findings.

## MEDIUM — the discovery guard never checks the runner it was written to guard

- where: `scripts/test-files.test.ts:23-42`, `scripts/test-all.ts:9-16`, `scripts/check-skips.ts:39-52`
- mechanism: The guard added after hunt-21's "two harness suites went unrun" checks three things: that `package.json`'s `test` script *names* `scripts/test-all.ts` (`:25-27`), that `discoverTests()` itself finds all `*.test.ts` under the roots (`:29-36`), and that two specific harness files are in that discovery (`:38-42`). It never reads `test-all.ts` and never compares a JUnit suite list to discovery. `check-skips.ts` only extracts `<skipped>` testcase names; it has no notion of an expected file set. So the actual wiring — `test-all.ts:9-10` handing the discovered list to `bun test` — is the one link with no assertion.
- reachable by: `read` — edit `scripts/test-all.ts:10` to pass a hand-written list, a single directory, or to drop one discovered file before the spawn. `test-files.test.ts` still passes (it calls `discoverTests()` directly and reads only `package.json`), `check-skips.ts` still prints "no unapproved skips", and `bun run test` goes green while a whole suite never runs. That is exactly the regression the guard's own header says it exists to prevent, reintroduced through the unguarded link.
- smallest fix: have `test-all.ts` export the computed `files` and assert in `test-files.test.ts` that the module's spawn argv equals `["test", ...await discoverTests()]`; or add a JUnit suite-file check to `test:no-skips` that fails when a discovered file has no `<testsuite>`.
- evidence: `read` — full bodies of all three files and the import list at `test-files.test.ts:6-9` (no import of `test-all.ts`).

## MEDIUM — the release gate's own test pins 2 of its 4 steps and cannot see a failed step

- where: `scripts/release/gate.test.ts:10-46`, `scripts/release/gate.ts:11-45`, `scripts/release.ts:53-54`
- mechanism: `gate.ts` runs four `SUMMARIES` steps — `bun check`, `bun run test`, `bun run verify:package`, `bun run skill:check` (`:11-45`). The test asserts only two calls: `"shAll bun run test"` (`gate.test.ts:36`) and `"shAll bun run skill:check"` (`:45`). `bun check` and `verify:package` are never asserted, so removing either from `SUMMARIES` leaves the gate test green. Separately, the mock defines `fail()` as pushing a `FAIL <label>` step (`:24-27`) but no test asserts on `steps` after a throw; `failureCount: () => 0` (`:27`) is unused by `gate.ts` (which imports only `fail, shAll, step`) and the real abort at `release.ts:53-54` has no test anywhere (`rg failureCount scripts` finds only the mock and the three production files). The one behaviour that matters most — a failed gate step stopping a release — is untested.
- reachable by: `read` — delete the `verify:package` row from `gate.ts:31-38`, the exact step that caught 0.2.14's uninstallable CLI (documented at `gate.ts:32-34` and in `crust/AGENTS.md`). `gate.test.ts` still passes, the release script still runs its gate, and CI's release job has no equivalent local assertion. Equivalently, make any `shAll` throw: `gate()` records a `FAIL` step, but no test notices and `failureCount()` is mocked to 0.
- smallest fix: assert the full ordered list of four `shAll` calls (or pin `SUMMARIES` by label), and add a case where `shAll` throws for one label that asserts `steps` contains `FAIL <label>` and that `failureCount()` rises.
- evidence: `read` — both full files plus `rg -n 'failureCount|gate\(\)|SUMMARIES' scripts/`.

## LOW — `rejects.toBeDefined()` passes on any error, including a typo in the test's own helper

- where: `src/plugins/fs.test.ts:106`, `src/plugins/fs-scope-grants.test.ts:62`
- mechanism: Both assert only that a promise rejected. The `call()` helpers in these files throw `new Error("no command <name>")` when a command name is misspelled (`fs-scope-tamper.test.ts:43-45` shows the same helper shape), so a typo in the *test* is accepted as proof of the product's refusal. The intended codes are available and used by sibling assertions in the same files: `fs.test.ts:94,108-110` uses `rejects.toMatchObject({ code: "not-found" })`, and `fs-scope-grants.test.ts:54-57,72-74` uses `rejects.toMatchObject({ code: "outside-scope", message: expect.stringContaining(...) })`. For `fs.test.ts:106` the thrown error is a raw Node `ENOTEMPTY` (`fs.ts:180` → `attempt()` at `:91-94`, which only translates `ENOENT`), so `crust:fs` error-code discipline is also left unpinned.
- reachable by: `read` — change `"remove"` to `"remov"` in `fs.test.ts:106`, or make `scopeAllow` throw a `TypeError` instead of `CrustError("outside-scope")`; both tests still pass. The next assertion in each test partially covers the state change, but not the error contract these lines claim to check.
- smallest fix: `rejects.toMatchObject({ code: "ENOTEMPTY" })` at `fs.test.ts:106` and `{ code: "outside-scope" }` at `fs-scope-grants.test.ts:62`.
- note: `read`. Both tests remain meaningful overall; the finding is that these two specific assertions are unable to fail for the reason their names give.

## LOW — `commands.test.ts` passes vacuously if the command table is emptied

- where: `src/cli/commands.test.ts:7-23`
- mechanism: All three loops iterate the two tables under test (`Object.keys(COMMANDS)` at `:10,19`, `cli.commands` at `:15`), and `:11` compares `registered.length` to `Object.keys(COMMANDS).length` — two values derived from the same tables. With both tables empty, `:10` and `:19` iterate zero times, `:11` evaluates `0 === 0`, and `:15` iterates zero times. `:20-22` only checks negative cases (`isCommand("nope")`, `isCommand("toString")`), which also pass. No assertion anywhere in the test tree requires a non-empty `COMMANDS`: `rg -n 'COMMANDS' src/cli -g '*.test.ts'` returns only this file.
- reachable by: `read` — a refactor that stops populating `COMMANDS` (or `cli.commands`) makes the entire "command table" suite green with zero checks, even though the CLI has no commands. `cli-contract.test.ts` would catch it later through its named rows, but that is a different suite and not what this one claims to prove.
- smallest fix: add `expect(registered.length).toBeGreaterThan(0)` and one positive literal assertion such as `expect(isCommand("init")).toBe(true)`.
- note: `read`. The repo generally guards this trap (`src/cli/assets.test.ts:28`, `src/runtime-feature-plugins.test.ts:69`, `scripts/docs-reference.test.ts:63` all assert `> 0` before a loop), which makes this omission anomalous.

## LOW — `waitFor`'s honesty test checks `waitedMs` only from below

- where: `src/plugins/testing-honesty.test.ts:36-43`, `src/plugins/testing-observe.ts:49-55`
- mechanism: `waitedMs` is `Math.round(performance.now() - started)` at the success return. The test asserts `waited >= elapsed - 12`, which catches the documented bug (reporting a constant per-poll allowance, i.e. under-reporting) but not the opposite lie. A regression that returns the configured `timeoutMs` (500 here) or any inflated number passes, because there is no upper bound relative to the measured wall time.
- reachable by: `read` — change `testing-observe.ts:55` to `waitedMs: timeout`; `elapsed` is ~60 ms, `500 >= 48`, test passes. The test's own title ("the wall time spent, not the configured budget") would then be false.
- smallest fix: add `expect(waited).toBeLessThanOrEqual(elapsed + 12)` so the field must actually track the clock in both directions.
- note: `read`. The runner fixture really sleeps 30 ms per probe, so the lower bound is otherwise sound.

## LOW — reap tests leak their stubborn child and scratch dir when an assertion fails

- where: `src/plugins/shell-reap.test.ts:109-122`, `src/plugins/sidecar-reap.test.ts:129-142`
- mechanism: Each test stages a real child whose command is `trap '' TERM; exec sleep 60` (`shell-reap.test.ts:23-24`), then asserts `gone(pid)` and only afterwards calls `rm(dir, ...)`. There is no `finally`: a failed `gone()` assertion, or a throw from `ended()` (8 s timeout at `:103-106` / `:123-126`), skips both the directory cleanup and any attempt to kill the recorded PID. A red run leaves a 60-second orphan reparented to launchd — the exact class of process these tests exist to prevent — plus a temp dir. `gone()` polls `process.kill(pid, 0)`, which is also true for a zombie and, after reaping, could match a reused PID within its 5 s budget.
- reachable by: `read` — any assertion failure in the four tests, e.g. a slow CI runner delaying reap past the 5 s budget. The harness's `afterEach` in these files does not cover these children (it covers a different `started` list in `runtime-plugins.test.ts`, not here).
- smallest fix: wrap each body in `try/finally`, call `process.kill(pid, "SIGKILL")` and `rm(dir, { recursive: true, force: true })` in the finally, and assert the cleanup as part of the gate (the repo's "every probe must prove it left no process behind" rule).
- note: `read`. On a green run the cleanup happens; the defect is on the failure path that a flaky test would take.

## LOW — a 10 ms grace timer is proved with a single 40 ms real-time window

- where: `src/plugins/sidecar-control.test.ts:111-120`
- mechanism: `killGraceMs: 10` schedules the SIGKILL escalation; the test calls `await tick(40)` where `tick` is a real `setTimeout` (`:43`) and then expects `stubborn.signals` to equal `["SIGTERM", "SIGKILL"]`. Under event-loop contention — the repo has an `eventLoopDelayP95` metric precisely because this host gets loaded — a >40 ms stall before the grace timer fires produces `["SIGTERM"]` and a false failure unrelated to the code. Other tests in the repo deliberately stub timers for this reason (e.g. `src/platform/darwin/pump-cadence.test.ts:1-5,17-26`).
- reachable by: `read` — run this suite while sibling builds saturate the cores; the assertion is a single fixed deadline, not a poll with a budget.
- smallest fix: inject a fake timer for `killGraceMs` and drive it from the test, or poll `stubborn.signals` until SIGKILL appears with a `Date.now()` deadline of a few seconds.
- note: `read`. Not reproducible here without a load probe; reported as a flake risk from the assertion shape, not a measured failure.

## LOW — `isEmbedded()` assertion tests the process type, not the code path

- where: `src/cli/assets.test.ts:48-55`
- mechanism: The comment states "A test process is not a compiled executable, so nothing is embedded", then asserts `isEmbedded(...)` is `false`. Given the fixture (a `bun test` process), the expected value is fixed by the environment; the assertion cannot change unless the process is replaced. The compiled/embedded path — the one with a possible bug — is explicitly out of scope ("proved by `bun build --compile --asset` in CI terms"), and `bun run verify:package` runs `crust --help` from the installed tarball, which exercises the branch only incidentally.
- reachable by: `read` — any edit to the embedding logic that only affects compiled executables leaves this test green; conversely the test fails only if the runner itself changes. It is a tautology over its fixture rather than a behaviour check.
- smallest fix: either drop the assertion and keep the comment as a note, or move the proof into `verify:package` with an explicit assertion that an embedded asset is read from the binary.
- note: `read`.

## Checked and clean

- **Test discovery itself**: `read` — `scripts/test-files.ts:11-35` walks from three fixed roots with an independent `SKIP` set; `scripts/test-files.test.ts:12-21` re-implements the walk independently so a shared bug cannot hide an omission, and `:34` asserts the walk is non-empty. The only weakness is the runner wiring, reported above.
- **Env restoration**: `read` — every `process.env` mutation found by `rg -n 'process\.env\.[A-Z_]+\s*=' -g '*.test.ts'` is inside a `try/finally` or file-level `afterEach`: `src/logging/level.test.ts:11-14`, `src/vite.test.ts:11-16`, `src/bridge/dev-label-token.test.ts:40-45`, `src/vite-fs-deny.test.ts:16-20`, `src/plugins/window-frame-memory.test.ts:163-181`, `src/plugins/stronghold-legacy.test.ts:19-25`, `src/plugins/store.test.ts:129-136`, `src/runtime-plugins.test.ts:60-77`, `src/runtime-plugins-vault.test.ts:76,113`. No cross-file env leak found.
- **Global stubs restored**: `read` — `src/platform/darwin/pump-cadence.test.ts:17-41` restores `setTimeout`/`clearTimeout` in `finally`; `src/vite.test.ts:58-66` restores `globalThis.fetch` in `finally`; no unmatched monkeypatch in the timing files checked.
- **Probe / guard / focus harness**: `read` — `scripts/harness/probe.test.ts:24-47` asserts the kill's `code === null` and the clean `code === 0` as two separate cases; `scripts/harness/guard.test.ts:78-187` injects both the command runner and the signal wiring and checks capture-once, re-raise, fallback and no-op-off-macOS. No unexercised assertion found.
- **Source-text pins**: `read` — `src/platform/windows/slots.test.ts:54-81`, `scripts/e2e-detail.test.ts:15-31`, `scripts/check-links.test.ts:30-33`, `scripts/release/release-workflow.test.ts:21-48` all pin source text where runtime proof needs a Windows runner, an Aqua session or a GitHub workflow. They are brittle by design but their regexes have positive and negative cases; I did not find one that matches only a comment or a fallback branch. `slots.test.ts:63`'s conditional `toContain` is redundant (`slotOf` returning -1 would fail `:64` anyway), not a gap.
- **Updater integrity / archive bounds**: `read` — `src/plugins/updater-hunt21-integrity.test.ts:39-143` covers unsigned refusal, key canonicalisation, declared-size cap, inflated-size cap, symlink descent, symlink cycle and feed cap, each with a concrete expected code or message; `src/plugins/updater-install.test.ts:39-118` checks refusal leaves the original marker untouched. No weak assertion beyond the two `stat(...).resolves.toBeDefined()` "the file still exists" checks, which are the correct claim there.
- **CLI contract rows**: `read` — `src/cli/cli-contract.test.ts:42-69` spawns the real entry per row and pins exit code plus positive/negative stdout/stderr; the conditional `outEmpty`/`errEmpty` at `:63-64` are flags set by the row table, so they are not silent skips.
- **Concurrency fixtures**: `read` — `src/plugins/stronghold-concurrency.test.ts:40-110` opens both instances before the concurrent writes and verifies through a fresh third instance plus the on-disk file, so sequential interleaving still exposes the stale-snapshot bug. `src/plugins/testing-eval-queue.test.ts:21-74` drives ids and completions deterministically rather than by timing.
- **Tautology sweep**: `read` — `rg --pcre2 'expect\((\w+)\)\.to(?:Be|Equal|StrictEqual)\(\1\)'` over all test files finds only the two platform-guard `expect(true).toBe(true)` at `src/bridge/typed.test.ts:53` and `src/plugins/testing-live.test.ts:54`; both are non-darwin early returns whose real proof is the `@ts-expect-error` cases / the darwin-only body, not a missed assertion. No `.only`, no `test.each([])`, no empty catch block, no bare `rejects.toThrow()` used as the sole assertion on a security path.
