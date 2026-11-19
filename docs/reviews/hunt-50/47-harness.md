# `scripts/harness/` + `scripts/e2e*.ts` hunt — 47

Scope: `scripts/harness/*.ts` and `scripts/e2e*.ts`, read-only source inspection with `rg`/`fd`
only. Question asked: which tests pass for the wrong reason. Nothing was launched, no cursor moved,
no suite run. All claims below are from `read` of the cited lines.

## Count

**8 findings**: 1 HIGH (detector), 1 HIGH (cleanup assertion), 3 MEDIUM, 3 LOW. Worst first.

## HIGH (green detector, unarmed probe) — comments count as arming, and the enforcement test blesses it

- where: `scripts/harness/focus-callers.ts:137-143` (`isArmed`), `:146-149` (`unarmedReason`),
  `:152-154` (`fixMessage`). The asymmetry: `unarmedReason` passes `stripComments(text)` to
  `canTakeScreen` (`:147`) but the raw `text` to `isArmed` (`:148`). `isArmed` is three
  `text.includes(...)` checks, so a comment satisfies it.
- mechanism: a file is "armed" if the string `guardFocus()`, `captureFrontmost()`+`restoreFocus(`,
  or `probe-run` appears **anywhere**, including prose. `fixMessage()` at `:153` itself contains
  both `probe-run -c` and `guardFocus()` — the text of the fix is itself an arming token. The unit
  test encodes the wrong reason as expected behaviour: `scripts/harness/focus-enforce.test.ts:56`
  asserts `isArmed("// run under probe-run -c") === true`.
- reachable by: any probe-shaped file (`probe*.ts`, `*.probe.ts`, `.*.ts` at the root, or any `.ts`
  under `examples/`, `research/`, `spike/` — `focus-callers.ts:176-187`) that contains a real launch
  matching a `SCREEN_RULES` entry (`:103-121`) and a comment containing one of those strings.
  Concrete case: copy the failure hint from `fixMessage()` into a comment instead of adding the
  guard. `findUnarmed()` (`:190-197`) returns no failure for that file, and the tree-clean assertion
  at `focus-enforce.test.ts:89` (`expect(await findUnarmed(REPO)).toEqual([])`) passes green while
  an unarmed screen-taking probe is in the tree. The detector exists precisely to catch that case
  (`:2-6`), so the test passes for the opposite of its stated reason.
- smallest fix: strip comments in `unarmedReason` before both calls, and change
  `focus-enforce.test.ts:56` to expect `false` for a comment-only mention; if a literal `probe-run`
  comment must stay accepted, require it in an actual `probe-run -c` invocation, not prose.

## HIGH (false PASS on cleanup) — "mount clear" passes when no mount was ever observed

- where: `scripts/e2e-package.ts:35-43` (`mountedAt`, `leftMounted`, the verdict), fed by
  `scripts/package/hdiutil.ts:19,22-30` and `:102-107`, set at
  `scripts/package/phases/mount.ts:25-27`.
- mechanism: `leftMounted = mountedAt !== null && await isMounted(mountedAt)` (e2e-package.ts:36).
  `mountedAt` is only set by `recordAttachment(attachment)` (hdiutil.ts:22-25), and mount.ts:25-27
  passes `undefined` whenever `hdiutil attach` exits non-zero **or** its table cannot be parsed.
  In that case `mountPointSeen()` is `null`, so `leftMounted` is `false` without a single `mount`
  lookup, and the verdict prints `"nothing from the image remains mounted"` (e2e-package.ts:42).
  The cleanup path has the same hole: `detachLeftover()` returns immediately when
  `attachment === undefined` (hdiutil.ts:103), so it never calls `isMounted` or `hdiutil info`.
- reachable by: a run where `hdiutil attach` mounts the image but prints a table shape
  `parseAttachment` does not recognise (or exits non-zero after mounting). The "attach" check in
  mount.ts:28-36 goes FAIL, so the run is red overall, but the closing "mount clear" line reads
  PASS on no evidence and a real volume is left on the user's desktop. The PASS is a claim the code
  never checked.
- smallest fix: make "mount clear" FAIL when no mount point was recorded, or check the image path
  itself (`hdiutil info`) instead of depending on a successfully parsed attachment.

## MEDIUM — "exit 0" passes for a child that never printed its proving line

- where: `scripts/harness/probe.ts:111-117` (`exited`), `:124` (`Promise.race`), `:137-138`
  (`ended = "exit"`); callers `scripts/e2e.ts:131`, `scripts/e2e-parity.ts:128`,
  `scripts/e2e-native.ts:127`, `scripts/e2e-dev.ts:85`.
