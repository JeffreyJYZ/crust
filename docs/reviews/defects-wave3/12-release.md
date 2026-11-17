# Release & CI

Area: `scripts/release/`, `scripts/build-standalone.ts`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`.

## Findings

### 1. A failed matrix leg leaves a published, partial release and skips the only verifier — HIGH
`.github/workflows/release.yml:50-59` and `.github/workflows/release.yml:120-122`

`create-release` publishes the release with `gh release create` (no `--draft`/`--prerelease`) before any build leg runs. Each matrix leg uploads its own asset independently, and `verify` has `needs: build`. When any leg fails, the `build` job fails, so `verify` is skipped — but the release created in the first job stays public, already marked "Latest", holding only the assets the surviving legs managed to upload. No step runs on failure to delete, draft, or flag the release.

This is reachable by an ordinary build failure. The repo already lived it: `scripts/release/targets.ts:30-33` records a release job that "died on 'no release target for win32-x64' before it compiled anything" — in that run the release went public with four assets and no verifier.

**Breaks:** A user on the missing platform sees a normal-looking "Latest" release with no binary for their OS, and no signal on the release itself that the build failed. The asset container check compounds this: the only magic validation lives in the downstream `verify` job (`scripts/release/assets.ts:108-118`), so on a partial release *no* uploaded asset's bytes are checked at all — the build job uploads straight from `gh release upload` (`.github/workflows/release.yml:100-114`) with no magic check of its own, and cross-target binaries are never executed (`scripts/build-standalone.ts:180-188`).

**Evidence:** `.github/workflows/release.yml:57` `gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" \` with no draft/prerelease flag; `.github/workflows/release.yml:122` `needs: build`.

### 2. The release gate's test summary can never show real totals — MEDIUM
`scripts/release/gate.ts:19-29` (uses `sh` from `scripts/release/git.ts:31-49`)

The "test" summariser strips ANSI codes and searches `out` for `(\d+)\s+pass` / `(\d+)\s+fail`. `out` comes from `sh()`, which returns **stdout only** (`git.ts:42-48`). `bun test` prints its totals to **stderr**, not stdout — so the regex never matches, `passed` and `failed` stay `"?"`, and the summariser returns `"ran, totals not parsed (exit 0)"`. The dedicated `shAll()` helper (`git.ts:51-61`) that captures both streams exists but is not used here.

The comment at `gate.ts:21-23` states this parsing was added specifically because a past "release log claimed nothing at all about the suite it had just run." The fix does not achieve that: the release log still claims nothing about pass/fail counts.

Verified with `bun test scripts/release/targets.test.ts 2>/dev/null` (stdout only — no totals) versus the same command with stdout discarded (totals present: `6 pass`, `0 fail`, `20 expect() calls`).

**Breaks:** A release log records only "ran, totals not parsed (exit 0)" for the unit suite, so a reviewer cannot see how many tests actually ran or passed from the gate's own summary.

**Evidence:** `gate.ts:36` `const out = await sh([...cmd]);` (stdout only) against `git.ts:48` `return out.trim();` and `git.ts:51` "Same as `sh`, but stdout and stderr together: `bun test` prints its totals to stderr."

## Coverage

Read in full: `scripts/build-standalone.ts`, `scripts/release/{targets,targets.test,assets,verify-assets,gate,git}.ts`, `.github/workflows/{ci,release}.yml`. Read `src/cli/{assets,framework,util,init,doctor}.ts`, `src/cli/doctor/{platform,build-assets,environment}.ts` to cross-check the runtime's reads against the binary's embedded list, and `scripts/release.ts` to confirm the local release script runs the gate before tagging.

- **Embedded asset list checked and complete.** `ASSETS` (`build-standalone.ts:17`) is `src`, `templates`, `tsconfig.json`, `package.json`. Every runtime read at init resolves inside those: `init` and `doctor` read `templates/*`; doctor's shim check and `frameworkRoot` read `src/*`; `frameworkRoot` also reads `tsconfig.json` and `package.json` (`framework.ts:53-67`). The C shim sources travel as compile-time text imports, not `--asset` reads. No gap found — no finding.
- **Version/target drift checked and clean.** `VERSION` comes from `package.json` in `targets.ts:20` and is used by `artifactName`, `assertExpectedVersion`, and `verify-assets`' tag check; the release matrix and `TARGETS` are cross-checked by build failure in either direction. No finding.
- **Considered but not reported:** every windowed e2e in `ci.yml` is gated on the `window session` probe, so a runner without an Aqua session skips them all with only a notice while CI stays green. This is explicitly documented intent (`ci.yml:14-18`), not an accidental hole.
- **Considered but not reported:** `frameworkRoot`'s cache dir `crust-framework-${VERSION}` (`src/cli/framework.ts:46-51`) is keyed only on version, so two builds sharing a version but differing in embedded `src` would reuse stale bytes. This is outside the assigned area (a `src/cli` hunter owns it).
- **Not verified:** the workflows were not executed. All findings are from source plus the one targeted `bun test` run used to confirm finding 2.
