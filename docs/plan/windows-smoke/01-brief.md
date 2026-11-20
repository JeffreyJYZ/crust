# windows:smoke flaked twice in one day, two different ways

## Evidence

`gate (windows)` step 7 `real WebView2 smoke`, on `main`, both green after a rerun:

```
44754520437   FAIL  pump          0 PeekMessageW messages dispatched over 8 pump slices in 120 ms
44756585686   FAIL  window        WebView2 controller failed for "smoke"
                                (… controller callback 0x80004004, environment callback 0x0, …)
              windows:smoke: FAIL  1 of 5 assertions  57.3s
```

`44756585686` was `e03e694`, a workflow-only change; `44754520437` was a SKILL.md edit. Neither touches
the Windows platform, the pump, or WebView2, and both passed on rerun — so the harness is red on main
at random, which is worse than a red gate: it trains people to rerun instead of read.

## What to find out

Two questions, in this order.

1. **Is either failure a real product defect?** `E_ABORT` from `CreateCoreWebView2Controller` is what a
   WebView2 runtime returns when the request is cancelled — commonly because the environment or the
   window is being torn down while creation is in flight, or because a previous instance in the same
   process still holds the user data folder. If `scripts/windows-smoke.ts` or `src/platform/windows/**`
   can reach that state honestly (quit during creation, a second app in one process, a reused data
   folder), that is a defect to fix, not a flake to retry.
2. **Is the pump sample too tight?** `0 messages over 8 slices in 120 ms` on a loaded runner can be
   true of a perfectly live pump — `PeekMessageW` returning FALSE means idle, and a fresh window with
   nothing queued has nothing to dispatch. If the assertion cannot tell "idle" from "dead", it is
   measuring the wrong thing.

## Fix rule

- A retry is allowed **only** where the cause is environmental and named in a comment — a cold WebView2
  runtime that answers `E_ABORT` before its first controller, for instance. Never wrap the whole smoke.
- If the pump assertion is wrong, replace it with one that proves liveness: post a message and observe
  it dispatched, or assert the pump advances while a message is queued. A sleep that hopes for traffic
  is not a proof.
- Keep the failure output naming the reason. The `E_ABORT` line is already good; do not lose it.

## Prove

Run the real workflow on your branch, repeatedly — at least three consecutive runs — and report the
run URLs and the smoke's own line for each. One green run proves nothing about a 2-in-10 flake. If a
failure reproduces, keep the log excerpt that shows it.

## Constraints

- Own `scripts/windows-smoke.ts`, `src/platform/windows/**` only if the diagnosis demands a product fix,
  and the brief. Nothing else.
- `rg`/`fd` only, `sd` never `sed`, no `bun fmt` without a path list, 200-line cap (split, never trim).
- Push as `jyzbot`, open a PR, do not merge it and do not force-push.
- `bun run test`, `bun check`, `bun run check:lines` before you push. Report under 12 lines.

## Findings (2026-11-20)

**1. Neither failure was a reachable product defect, and the evidence is in the log line itself.**

- `environment callback 0x0` on the `E_ABORT` line excludes the held-user-data-folder cause: a folder
  another process owns fails `CreateCoreWebView2EnvironmentWithOptions`, which is the *environment*
  callback, and this one answered `S_OK`.
- The other documented cause of `E_ABORT` is a parent window destroyed mid-creation — `window-open.ts`
  creates the window and calls the controller inside one synchronous call, and the smoke destroys
  nothing before it.
- So the remaining cause is the runtime aborting its own controller while its browser process was
  still coming up, which is environmental and is now the only thing retried: once, and only when the
  text is `WebView2 controller failed` + `controller callback 0x80004004` + `environment callback 0x0`
  (`scripts/windows/cold-abort.ts`, `cold-abort.test.ts`). Every other refusal is still a finding.
- The user-data folder is also emptied before each run, so "a folder the last run left behind" is
  provably not the state under test (`scripts/windows/user-data.ts`).

**2. The pump assertion could not tell idle from dead, so it was replaced rather than relaxed.** A
fresh window with an empty queue and a dead pump answer identically — `PeekMessageW` returning FALSE
*is* an idle pump, and 8 slices in 120 ms with 0 messages is exactly as consistent with a healthy pump
as with a broken one. The smoke now posts one `WM_NULL` itself (`shim_window_post_null`, added to the
shim's window table) and asserts a slice dispatched it, counted from before the post so earlier traffic
cannot answer for it (`scripts/windows/pump.ts`, `pump.test.ts`). A stub cannot pass it, and an idle
queue cannot fail it.

**Left out on purpose:** no retry wraps the smoke, no sleep grew, and the `E_ABORT` line is still
printed verbatim on both attempts.