- mechanism: when `child.exited` wins the race, `code = status` and `matched` stays `null`.
  `probe()` only nulls the code when `timedOut` (`:159`). Each caller asserts `run.code === 0`
  alone, so a child that exits 0 before producing the greet/summary/bridge answer gets a PASS on
  "exit 0". The separate evidence check fails, so the run is red, but the exit line is a false
  claim about a working app.
- reachable by: any early clean exit — e.g. a built binary that returns 0 because a window could
  not open, or `crust dev` exiting 0 before the page loads.
- smallest fix: require `run.matched !== null && !run.timedOut` for the "exit 0" verdict, or have
  `probe()` return `code: null` whenever `ended !== "match"` and the match was required.

## MEDIUM — `restoreFocusVerified` claims a verified restore off macOS with zero reads

- where: `scripts/harness/focus.ts:97-114`, specifically the early return at `:103`.
- mechanism: `await restoreFocus(target)` is a no-op off darwin (`:84`), then
  `if (platform !== "darwin") return { restored: true }` returns success without a single
  `captureFrontmost()` read. The name `restored` and the doc at `:5` promise a read-back.
  `scripts/harness/focus.test.ts` covers capture/restore off-macOS at `:56-61` and `:87-92` but has
  no case for `restoreFocusVerified` off-macOS, so the hole is untested.
- reachable by: `makeFocus(runner, "linux").restoreFocusVerified("Brave")`; a caller gating on
  `restored` (as `src/platform/darwin/native-setters.test.ts:39-41` does) gets a pass it never
  measured.
- smallest fix: return `{ restored: false, actual: undefined }` off darwin, or rename the field to
  `applicable` for that branch.

## MEDIUM — "verified restore" test relies on a queued-result runner that cannot fail open

- where: `scripts/harness/focus.test.ts:106-118` (poll test), `:17-26` (`recorder`).
- mechanism: `recorder` throws when its queue is exhausted (`:22`), so if `restoreFocusVerified`
  stopped calling `captureFrontmost()` entirely, `calls` would be shorter and the test fails —
  that part is sound. The gap is that no test supplies a runner whose `open -a` **fails** while the
  read-back still matches: `restoreFocusVerified` ignores the result of `restoreFocus(target)`
  (focus.ts:102) and can return `restored: true` even when the activation command failed but some
  other app happens to be frontmost with the wanted name.
- reachable by: an app whose name matches the saved target (or the Ghostty fallback) is already
  frontmost; `open -a` fails, the first poll reads that name, and the function reports success.
- smallest fix: have `restoreFocus` return its `CommandResult` and require `code === 0` in
  `restoreFocusVerified` before accepting a matching read-back.

## LOW — zero assertions are a green report

- where: `scripts/harness/verdict.ts:28-34` (`report`).
- mechanism: `gaps.length === 0` returns 0 even when `total === 0`, printing `PASS 0/0`.
- reachable by: any script that calls `report()` before adding a check. Current e2e scripts all add
  at least one failing check on early exit via `skip()` (`scripts/lib/text.ts:24-27`), so this is
  latent, not observed.
- smallest fix: treat `total === 0` as a failure in `report()`.

## LOW — Linux unit check accepts "0 pass" and any stray "N pass" in the transcript

- where: `scripts/e2e-linux.ts:54` (`UNIT_PASS = /(\d+) pass/`), `:132-139`.
- mechanism: the regex is unanchored and has no lower bound; `unit.code === 0 && unitPass !==
  undefined` passes for `0 pass` or for a transcript line that mentions a test name containing
  "pass".
- reachable by: a `bun test` that collects no tests and exits 0, or a fixture printing "N pass"
  to stdout.
- smallest fix: anchor the summary (`/^(\d+) pass/m`) and require the count to be positive.

## LOW — "reported" passes on a `THREW` line

- where: `scripts/e2e-notify.ts:112-121`; fixture at `scripts/notify/fixture.ts:21-23`.
- mechanism: the page writes `THREW <message>` when `invoke` throws. `reported` is the first line
  containing the `page` prefix, and the check is only `reported !== ""`, so a thrown invoke passes
  "reported". The later "delivered" check (e2e-notify.ts:126-139) goes FAIL, so the run is red,
  but the intermediate line is a false PASS.
- reachable by: any exception from `window.crust.invoke("notification", "notify", …)`.
- smallest fix: assert the reported line does not start with `THREW` before marking "reported" green.
