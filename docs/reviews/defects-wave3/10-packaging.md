# Packaging

Area: `src/packaging/` — dmg, AppImage and NSIS builders, the code-sign path, notarize, and their tests.

## Findings

### 1. Notarize's final Gatekeeper check assesses `install` on an `.app`, so it rejects a valid bundle — HIGH
`src/packaging/notarize-plan.ts:126`
`spctl -a -vvv -t install <app>` asks Gatekeeper to assess installation of an installer package, not execution of an app. `notarize()` treats any non-zero exit from this step as `ok: false` (`notarize.ts:137-146`), so a Developer-ID-signed, notarized, stapled `.app` is reported as a failed notarization. The same repo's `verify.ts:40` uses the correct default form (`spctl -a -vvv appPath`) for the same bundle.
**Breaks:** `crust notarize` exits 1 with `spctl failed (exit 3)` after Apple accepted and stapled the ticket. The check never verifies the thing the user cares about — whether Gatekeeper allows the app to launch.
**Evidence:** `man spctl`: `-t … install to assess installation of an installer package … The default is to assess execution.` Measured on this Mac: `spctl -a -vvv -t install /System/Applications/Calculator.app` → `rejected`, exit 3; `spctl -a -vvv /System/Applications/Calculator.app` → exit 0. Source: `{ name: "spctl", command: ["spctl", "-a", "-vvv", "-t", "install", appPath] }`.

### 2. AppImage AppDir has no `.DirIcon` and no root icon named by `Icon=`, so the image ships without an icon — MEDIUM
`src/packaging/appimage.ts:103` and `src/packaging/appimage.ts:117`
The desktop entry sets `Icon=${options.id}` (line 64), but the icon is copied only to `usr/share/icons/hicolor/512x512/apps/<id>.png`. Nothing creates the AppDir root files `<id>.png` and `.DirIcon`, which the AppDir spec lists among the four entries that MUST be present, and which `appimagetool` treats as critical. The test at `appimage.test.ts:94-95` asserts only the `usr/share/icons/...` path, so it passes with the incomplete tree.
**Breaks:** `appimagetool` logs an error ("AppDir is missing .DirIcon and a top-level icon"), the built AppImage has no thumbnail/icon, and a future appimagetool release refuses the build outright.
**Evidence:** appimagetool `src/appimagetool.c:187-190` registers `AppRun`, `.DirIcon` and the icon found from `Icon=` as critical files; `:1093-1095` looks for `<source>/<icon_name>.png` at the AppDir root; `:398-401` warns that `.DirIcon does not exist, and no <id>.png ... was found in the top level`. Crust writes only `join(iconDir, \`${options.id}.png\`)` where `iconDir = join(appDir, "usr", "share", "icons", ...)`.

### 3. `notarize()` ignores the submit step's exit code when stdout claims `Accepted` — MEDIUM
`src/packaging/notarize.ts:121`
The submit branch `continue`s on `submitted.status === "accepted"` before reaching the `result.code !== 0` check that every other step goes through. A notarytool invocation that exits non-zero while its JSON still says `Accepted` is treated as a successful submission, and the plan goes on to staple and report success.
**Breaks:** a failed submit produces `ok: true` and exit 0 from `crust notarize`; a stale or forged-looking stdout verdict hides a real failure. No test covers a non-zero submit with an accepted verdict (`notarize.test.ts:66-84` only uses code 0).
**Evidence:** `if (submitted.status === "accepted") continue;` sits at line 121; `if (result.code !== 0)` is at line 137, after the submit branch has already returned or continued.

