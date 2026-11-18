# flake-hunt (fix-wave-2, lane B8)

## Baseline

```
cd /Users/jyz/dev/crust && probe-run -c 'bun run test'
```

First three back-to-back runs: `1832 pass / 0 fail` across 300 files. A final three, after sibling
lanes had added tests to the shared tree, were `1850 pass / 0 fail`, `Ran 1850 tests across 303 files`
each time (14.35 s, 15.53 s, 15.02 s); diff of the `pass`/`fail` lines was empty. `bun check`: no type
errors in 807 files. The count moved 1832 → 1850 mid-wave because other lanes were writing new test
files, not because of anything this lane changed.

The suite was wrapped in `probe-run -c` because `scripts/butter-sweep.test.ts` spawns a real AppKit
child with `activate: "always"`; focus must go back to whoever was frontmost.

## Shapes scanned

- `sleep` as synchronisation: `rg -n "sleep|Bun\.sleep|setTimeout" src scripts examples -g '*.test.ts'`.
  Four fixed waits were asserting on state instead of waiting for it.
- Real clock: `rg -n "Date\.now|new Date\(|performance\.now|hrtime" src scripts examples -g '*.test.ts'`.
  All hits are deadline guards or injected timestamps (`os.test.ts:167` compares uptime to wall clock
  from boot with a +1 s tolerance; `sidecar-control.test.ts:72` stamps `startedAt`). No flake.
- Process order / spawn: `Bun.spawn` children in tests either register an `afterEach` kill
  (`runtime-crash-guard.test.ts:25-35`) or carry a 30 s test timeout (`native-setters.test.ts:82`,
  `keychain-live.test.ts:76`). No dangling child found.
- Port binding: every test that binds uses `port: 0` (`updater-fetch.test.ts:18`, `network-probe.ts:127`,
  `bridge/server.ts:69`), so two instances cannot collide. No flake.

## Fixes (timing, not assertions)

| File | Old | New |
| --- | --- | --- |
| `src/bridge/server-guards.test.ts:146` | `Bun.sleep(500)` then `expect(answered)` | `waitFor` on the settled flag, 2 s deadline |
| `src/app-run.test.ts` | `tick()` = `Bun.sleep(600)` | `waitFor` on quit/listener count, or on `windowLabels()` read count |
| `src/app-lifecycle.test.ts` | `ticks()` = `Bun.sleep(220)` | `waitFor` on listener/settle count, or on a `take()` counter |
| `src/app-page-events.test.ts` | `ticks()` = `Bun.sleep(120)` | `waitFor` on page frames + backend listeners + warnings |
| `src/platform/windows/platform-pump.test.ts` | three fixed sleeps asserting "at least N ticks" | `waitFor` on tick/dispatch count, 2 s deadline |

Shared helper: `scripts/harness/wait.ts` — polls a condition every 10 ms until a deadline and throws
with a label on timeout. Each test waits for a positive signal that the mechanism actually ran; the
one "must not fire" case (`app-run.test.ts`) waits for two `windowLabels()` reads before asserting
`closed === 0`, so it can no longer pass because the timer had not started.

## Proof

```
bun docs/reviews/next-wave/probes/flake-red-green.ts
```

Each case schedules its event at 60 ms, past the old 10 ms fixed sleep:
`old RED 4/4, new GREEN 4/4`, exit 0. The probe models the four real patterns against the real
`waitFor` helper.

Targeted: `bun test src/app-run.test.ts src/app-lifecycle.test.ts src/app-page-events.test.ts
src/bridge/server-guards.test.ts src/platform/windows/platform-pump.test.ts` — 31 pass / 0 fail.

## Not fixed

- The `Segmentation fault at address 0x11` was reported once by another lane and did not reproduce in
  three full-suite runs. No evidence to act on; a crash report would be needed.
- The focus-dependent AX refusal is owned by lanes A1-A3 / the harness focus code, not this lane.
- `cli/first-run.test.ts` spawns children without a timeout, but each command exits immediately by
  design; a hung child is a hang risk, not an intermittent wrong answer. Left alone rather than
  adding a timeout that would change what the test measures.
