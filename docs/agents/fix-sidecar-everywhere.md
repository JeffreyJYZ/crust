# Lane L2 — fix-sidecar-everywhere (measured 2026-11-18)

## The three drop paths
- `src/cli/build/single-app.ts:51` omitted F4's `sidecars`/`projectDir`, so a single-file build
  wrote an empty manifest. Fixed additively; `signSidecars` runs before `signApp` because codesign
  refuses a bundle seal while a sidecar in `Contents/MacOS` is unsigned (F4 measured this).
- `src/packaging/appimage.ts` and `nsis.ts` package the flat `dist` tree, while `crust build` puts
  macOS sidecars in `X.app/Contents/MacOS` with the manifest in `Contents/Resources`.
  `src/packaging/installers-sidecars.ts` reads the manifest from either shape via `declaredSidecars`,
  then reuses `copySidecars` to stage the same names, modes and manifest into the packed tree.
- `src/cli/util.ts` `resolveBackendEntry` picked `src/main.ts` even when index.html named it as
  the Vite page module. It now skips that candidate using `htmlModuleEntry` from `dev.ts` — F4's
  helper is imported, not copied. Explicit `--entry` still wins.

## NSIS detail
`File /oname=bin\tool.sh "<abs>"` is load-bearing: without `/oname=`, NSIS drops the directory
component of an absolute path and a nested sidecar lands at the install root. The manifest is
installed as `$INSTDIR/crust-sidecars.json`, which is where `declaredSidecars` looks next to the exe.

## Proof
- `bun test` on the three new test files plus F4's sidecar/backend-entry tests and the existing
  nsis/appimage/sidecar-copy tests: 17 pass / 0 fail.
- `bun check`: no type errors in 784 files.
- `bun run check:lines` fails only on `src/platform/darwin/native-ownership.test.ts` (286 lines),
  owned by another lane; every file this lane touched is <= 197 lines.
- Single-file build test compiles a real app with `build.sidecars: ["bin/tool.sh"]` and reads the
  manifest the app ships: it names the sidecar, the file is 0755.
- `bun run e2e:single`: PASS 27/27 assertions, 5.9 s, no focus left on a test window.
- `bun run test` crashed in Bun 1.4.4 with `Segmentation fault at address 0x11` during the release
  scaffold tests (SIGSEGV, no test verdict); not retried. Narrow suites touching this lane are green.

## Not fixed / outside this lane
- `src/cli/build.ts` still carries F4's inline codesign loop; it cannot be shared without editing
  that file, which F4/F9b own.
- `src/cli/package/options.ts` now threads `build.sidecars` into `NsisOptions.sidecars`, and
  `buildNsis` also discovers from the built manifest as a fallback (the AppImage pattern); the
  installer script names each sidecar with `File /oname=` plus the manifest.
- `findAppBundle` in `src/cli/util.ts` (first `.app` in dist) is still naive; F4's doc names the
  backend resolver as the defect in this file, so it was left alone.
