# Wave 3 — the twenty areas

Shared rules are in `BRIEF.md`. Each row is one agent: its area, its report file. A re-send is the
area line plus "read BRIEF.md, work your row".

| #  | area                                                                                  | report                    |
| -- | ------------------------------------------------------------------------------------- | ------------------------- |
| 01 | `src/bridge/` — invoke pairing, event framing, timeouts, malformed input               | `01-bridge.md`            |
| 02 | `src/platform/windows/` — TS driver, `shim/`, ffi widths, COM lifetimes                | `02-windows.md`           |
| 03 | `src/platform/linux/` — GTK3 + WebKitGTK, `dlopen`, `g_free`, load-state machine        | `03-linux.md`             |
| 04 | `src/platform/darwin/` — `objc_msgSend` shapes, selector verification, window liveness  | `04-darwin.md`            |
| 05 | `src/cli/` — flags, exit codes, `--help` versus the parser                              | `05-cli.md`               |
| 06 | system plugins — notification, power, tray, dock, theme, autostart, shortcuts, opener   | `06-plugins-system.md`    |
| 07 | data plugins — fs and scope, store, stronghold, clipboard, downloads, network           | `07-plugins-data.md`      |
| 08 | UI plugins — window*, dialog, menu*, findinpage, navigation*, i18n, single-instance     | `08-plugins-ui.md`        |
| 09 | runtime — `app.ts`, `app-loop.ts`, `runtime*.ts`, `single-*.ts`                         | `09-runtime.md`           |
| 10 | `src/packaging/` — dmg, AppImage, NSIS, sign, notarize                                  | `10-packaging.md`         |
| 11 | probes in `scripts/` — `windows-smoke`, `linux-smoke`, `e2e-*`                          | `11-probes.md`            |
| 12 | `scripts/release/`, `build-standalone.ts`, both workflows                              | `12-release.md`           |
| 13 | `site/` — every load-bearing claim against the source it describes                      | `13-docs.md`              |
| 14 | the test suite as a gate — vacuous asserts, unexercised modules                         | `14-tests.md`             |
| 15 | `templates/` and `examples/` — do the scaffolds run as written                          | `15-templates.md`         |
| 16 | updater family — manifest trust, redirects, zip slip, version compare                   | `16-updater.md`           |
| 17 | `src/extensions/` — ABI check, symbol caching, platform suffixes                        | `17-extensions.md`        |
| 18 | single-file mode — HTML escaping, detection, cwd-relative reads                         | `18-single.md`            |
| 19 | `src/config/` — unknown keys, platform defaults, path bases                            | `19-config.md`            |
| 20 | security — bridge binding and auth, command reachability, shell args, path scope        | `20-security.md`          |

Twenty reports, no overlaps, every writer on a file of its own.
