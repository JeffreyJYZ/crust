# packaging lane — durable traps

- `build.sidecars` is validated (`src/config/validate-build.ts:10,22-25`) and documented
  (`site/app/docs/guides/sidecar/page.mdx:14`), but neither `buildApp` caller passes it
  (`src/cli/build.ts:125-139`, `src/cli/build/single-app.ts:51-61`; `rg -n sidecars src/cli/build.ts`
  empty, 2026-11-18). `copySidecars({names: []})` still writes an empty manifest, so every
  `sidecar.spawn` name is refused `sidecar-not-declared`, never `sidecar-missing`. Wire the config
  value and `projectDir` at both call sites.
- Wiring the CLI is not enough: sidecars land in `<dist>/<name>.app/Contents/MacOS`
  (`src/packaging/build.ts:115-123`) while NSIS/AppImage package from `<dist>`
  (`src/cli/package/options.ts:47,60-61`; NSIS emits only one `File`, `nsis.ts:91`). Installers need
  their own copy of the manifest's files.
- Updater is registered on all platforms (`src/runtime-plugins.ts:71`) but can only finish on macOS:
  `ownBundleOf` needs `.app/Contents/MacOS` (`updater-bundle.ts:16-21`), `isAppBundle` needs `.app`
  and relaunch is `open -n` (`updater-node.ts:134-137,158-159`). No doc says macOS-only; Windows and
  Linux apps advertise an update path that always refuses.
- Release workflow ships five standalone CLI binaries only (`.github/workflows/release.yml:67-120`).
  No workflow step signs, notarizes, packages an app, generates dSYM or uploads symbols (checked
  with `rg -n 'crust (sign|notarize|package)|dsym|symbolicat' .github/workflows src/packaging scripts`,
  2026-11-18). Those are local env-credential commands; CI covers only dmg plus sign refusal.
- `signingReality()` verdict is stale: it names only `allow-jit` and says its necessity is unproven
  (`reality.ts:23-28`), while `entitlements.ts:1-4` measured `allow-unsigned-executable-memory` as
  the required one and the silent exit-0 symptom. `crust sign` prints the stale line verbatim
  (`src/cli/sign.ts:16-21`).
- No MSI and no `.pkg`; formats are dmg, NSIS exe, AppImage (`src/cli/package.ts:36-52`). Managed
  deployment on either desktop OS has no artefact.
- `crust package` refuses without a `.app` even for NSIS/AppImage (`src/cli/package.ts:66-72`);
  those formats then ship the flat binary from `dist`. One artefact gates, another ships.
