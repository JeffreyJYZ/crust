# Hunt 22 — packaging (`sign`, `dmg`, `notarize`, `appimage`, `nsis`)

Read-only review. No source files changed. Findings are reachable states, not hypotheticals.
External claims are cited from Apple's notarization docs, the local `codesign` man page, and NSIS
references where the local code alone cannot settle the question.

## New findings

### 1. High — Developer ID re-sign leaves every sidecar ad-hoc signed, so notarization rejects the bundle

- where: `src/cli/build/sign-adhoc.ts:18-28` (ad-hoc sidecar loop), `src/cli/sign.ts:35-41` (Developer ID stage), `src/packaging/sign.ts:64-86` (the `codesign` argv), `src/cli/build/single-app.ts:76-83` (same path for single-file builds).
- mechanism: the plain build signs each `build.sidecars` file with `codesign --force --sign - --timestamp=none`, then signs the `.app` ad-hoc. The `--sign` stage re-signs only `appPath` with the Developer ID identity. `signApp` never passes `--deep` and never signs the sidecars again. `codesign(1)` is explicit: "Code nested within bundle directories must already be signed or the signing operation will fail, unless the `--deep` option is given … If the `--force` option is given, any existing top-level signature is replaced … Combining the `--force` and `--deep` options results in forcible replacement of all signatures within the target bundle." An already-signed nested sidecar therefore keeps its ad-hoc signature (`Signature=adhoc`, `TeamIdentifier=not set`) while the outer bundle becomes Developer ID. Apple's [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues) names the failure: "The binary is not signed with a valid Developer ID certificate." — the same string crust's own fixture uses at `src/packaging/notarize.test.ts:9`.
- reachable by: any app with `build.sidecars` and `crust build --sign --notarize` on a machine with a Developer ID certificate. `codesign --verify --strict` on the outer bundle still passes (finding 3), so the build prints a green verify line and only the notary service reports the nested rejections.
- evidence: `src/cli/build/sign-adhoc.ts:20-23` hardcodes `--sign -`; `src/cli/sign.ts:35-41` passes only `appPath: bundle`; `src/packaging/sign.ts:64-86` builds one `codesign` invocation with no sidecar loop and no `--deep`; local `man codesign` lines 495-509 quoted above.
- smallest fix: in `signStage`, sign the declared sidecars with the same Developer ID identity, hardened-runtime options and entitlements before sealing the bundle, using `config.build?.sidecars`; do not rely on `--force` at the bundle level to reach nested code.

### 2. High — Developer ID signature has no secure timestamp, another guaranteed notarization rejection

- where: `src/packaging/sign.ts:64-67`.
- mechanism: `--timestamp=none` is added only for `mode === "adhoc"`. For `developer-id` no `--timestamp` is passed at all. `codesign(1)`: "If this option is not given at all, a system-specific default behavior is invoked. This may result in some but not all code signatures being timestamped." Apple's [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues), "Include a secure timestamp": "By default, Xcode doesn't include a secure timestamp … If you use a custom export process, notarization might fail with the following message: `The signature does not include a secure timestamp.` … be sure to add a secure timestamp … by using the option directly with the `codesign` utility if you sign manually." That is exactly the message in crust's own notary fixture at `src/packaging/notarize.test.ts:10`. `crust build --sign` is a manual `codesign` workflow, so the documented failure applies.
- reachable by: every `crust build --sign` invocation; with `--notarize`, notarytool returns `invalid` and the issues contain the secure-timestamp line.
- evidence: `src/packaging/sign.ts:65-67` (`if (mode === "adhoc") args.push("--timestamp=none")` and nothing else), local `man codesign` lines 418-431, Apple doc quoted above. No test asserts the `signApp` argv at all — `src/packaging/sign.test.ts` tests only entitlement strings.
- smallest fix: add `--timestamp` (default Apple server) whenever `mode === "developer-id"`. Leave `--timestamp=none` for ad-hoc. Add a test that asserts the identity path's argv contains `--timestamp`.

### 3. Medium — `codesign --verify --strict` lacks `--deep`, so the green verify line says nothing about nested code

