# Hunt 50 — packaging lane (45)

Read-only. `rg`/`fd` only; no builds, no GUI probes. Scope: `src/packaging/`, plus the callers needed to prove reachability.

**Count: 4 findings** — 2 high, 1 medium, 1 low. The two highs are still-open reports from `docs/reviews/hunt-20/10-packaging.md`, re-verified against current HEAD; the medium is new.

## 1. HIGH — Developer ID `crust sign` leaves nested sidecars ad-hoc, so a bundle that runs here is rejected on a recipient machine

- `src/packaging/sign.ts:45-90` — `signApp()` signs only `options.appPath`. It has no parameter or path for nested executables; `codesign --force --sign <identity> --options runtime` at `:59-77` is one invocation against the `.app`.
- `src/packaging/installers-sidecars.ts:56-72` — the only nested-sign helper, `signSidecars()`, hardcodes `--sign -` at `:67` (ad-hoc, no hardened runtime, no identity). It is gated to `process.platform === "darwin"` at `:60` and is called only from build paths (`src/cli/build/single-app.ts:77`), never from sign.
- `src/cli/sign.ts:31-36` — `signStage()` calls `signApp()` with `mode: "developer-id"` and never re-signs the declared sidecars.

**Reached:** config sets `build.sidecars` → `crust build` ad-hoc-signs each sidecar in `Contents/MacOS` (`src/cli/build.ts:166-171`) → operator sets `CRUST_SIGNING_IDENTITY` and runs `crust sign` → the outer bundle gets Developer ID + hardened runtime, the nested binaries keep `flags=0x2(adhoc)` and no runtime flag. `codesign --verify --strict` does not recurse without `--deep`, so `signStage()` prints success (`src/cli/sign.ts:39-46`) and the failure surfaces only at `crust notarize`: notarytool rejects every submission containing ad-hoc nested code. Same shape as hunt-20/10-packaging.md:3-7; still present.

**Smallest fix:** give `signSidecars` an identity/mode (default ad-hoc) and call it from `signStage()` before `signApp()`.

## 2. HIGH — `crust package` has no host/format guard, so it emits an artefact that cannot run on its target platform

- `src/packaging/dmg.ts:30-36` — accepts any directory; a flat binary fails `isDirectory()` with the false advice "run the build and sign steps first" even though the build succeeded.
- `src/packaging/appimage.ts:81-98` — accepts any `isFile()` as `binaryName`; it packs whatever this host built, including a Mach-O.
- `src/packaging/nsis.ts:133-139` — same host-agnostic `appPath` check.
- `src/cli/package/format.ts:16-29` — `parseFormats()` accepts `dmg|appimage|nsis` on every host with no platform check.
- `src/cli/package.ts:30-56,92-97` and `src/cli/package/options.ts:30-67` — pass `findBuildArtifact`'s host-specific result straight to the builder, with no cross-compilation refusal.

**Reached:** On Linux/Windows, bare `crust package` defaults to `dmg`; `findBuildArtifact()` (`src/cli/util.ts:155-169`) returns the flat binary, and `buildDmg()` rejects it with the misleading build advice. On macOS, `crust package --format appimage` points `appImageOptions()` at `dist/crust-app` (a Mach-O left beside the `.app` by `crust build`); `buildAppImage()` only checks `isFile()`, so with `appimagetool` present it returns `ok: true` for an AppImage whose payload gives an exec-format error on Linux. Same as hunt-20/10-packaging.md:9-13; still present.

**Smallest fix:** reject a format whose target differs from `process.platform` in `parseFormats`/`packageCommand` before any builder runs.

## 3. MEDIUM (new) — generated bindings name a dylib no compiler writes, so the name drifts with host and extension name

- `src/packaging/extension-bindings.ts:69` — the default is `options.dylib ?? \`${options.name}${dylibSuffix()}\``: the extension *name* plus a host suffix.
- `src/packaging/extension-compile.ts:41-49` — `dylibName()` derives the real emitted name from the *source stem*, and prefixes `lib` for rust on non-Windows; `:58` uses it for the compiler's `-o`/`-femit-bin`. Nothing ties the two computations together.
- `src/packaging/extension-tools.ts:22-26` — `dylibSuffix()` defaults to `process.platform`, so a generated module bakes in the host's suffix.
- `scripts/native-extensions.ts:35-51` — plan names are `zigclock`/`rustclock`, source stems are both `clock`; commit `6878bab` removed the explicit `dylib` that used to carry `clock.dylib`/`libclock.dylib`, leaving the default at `:51`.
- `src/packaging/extension-bindings.test.ts:19-22` asserts only the `<name><hostSuffix>` default; no test compares it with the compiled output name.

**Reached:** `bun run build:native` (also step 1 of `bun run e2e:native`, `scripts/e2e-native.ts:68`) overwrites `examples/native/extensions/generated/*.ts`: `rustclock.ts:5` becomes `dlopen("rustclock.dylib")` while the compiler wrote `libclock.dylib`, and `zigclock.ts:5` becomes `dlopen("zigclock.dylib")` while the compiler wrote `clock.dylib`. `crust dev` then fails both extensions at module evaluation. A fresh clone starts with no generated dir (`.gitignore:23`), and CI runs no `e2e:native` step, so the regression is invisible. Cross-platform half: a module generated on macOS carries `.dylib`, so it cannot dlopen the `.so`/`.dll` a Linux/Windows build emits. The files on disk today still hold the old correct names, which is why an incremental local run can pass.

**Smallest fix:** pass `basename(result.output)` from `compileExtension` into `writeBindings` at the caller, or let `writeBindings` take source/kind/platform and reuse `dylibName()` so one function decides both names.

## 4. LOW — orphaned JSDoc in `installers-sidecars.ts`

`src/packaging/installers-sidecars.ts:46-50` documents `sidecarFileLines` (`/oname=` keeps the relative path), but the next block `:51-55` documents `signSidecars`, so the first attaches to nothing; `sidecarFileLines` at `:74` has no doc. A reader looking for the `/oname=` contract in the function's own docs finds none. Doc-only; no runtime effect.

## Checked and clean

- **AOT/compile path** (`build.ts:54-149`, `aot.ts:20-40`): `--trim` always, probe once and clean up, dynamic-import retry, Windows `.exe` read back rather than guessed; output is stat-checked for size > 0.
- **Manifest shapes** (`build.ts:113-118,156-188`, `src/plugins/sidecar-locate.ts:20-31`, `installers-sidecars.ts:26-44,74-84`): macOS puts files in `Contents/MacOS` and the manifest in `Contents/Resources`; installers read both shapes via `declaredSidecars`, `/oname=` preserves `bin/tool.sh`, and AppImage places the manifest beside the binary in `usr/bin`.
- **Notarize plan** (`notarize-plan.ts:107-133`, `notarize.ts:98-174`): `spctl` uses execute (no `-t install`), submit exit code outranks stdout, issues are fetched from `notarytool log`, temp zip removed in `finally`.
- **Hardened runtime** (`entitlements.ts:5-15`, `sign.ts:56-75`): both `allow-jit` and `allow-unsigned-executable-memory` sealed; temp plist removed in `finally`.
- **AppImage tree** (`appimage.ts:104-137`): root `<id>.png`, `.DirIcon`, root `.desktop` symlink and `AppRun` present; `e2e-appimage` in CI verifies them on Linux, so `desktopEntry`'s `Exec=crust-app` was not reported — the Linux proof passes with it.
- **NSIS script** (`nsis.ts:70-118`): per-user install dir, HKCU+HKLM, `/oname=` sidecar lines, manifest line; `format`/`check:lines` not run per brief.
