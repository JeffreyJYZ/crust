# Packaging lane — fix wave notes

Report: `docs/reviews/defects-wave3/10-packaging.md`. Owned files: `src/packaging/**` except
`extension-*`, plus `src/cli/sign.ts`.

## Findings fixed

1. **HIGH — spctl `-t install`** (`src/packaging/notarize-plan.ts:130`). Source already carried the
   fix when this lane started (default `-t execute`, with the measured reason in a comment); the
   test at `notarize-plan.test.ts:16` still asserted the old argv, so the plan test was failing
   against it. Test now asserts `["spctl", "-a", "-vvv", APP]` plus an explicit "no install form"
   case (`notarize-plan.test.ts:70`).
2. **MEDIUM — AppImage root icon** (`src/packaging/appimage.ts:124-125`). Source also already
   copied `<id>.png` and `.DirIcon` to the AppDir root; `appimage.test.ts:94-99` now asserts both
   files exist at that root, not only under `usr/share/icons`.
3. **MEDIUM — submit exit code** (`src/packaging/notarize.ts:124-140`). Source already checked
   `result.code !== 0` before the `accepted` continue; `notarize.test.ts:115` now covers the exact
   hole: code 2 with `status: Accepted` must still be `ok: false`, must not staple, and must report
   `submit failed (exit 2)`.
4. **MEDIUM — NSIS copied all of dist** (`nsis.ts:91`). Script now emits
   `File "<appPath>/<binaryName>"` instead of `File /r "<appPath>\\*.*"`. Only the compiled Windows
   binary is installed; the macOS `.app`, AppImages/AppDirs and earlier installers stay out.
5. **LOW — NSIS outputs in project root** (`nsis.ts:137-139`). Default `out` moved from
   `<appPath>/..` to `<appPath>`; the `.nsi` sits beside it there. Matches dmg/AppImage, which
   already write inside dist.
6. **LOW — `signingReality()` dead code** (`src/cli/sign.ts:16-20,54`). `crust sign` now prints the
   shared helper through `signVerdict(result)` rather than a second hand-written "signed" line;
   the notarize-not-run line is folded into the same verdict.
7. **LOW — `--strict` claimed but not run** (`verify.ts:19-25`). `verifyCommand()` is now the one
   argv used by `verifySignature()` and includes `--strict`; the failure message in `crust sign`
   says `--strict` too.

## Tests added / corrected

- `src/packaging/notarize-plan.test.ts` — spctl uses execute form.
- `src/packaging/appimage.test.ts` — root `<id>.png` and `.DirIcon`.
- `src/packaging/notarize.test.ts` — non-zero submit + accepted verdict still fails.
- `src/packaging/nsis.test.ts` — no `File /r`, only the binary, default paths inside `appPath`.
- `src/packaging/verify.test.ts` (new) — exact codesign argv contains `--strict`.
- `src/cli/sign.test.ts` (new) — `signVerdict` uses the shared helper for Developer ID and keeps
  the ad-hoc Gatekeeper refusal.

`bun test` on those six files: 21 pass, 0 fail. All edited files are under the 200-line cap.

## Needs another owner

- **Windows installer e2e fixture** (`scripts/package/phases/nsis-build.ts:41-42` and
  `scripts/package/phases/nsis-install.ts:99-116`) hard-codes the old output at the project root and
  asserts `File /r "<dist>\\*.*"` plus a script outside dist. Findings 4 and 5 change both contracts.
  Those files are outside this lane's ownership; the coordinator must update the fixture to
  `join(dist, ...)` and the new `File` directive before the Windows e2e gate runs.
- `src/cli/build.ts:150` still hand-writes its own Gatekeeper line (cli lane owns it). The
  documented helper is now live through `crust sign`; the build-path copy can drift and is best
  routed through `signingReality()` by that lane.

## Traps recorded

- `nsisScript()` builds one big template literal. A comment inside it must not contain backticks or
  `${…}`: both terminate/interpolate the TS template. Plain text only there (hit once while adding
  the explanatory comment; `bun fmt` surfaced the parse error).
- Whole-tree `bun check` is red in other lanes only: `status-bar-helpers.test.ts:61`,
  `crash-reporter.test.ts:132`, `src/plugins/shortcuts.ts:164`, `src/plugins/single-instance.ts:77-78`.
  `bun run check:lines` fails on `src/runtime-plugins.ts` (210 lines), also another lane.