- where: `src/packaging/verify.ts:19-21`, called from `src/cli/sign.ts:44-51`.
- mechanism: `verifyCommand` returns `["codesign", "--verify", "--strict", "--verbose=4", appPath]`. Without `--deep`, nested code is not recursively verified; the man page says `--deep` is what makes verification recurse into nested content. Apple's notarization doc gives the canonical preflight as `codesign -vvv --deep --strict /path/to/binary/or/bundle`. With finding 1 present, the stage prints `verify  codesign --verify --strict passed` while the nested ad-hoc sidecars would fail the notary check. The comment at `verify.ts:16` claims `--strict` "makes the claim true"; it does not make the nested-code claim true.
- reachable by: same app shape as finding 1; the CLI reports a passed verify immediately before a notarization that fails on the sidecar.
- evidence: `src/packaging/verify.ts:19-21` and `src/cli/sign.ts:44-51`; `man codesign` (verification form of `--deep`); Apple doc quoted in finding 1 ("use the `deep` option to ensure the utility checks nested code content").
- smallest fix: add `--deep` to `verifyCommand` and update the CLI line to name the flags it actually ran.

### 4. Medium — a failed staple/validate/spctl step prints `notarize rejected` with no reason

- where: `src/packaging/notarize-plan.ts:136-146` (`describeNotarize`), `src/packaging/notarize.ts:157-165` (step failures), `src/cli/notarize.ts:41-43` (the only caller in the build stage).
- mechanism: `notarize()` answers step failures with `{ ok:false, status:"rejected", reason:"staple failed (exit N)", log:"...", appPath, submissionId }`. `describeNotarize` prints `reason`, `requires`, `log` and `issues` only in the `!result.status` branch. Because `status` is set, the CLI prints only `notarize rejected  <id>  <app>` — the exit code and tool text are dropped. This contradicts the package's own guide: `site/app/docs/guides/notarize/page.mdx:62` says a failed step "answers `status: "rejected"` with `reason` naming the step and its exit code".
- reachable by: measured. Fake `exec` where `ditto` and submit succeed and `stapler staple` exits 17 produced `{"ok":false,"status":"rejected","reason":"staple failed (exit 17)","submissionId":"sub-1","log":"stapler: ticket not found"}` and the single output line `notarize rejected   sub-1  /tmp/Crust.app`. No existing test asserts CLI output for a step failure (`src/packaging/notarize.test.ts`, `src/cli/notarize.test.ts` cover only refusals, accepted and submit rejections).
- evidence: probe script at `/private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode/notarize-reason-probe.ts`, run with `bun <path>` from the repo root; stdout as quoted above.
- smallest fix: print `reason` (and `log`) when present regardless of `status`, keeping the status prefix as the first field. Add a test that feeds a failed staple step into `notarizeStage` and asserts the output contains `staple failed (exit 17)`.

### 5. Medium — NSIS installs nested sidecars into a directory the script never creates

- where: `src/packaging/installers-sidecars.ts:74-84` (`sidecarFileLines`), `src/packaging/nsis.ts:70-117` (`nsisScript`; only `SetOutPath "$INSTDIR"` at line 94).
- mechanism: for a declared sidecar `bin/tool.sh` the helper emits `File /oname=bin\tool.sh "<abs path>"`. NSIS's `File /oname` does not create intermediate directories — the NSIS forum thread [Trouble with specifying file](https://nsis-dev.github.io/NSIS-Forums/html/t-253880.html) states "/oname option DOES NOT create the directory structure. You'll have to make a call to CreateDirectory first", and the NSIS wiki's own recipe emits one `CreateDirectory` line per subdirectory before each `File /oname=`. `SetOutPath "$INSTDIR"` creates only `$INSTDIR`, not `$INSTDIR\bin`. The generated script therefore never creates `bin`, so the sidecar is not installed at the path the sidecar plugin resolves relative to the executable. The test fixture at `src/packaging/nsis.test.ts:47-51,137-148` uses exactly `bin/tool.sh` and asserts only the text of the `File` line, never the installed layout.
- reachable by: any app with `build.sidecars` whose name contains a relative directory. `crust package --format nsis` succeeds (makensis compiles the script); the installer's runtime sidecar spawn fails.
- evidence: `src/packaging/installers-sidecars.ts:78-81` builds `/oname=` with the backslash-converted name; `src/packaging/nsis.ts:94` is the only `SetOutPath`; NSIS references above.
- smallest fix: emit `CreateDirectory "$INSTDIR\<parent>"` for each distinct sidecar parent before its `File /oname=` line (or use `SetOutPath "$INSTDIR\<parent>"` and `File` without `/oname`), and add a test asserting those lines.

### 6. Low — two packaging guide lines contradict the shipped code

