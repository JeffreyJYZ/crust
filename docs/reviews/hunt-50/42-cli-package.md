# `src/cli/` packaging steps — sign, dmg, notarize, package

Read-only hunt. Scope: the four CLI packaging steps and the seams they call, judged on steps that
half-succeed — a stage that returns success (exit 0 / `ok: true`) while leaving the release
incomplete, or that leaves a broken artifact behind when it fails.

**Count: 4 findings** (2 high, 2 medium).

**Worst: F1 — Developer ID sign re-signs only the outer `.app`; nested sidecars stay ad-hoc, the
strict verify still passes, and the sign stage reports green right before notarization rejects the
whole bundle.**

---

## F1 (high, worst) — `signStage` verifies only the outer bundle, so a sidecar-bearing app reports "verified" but can never be notarized

- `src/cli/sign.ts:31-36` — `signApp({ appPath: bundle, mode: "developer-id", identity, hardenedRuntime: true })`. One call, on `bundle` alone; no `--deep`, no per-sidecar loop, no identity passed to nested code.
- `src/cli/sign.ts:39-46` — `verifySignature(bundle)` runs `codesign --verify --strict` on the outer bundle. That check does not recurse into nested Mach-O, so it returns `valid: true` even when the nested executables are ad-hoc. `signStage` then returns 0.
- `src/cli/build.ts:166-171` — the build already signed every `build.sidecars` file under `Contents/MacOS` with `--sign -` (ad-hoc, no hardened runtime). Nothing upgrades those signatures when `--sign` runs later.
- `src/cli/sign.ts:48-55` — the gatekeeper line is printed but does not gate the return: `spctl` refusal still yields exit 0.

**Reached:** config sets `build.sidecars`, then `crust build --sign --notarize --dmg`. The build ad-hoc signs the sidecars; the sign stage re-signs only the outer app, prints "verify passed" and returns 0; the notarize stage then submits a bundle whose nested code is ad-hoc and gets rejected. The failure surfaces only after sign was reported green, so the two stages disagree about whether the app is release-ready. (Also reported in `docs/reviews/hunt-20/10-packaging.md`; still present.)

---

## F2 (high) — `--dmg` builds an undistributable image and reports success; no refusal enforces the documented "signed app" precondition

- `src/cli/build/stages.ts:35-63` — `stageRefusal()` checks `notarize ⇒ sign`, platform for dmg/sign, a signing identity, and notary credentials. It never checks that `dmg` requires `sign` (or `sign + notarize`). Only `hasStages()` at `:67-69` knows dmg was requested.
- `src/cli/help.ts:40` — help promises "build a disk image from the signed app".
- `src/cli/dmg.ts:5-16` — the docstring claims the stage "runs last, after signing and stapling, so the image holds the notarized app", but `dmgStage` prints its lines and returns 0 unconditionally.
- `src/cli/build.ts:171-190` — the plain build ad-hoc signs the app, then hands that same bundle to `runStages`.

**Reached:** `crust build --dmg` (or `--sign --dmg` without `--notarize`) on macOS. Build ad-hoc signs, dmg stage images that bundle, `build()` prints `done — open it locally…` and exits 0. The image contains an app Gatekeeper refuses on every other machine, and the dmg stage emits no warning that the artifact is not distributable. The stage's stated precondition and its actual guard disagree.

---

## F3 (medium) — notarize drops `reason` and the raw tool log on every post-preflight failure, so a local staple failure is printed as "notarize rejected"

- `src/cli/notarize.ts:41-43` — the only output after `notarize()` is `console.log(describeNotarize(result))`.
- `src/packaging/notarize-plan.ts:136-146` — `describeNotarize()` prints `reason`/`requires` only in the `!result.status` branch (preflight refusal). When `status` is present it prints status + id + path + `issues`, and never prints `result.reason` or `result.log`.
- `src/packaging/notarize.ts:124-140` and `:157-166` — every submit failure and every non-submit step failure sets `status` (to the submitted status or `"rejected"`) plus `reason` and `log`, and some set no `issues` at all. Those are exactly the fields the CLI suppresses.

**Reached:** submit is `accepted` but `xcrun stapler staple <app>` exits non-zero (bad ticket, interrupted tool). `notarize()` returns `{ ok: false, status: "rejected", reason: "staple failed (exit N)", log: "<tool output>" }`; `notarizeStage` prints only `notarize rejected  <appPath>`. The user is told Apple rejected the submission, with no hint that the real failure was local stapling and no tool output to fix it. This contradicts the stated intent at `src/packaging/notarize.ts:66` ("without this call the user gets 'invalid' and nothing to fix").

---

## F4 (medium) — dmg fallback leaks a partial image on a double failure and discards the first tool's diagnostic

- `src/packaging/dmg.ts:54-83` — `diskutil image create from` is tried first. Its `catch` removes `dmgPath` then runs `hdiutil create ... -ov ... dmgPath`. If `hdiutil` also fails, `runOrThrow` throws; the `finally` at `:84-88` removes only the staging dir, never `dmgPath`. The diskutil error text is never kept.
- `src/packaging/dmg.ts:90-91` — the only "validation" is `stat(dmgPath).size`; whatever file exists, including a partial one from a failed hdiutil run, is reported as a successful DmgResult.
- `src/cli/dmg.ts:11-16` and `src/cli/package.ts:36-37` — the callers return `ok` from the returned result / unconditionally and do no cleanup of a failed artifact.

**Reached:** on a host where `diskutil image create from` fails (older macOS, deprecated path) and `hdiutil create` then fails partway (e.g. disk full), a partial `dist/<name>-<version>.dmg` is left on disk. The top-level handler reports the failure, but nothing removes the stale image, and a later `crust package`/`crust build --dmg` can overwrite or report that file without any size or format validity check beyond `stat`.
