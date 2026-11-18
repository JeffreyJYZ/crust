# Lane 8 — packaging

Field: the path from `crust build` to a person running and updating the app. Read `src/packaging/`,
`scripts/build-standalone.ts`, `scripts/release/**`, `.github/workflows/`, and the CLI commands that
wire them. Evidence below is code-traced; each claim names the command or the file:line. No source
was changed. Ranked by what blocks shipping a real app.

## 1. `build.sidecars` is validated and documented but never reaches `crust build`

The config key exists (`src/config/validate-build.ts:10,22-25`) and the docs promise the behaviour
verbatim:

> "`crust build` copies each binary beside the app's executable — `Contents/MacOS/` on macOS, next
> to the exe on Linux and Windows — preserving its relative path … and setting mode `0755`. It also
> writes a `crust-sidecars.json` manifest in that directory listing the declared names."
> — `site/app/docs/guides/sidecar/page.mdx:14`

`buildApp` implements exactly that (`src/packaging/build.ts:23,112-123`, manifest written at
`:185`). But both callers omit the option:

- `src/cli/build.ts:125-139` — `entry`, `binaryName`, `outDir`, `app`; no `sidecars`, no `projectDir`.
- `src/cli/build/single-app.ts:51-61` — same omission.

Proof command: `rg -n 'sidecars|copySidecars' src/cli/build.ts src/cli/build/single-app.ts` exits 1
with no output. `copySidecars({ names: options.sidecars ?? [], … })` (`build.ts:113`) therefore runs
with an empty list on every real build: it writes a manifest containing `[]` and copies nothing.

Downstream effect: `declaredSidecars()` (`src/plugins/sidecar-locate.ts:20-32`) reads that empty
manifest, so `sidecar.spawn` refuses every name with `sidecar-not-declared`
(`src/plugins/sidecar-control.ts:40-41`) before it ever reaches the `sidecar-missing` check. The
whole feature is dead in a shipped app, and the parity page (`site/app/docs/reference/parity/page.mdx:91`)
claims parity for it.

Second half of the same defect: even after wiring the CLI, sidecars land in
`<dist>/<name>.app/Contents/MacOS` (`build.ts:115-123`), while the installers package from `<dist>`
(`src/cli/package/options.ts:47,60-61`) and NSIS emits only the one `File` line (`src/packaging/nsis.ts:91`).
Windows and Linux packages would still lack sidecars.

Smallest fix: pass `config.build?.sidecars` and `projectDir` at both call sites, then have the
installer builders copy the manifest's files into the directory they actually package.

## 2. Auto-update is registered everywhere but can only finish on macOS

`createRuntimePlugins()` adds the updater with no platform gate
(`src/runtime-plugins.ts:71`, returned at `:91,195`), so a Windows or Linux app with an `updater`
section advertises `updater.check/download/install/relaunch`. Three separate macOS-shaped
assumptions stop the last two:

- `ownBundleOf()` requires `…/X.app/Contents/MacOS/X`, otherwise `not-an-app-bundle`
  (`src/plugins/updater-bundle.ts:16-21,37-45`).
- `isAppBundle()` requires a path ending in `.app` (`src/plugins/updater-node.ts:134-137`).
- The default adapter relaunches with `open -n` (`src/plugins/updater-node.ts:158-159`).

No doc says macOS-only. The guide's entire worked example is a `.app` swap
(`site/app/docs/guides/updater/page.mdx:88-112`), and the limits page is silent on updater
(`site/app/docs/limits/page.mdx`). A Windows `NSIS` install or a Linux `AppImage` install therefore
has no working update path: `install` and `relaunch` always refuse. Comparable scope: implement
platform install/relaunch adapters, or refuse registration off macOS and state the limit.

## 3. No CI path from a built app to a signed, notarized, symbolicated release

`release.yml` builds five standalone **CLI** binaries and attaches them to the GitHub Release
(`.github/workflows/release.yml:67-120`); the verifier checks those five assets
(`:122-143`, `scripts/release/verify-assets.ts`). That is correct for a framework, but nothing in
the repo automates the app half:

`rg -n 'crust (sign|notarize|package)|dsym|symbolicat' .github/workflows src/packaging scripts --glob '!**/*.test.ts'`
finds no workflow step for it. `crust sign`, `crust notarize` and `crust package` are local commands
whose credentials come from the environment (`src/cli/sign.ts:30`, `src/cli/notarize.ts:24-31`), and
CI only exercises the dmg build plus the *no-certificate refusal*
(`.github/workflows/ci.yml:105-112`, `scripts/package/phases/sign.ts:32-41`).

Consequences:

- An author must hand-run sign → notarize → staple → dmg on their own Mac; there is no release
  recipe to copy, and no proof a notarized artefact was ever produced end to end.
- No dSYM is generated and no symbol upload exists, while the crash reporter stores records without
  symbolication (`src/plugins/crash-reporter.ts:2-4,68-76`), so a shipped crash report is raw data.
- Formats covered are dmg, NSIS `.exe` and AppImage (`src/cli/package.ts:36-52`); no MSI and no
  `.pkg`, which blocks managed/enterprise deployment on both desktop OSes.

## 4. The post-sign verdict names the wrong entitlement

`signingReality()` tells the user:

> "`com.apple.security.cs.allow-jit` is sealed. Its necessity is unproven for Bun's runtime …
> WKWebView's WebContent process is the unmeasured case." — `src/packaging/reality.ts:23-28`

`crust sign` prints this verbatim through `signVerdict()` (`src/cli/sign.ts:16-21`). But the measured
fact in the repo is the opposite shape: `allow-jit` alone is **not sufficient**; without
`allow-unsigned-executable-memory` a hardened bundle "starts, creates no page, prints nothing and
exits 0" (`src/packaging/entitlements.ts:1-4`). The one entitlement that prevents a silent launch
failure is never named in the verdict, so a developer diagnosing a bundle that will not open is
pointed at the wrong key. Fix: print both entitlements and the silent-exit symptom.

## 5. Lower: `crust package` is gated on a macOS-shaped bundle on every platform

`packageCommand()` refuses to run unless `findAppBundle()` finds a `.app` in `dist`
(`src/cli/package.ts:66-72`). `crust build` does assemble that bundle even on Linux and Windows
(`src/cli/build.ts:141-144`), so it works today, but NSIS and AppImage then ignore the `.app` and
read the flat binary from `dist` (`src/cli/package/options.ts:47,60-61`). One artefact is required
as a gate and a different one is shipped.

## What is solid

Signing has an honest ad-hoc verdict (`src/packaging/reality.ts:6-21`) and strict verification
(`src/packaging/verify.ts:19-30`); notarization has an exact argv plan and refusal preflight
(`src/packaging/notarize-plan.ts:87-133`); dmg/NSIS/AppImage each have unit tests and a macOS CI
packaging e2e. The failures above are in the wiring between these pieces, not in their internals.
