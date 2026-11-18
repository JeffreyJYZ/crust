# find-bundle (Lane A3, fix wave 7)

## What changed

- `src/cli/util.ts`: `findAppBundle(dir, { appName?, outDir? })` now asserts identity — it returns
  `<outDir>/<appName>.app` when a name is given, never the first `.app` from `readdir`. Kept the
  name-less scan as an explicitly best-effort fallback. Added `findBuildArtifact(dir, { platform?,
  binaryName?, appName?, outDir? })`, which returns the `.app` on darwin and the flat compiled
  binary (`crust-app`, `crust-app.exe` on win32) elsewhere. Exported `DEFAULT_OUT_DIR = "dist"`.
- Callers: `package.ts` and `doctor/bundle.ts` gate on `findBuildArtifact` (so a stale `.app` cannot
  satisfy "did the build produce something" on Linux/Windows); `sign.ts`, `notarize.ts`, `dmg.ts`
  keep `findAppBundle` because those tools require a real `.app`. All pass `config.app.name`.
- Doctor loads config with a `.catch(() => undefined)` so an absent/broken config still lets it
  inspect what is on disk by falling back to the scan.

## Measured facts

- The bundle name is `<config.app.name>.app`, written by `src/packaging/app.ts:51-52`. It is not the
  app id. `assembleApp` does `rm -rf appPath` then rebuild (`app.ts:71`), so the bundle at the
  expected path is fresh; the stale risk is a *different-named* `.app` left in the same directory.
- `crust build` assembles `X.app` on every platform (`src/packaging/build.ts:101`, `app.ts:49-52`);
  the packaging report's "no .app on Linux/Windows" is wrong. But NSIS/AppImage ship the flat
  binary from `dist` (`src/cli/package/options.ts:47,60-61`), so the platform artefact the gate
  should assert is the flat binary off darwin.
- No `build.outDir` exists in `src/config/types.ts:50-72`. The `outDir` parameter is for callers
  that build elsewhere; today all CLI callers use the default `dist`.

## Proof

- `bun test src/cli/find-bundle.test.ts` — 7 pass: stale `.app` not chosen, missing expected bundle
  does not fall back to a stale one, custom `outDir` wins over `dist`, `.app` suffix not doubled,
  darwin/linux/win32 artefact answers.
- `bun check` — clean. `bun test src/cli/{package,notarize,sign,package/options,util}.test.ts` — 15 pass.
- Full `bun run test` had 1-2 failures in `src/platform/windows/frame.test.ts` (A2's in-flight file)
  and `check:lines` flagged `a11y-page.ts` / `frames.ts` (A1/A2) — none are this lane's files.

## Traps

- Extra arguments to the old one-arg `findAppBundle` were silently ignored in JS, so the stale-bundle
  and custom-`outDir` tests are genuinely red before this change.
- `findBuildArtifact` returning a *file* path off darwin means callers that pass it to a macOS tool
  would fail; that is why only the platform-neutral gate uses it.
