# Lane: capability gaps

Read 2026-11-18 against `git rev-parse --short HEAD`. Field: absent surfaces, not parity rows or partials.

- `COMMANDS` is init/dev/build/sign/dmg/package/notarize/doctor (`src/cli/commands.ts:16-25`); no test, publish, release, version, update or icon command.
- Updater is a consumer only. Key generation lives in `src/plugins/updater-fake.ts:115` (test fixture); no CLI writes a manifest or signature. Zip extraction already exists (`src/plugins/updater-artifact.ts:36`), so that is not a gap.
- `crust build` is host-only — `process.platform` at `src/cli/build.ts:135,143`. `--target` exists only for the crust CLI's own standalone build (`scripts/build-standalone.ts:58,164`).
- Icons need macOS `sips`/`iconutil` (`src/packaging/icon.ts:2`), so a cross-build off macOS cannot make an icns.
- `crust init` copies templates verbatim (`src/cli/init.ts:62-63`); no template or example carries a `.github` workflow (`fd -H . templates examples | rg '\.github|workflow'` empty).
- `scripts/release.ts` releases crust itself and hardcodes the homebrew tap; it is not an app release tool.
- Crash records are signal/code/address only, no backtrace or symbolication (`site/app/docs/guides/crash-reports/page.mdx:100`); `configure` takes no `url` by decision (guide:67), unlike Butter.
- `crust sign` is codesign-only (`src/cli/sign.ts:26-53`); no Authenticode/signtool, no sandbox or provisioning config.
- Trap: a Butter/Tauri "has it" claim needs a source. Local Butter audit covers plugin folders only; Tauri claims here came from v2.tauri.app searches, never from crust code.
- Trap: `docs/reviews/next-wave/` is committed scratch, not hidden `.superpowers/`; reports go there and nowhere else.
