# Fix wave — 16 lanes, one owner per file set

Shared rules: `BRIEF.md`. Every lane reads its own report under `../defects-wave3/`.

| lane              | report                          | files it may write                                                                          |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `bridge`          | 01-bridge.md, 20-security.md    | `src/bridge/**`, `src/runtime.ts`                                                            |
| `windows`         | 02-windows.md, 11-probes.md 1+3 | `src/platform/windows/**`, `scripts/windows-smoke.ts`, `scripts/windows/**`                   |
| `linux`           | 03-linux.md, 11-probes.md 2     | `src/platform/linux/**`, `scripts/linux-smoke.ts`, `scripts/linux/**`                         |
| `darwin`          | 04-darwin.md                    | `src/platform/darwin/**` except `arity.test.ts` and `dialog.test.ts`                          |
| `cli`             | 05-cli.md, 18-single.md         | `src/cli/**` except `sign.ts`, `src/single*.ts`                                              |
| `plugins-system`  | 06-plugins-system.md            | `src/plugins/{power,shortcuts,logging,crash-reporter,theme,accessibility}*.ts`                |
| `plugins-data`    | 07-plugins-data.md              | `src/plugins/{fs,fs-scope-path,downloads-scope,clipboard-image}*.ts`                          |
| `plugins-ui`      | 08-plugins-ui.md                | `src/plugins/{window,single-instance,menu}*.ts`                                               |
| `runtime`         | 09-runtime.md                   | `src/{app,app-loop,runtime,runtime-plugins,runtime-shim}.ts`                                  |
| `packaging`       | 10-packaging.md                 | `src/packaging/**` except `extension-*`, `src/cli/sign.ts`                                    |
| `release-probes`  | 12-release.md, 11-probes.md 4-6 | `.github/workflows/release.yml`, `scripts/release/gate.ts`, `scripts/e2e-*.ts`, `examples/parity-probe/**` |
| `updater`         | 16-updater.md                   | `src/plugins/updater*.ts`                                                                     |
| `extensions`      | 17-extensions.md                | `src/extensions/**`, `src/packaging/extension-*.ts`, `scripts/e2e-native.ts`                   |
| `config`          | 19-config.md                    | `src/config/**`                                                                              |
| `docs`            | 13-docs.md                      | `site/app/docs/reference/{parity,config}/page.mdx`                                            |
| `tests-templates` | 14-tests.md, 15-templates.md    | `src/platform/darwin/{arity,dialog}.test.ts`, `src/platform/darwin/status-bar-*.test.ts`, `templates/react/package.json`, `scripts/line-cap.ts`, `examples/dogear/src/selfcheck/panels.tsx` |

Ownership notes, so nothing collides:

- `src/runtime-plugins.ts` belongs to `runtime`; the shared-store finding in 19 is fixed there by that
  lane, not by `config`.
- `src/app-loop.ts` belongs to `runtime`; the Windows `userDataDir` spread is fixed by `windows` only
  if it does not need that file — otherwise report it.
- `src/config/types.ts`'s `autoCheck` comment belongs to `config`.
- `site/` is otherwise mine; do not create or edit another page.
- `src/plugins/updater-config.ts`-shaped config validators live in `src/config/**` and belong to
  `config`; `updater` reports instead of editing.