### 4. NSIS copies the whole `dist`, including the macOS bundle and other formats, into the Windows install — MEDIUM
`src/packaging/nsis.ts:89`
`File /r "${options.appPath}\\*.*"` copies `appPath` wholesale, and the CLI passes `inputs.dist` (`src/cli/package/options.ts:60`), not just the Windows binary. `crust build` assembles `dist/<name>.app` on every host (`src/cli/build.ts:135-144`), so dist holds the macOS `Contents/{Info.plist,MacOS,Resources}` tree; building several formats also leaves `<id>.AppDir`, `*.AppImage`, `*.dmg` there.
**Breaks:** the Windows installer installs a macOS `.app` bundle, leftover Linux/macOS artefacts and any previously built images alongside `crust-app.exe`, inflating the install and shipping files the Windows app never reads.
**Evidence:** `File /r "${options.appPath}\\*.*"` in `nsisScript`; `nsisOptions()` returns `appPath: inputs.dist`; comment in `src/cli/build.ts:141-142`: "the `.app` is not what Linux or Windows ship: those hosts assemble the same bundle around the same binary".

### 5. NSIS default output lands in the project root, not `dist` — LOW
`src/packaging/nsis.ts:133-136`
`outPath` defaults to `<appPath>/..` and `scriptPath` to its parent. With the CLI's `appPath: inputs.dist`, both the generated `.nsi` and the setup `.exe` are written one directory above `dist`, while `dmgOptions` / `appImageOptions` put their artefacts inside `dist`.
**Breaks:** `crust package --format dmg --format appimage --format nsis` scatters outputs — installer and script appear in the project root, not next to the other release artefacts — and pollute a directory the user did not name as an output.
**Evidence:** `const outPath = resolve(options.out ?? join(options.appPath, "..", ...))` (line 133); `nsisOptions()` in `src/cli/package/options.ts:57-66` does not set `out`; contrast `dmgOptions()` line 34 and `appImageOptions()` line 47-54.

### 6. `signingReality()` is dead code, contradicting the sign module's docstring — LOW
`src/packaging/reality.ts:6`
The sign module's own docstring says the honest verdict is printed by `signingReality()`, but nothing in the repo calls it — the only occurrences are its definition and that docstring. `crust build` hand-writes one Gatekeeper line instead, and `crust sign` prints a different set.
**Breaks:** a code-reader or future caller trusting the documented helper gets nothing; the "honest verdict" the sign path promises is not a shared function and can drift from the CLI's copy.
**Evidence:** `rg -n "signingReality"` over the repo returns only `src/packaging/reality.ts:6` and `src/packaging/sign.ts:3` ("`signingReality()` prints that rather than hiding it").

### 7. `crust sign` claims `codesign --verify --strict` passed, but the check never uses `--strict` — LOW
`src/cli/sign.ts:42` (signing path; the checker lives at `src/packaging/verify.ts:17`)
`verifySignature()` runs `codesign --verify --verbose=4`, with no `--strict`. The CLI prints a line claiming the stricter form passed.
**Breaks:** an operator reading the build log believes a stricter validation ran than actually did; a bundle with strict-only issues would still be reported as clean.
**Evidence:** `line("verify", "codesign --verify --strict passed")` vs `run(["codesign", "--verify", "--verbose=4", appPath])`.

## Coverage
Read every file in `src/packaging/`: `app.ts`, `build.ts`, `dmg.ts`, `appimage.ts`, `nsis.ts`, `sign.ts`, `verify.ts`, `reality.ts`, `notarize.ts`, `notarize-plan.ts`, `icon.ts`, `plist.ts`, `entitlements.ts`, `exec.ts`, `deep-link.ts`, and the test files (`sign`, `appimage`, `nsis`, `notarize`, `notarize-plan`, `deep-link*`). Also read the callers in `src/cli/` (`package.ts`, `package/options.ts`, `sign.ts`, `notarize.ts`, `dmg.ts`, `build.ts`) and the docs pages for package formats and notarize, plus `man spctl`, `diskutil help image create from`, the AppDir spec and appimagetool's source to confirm findings.

Not examined in depth: the `extension-*` files (extension discovery, bindings, compile, doctor) — they share the directory but are not artefact builders; another hunter covers extension surfaces. Did not run builds, the full suite or any GUI probe.

Next things to look at: a `dmg.test.ts` does not exist, so the dmg builder has no automated coverage at all; `sign.test.ts` asserts only the entitlement plist text, never `signApp`'s identity refusal, hardened-runtime flag or temp cleanup; a post-staple re-sign that invalidates the notarization ticket is not detected by any step in the plan.