- where: `site/app/docs/guides/notarize/page.mdx:23` and `site/app/docs/guides/package-formats/page.mdx:78`.
- mechanism: the notarize guide's plan table still lists `spctl -a -vvv -t install <app>` while `src/packaging/notarize-plan.ts:126-130` deliberately dropped `-t install` and `src/packaging/notarize-plan.test.ts:70-77` asserts its absence — with a comment naming the reason (`-t install` rejects every valid `.app`). The package-formats guide says the NSIS script "copies the app directory with `File /r`", while `src/packaging/nsis.ts:97` emits only explicit `File` lines and `src/packaging/nsis.test.ts:90` asserts `not.toContain("File /r")`. A reader following the docs would reinstate a known-broken flag and a known-broken copy strategy.
- reachable by: read; both are plain doc/code mismatches.
- evidence: the four file:line pairs above.
- smallest fix: change the doc table row to `spctl -a -vvv <app>` and the NSIS sentence to "copies the binary and the declared sidecars with explicit `File` lines".

### 7. Low — the one-shot notary password is placed on the child process argv

- where: `src/packaging/notarize-plan.ts:82-85`, used by `buildNotarizePlan` (submit, line 116) and `collectIssues` (`src/packaging/notarize.ts:76-84`).
- mechanism: `credentialFlags` returns `["--apple-id", …, "--password", route.password, "--team-id", …]`. The CLI reads the value from `CRUST_NOTARY_PASSWORD` correctly, but then passes it as an argv element to `xcrun notarytool submit` and `xcrun notarytool log`, where any local process can read it from `ps`. `src/cli/notarize.ts:15` promises "Credentials come from the environment, never argv: a password on a command line lands in shell history and `ps`." The promise holds for crust's own argv, not for the child's.
- reachable by: `crust build --sign --notarize` with the one-shot credential route and no keychain profile.
- evidence: `src/packaging/notarize-plan.ts:82-85,116` and `src/packaging/notarize.ts:76-84`; `xcrun notarytool log --help` on this machine confirms `--password` optionally triggers a secure prompt when omitted with `--apple-id` and `--team-id` present.
- smallest fix: prefer the keychain-profile route and document the one-shot route's exposure, or omit `--password` so notarytool uses its secure prompt (which would make the stage interactive and needs a separate decision).

### 8. Low — `--sign` always prints "notarize not run", even when it is followed by `--notarize`

- where: `src/cli/sign.ts:15-20`, called from `runStages` at `src/cli/build/stages.ts:79-90`.
- mechanism: `signVerdict` appends the fixed line `notarize not run — needs notarytool credentials, then \`stapler staple\`` unconditionally. In the full release order, the next stage does run notarization, so the build log tells the reader the opposite of what happens between them.
- reachable by: `crust build --sign --notarize` with valid credentials.
- evidence: `src/cli/sign.ts:18` and the stage order at `src/cli/build/stages.ts:79-90`.
- smallest fix: move that line to the `--sign`-only path in `runStages`, or pass a flag to `signVerdict`.

## Checked and clean

- **dmg** (`src/packaging/dmg.ts`): argv matches the local `diskutil help image create from` (`--format UDZO --volumeName <name> <source> <dest>`); a measured second create over an existing `.dmg` succeeded, so the catch/fallback is not masking a routine rebuild failure. Stage dir and `/Applications` symlink are cleaned up in `finally`; `cli/package/format.ts` refuses bad formats before a builder runs.
- **appimage** (`src/packaging/appimage.ts`): bare `Exec=<binaryName>` is what appimagetool's generated AppRun resolves (`find "$HERE/usr/bin" -name "$MAIN"` from the root desktop file), so the docs' "bare binary name" is correct; `.DirIcon`, root `<id>.png`, mode-0755 `AppRun` and `--no-appstream` are all present; the AppDir is removed before assembly.
- **notarize preflight and order** (`src/packaging/notarize-plan.ts`, `src/packaging/notarize.ts`): ad-hoc identity and missing credentials are refused before any command; zip → submit (with `--wait`, exit code outranking stdout) → staple → validate → spctl; issues come from `notarytool log <id>` and are printed verbatim; a rejected submission never staples.
- **stage refusal** (`src/cli/build/stages.ts:35-63`): platform, identity and credential checks run before build work; single-file builds use the same gate.
- **NSIS missing-tool path** (`src/packaging/nsis.ts:168-186`): script is written before `makensis` is looked for, a stale `.exe` is removed before compile, and failure keeps the script for inspection.
