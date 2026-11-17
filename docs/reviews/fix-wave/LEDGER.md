# Fix wave — what each lane closed

Reports live under `../defects-wave3/`; this file is the ledger of what landed.

| finding                        | lane           | fix                                                                  | test                        |
| ------------------------------ | -------------- | -------------------------------------------------------------------- | --------------------------- |
| 01#1 `%5c` traversal, no token  | bridge         | `assets.ts` splits on both separators, resolves and bounds-checks     | `assets.test.ts`            |
| 01#2 `</script>` breakout       | bridge         | `bootstrap.ts` escapes `<`, `>`, U+2028/9 in the injected config      | `bootstrap.test.ts`         |
| 01#3 `crust.ready` hangs        | bridge         | `invoke.ts` settles the handshake on an error reply too               | `invoke.test.ts`            |
| 01#4 SSE cleanup leak           | bridge         | `events.ts` deletes its own cleanup on disconnect                     | `server-events.test.ts`     |
| 01#5 `__crustBytes`/`__proto__` | bridge         | `bytes.ts` + `invoke.ts` skip depth 0, carry keys through `defineProperty` | same                   |
| 01#6 byte cap vs UTF-16         | bridge         | `invoke.ts` measures `byteLength`, not `text.length`                  | same                        |
| 01#7 unescaped SSE event name   | bridge         | `events.ts` refuses/strips a newline in the name                      | same                        |
| 20#3 token file 0644            | bridge         | `runtime.ts` writes `.crust/dev.json` with `mode: 0o600`              | `runtime` suite             |
| 20#4 docstring vs origin gate   | bridge         | `server.ts` states the real posture: absent origin allowed, token is the credential | — |
| 20#1 token in the public doc    | token-lane     | token rides the navigation URL; the document answers 401 without it    | `server-document.test.ts`   |
| 02#1 frame scanner blind spots  | windows-frames | `frames.ts` parses pointers, 2-D bounds, initialisers, multi-declarator | `frame.test.ts`          |
| 02#3 preflight never ran        | windows-frames | `backend-default.ts` resolves every `PREFLIGHT` entry, sets `missing` | `preflight.test.ts`         |
| 02#2 slot leak on failed create | windows-slot   | `window-open.ts` calls `shim_webview_close`; C compacts `g_windows`   | `window-open.test.ts`       |
| 02#4 uninitialised RECT         | windows-slot   | `20_class.c` checks `GetClientRect`                                   | `shim-resources.test.ts`    |
| 11#1/#3 vacuous Windows smoke   | windows-slot   | `nativeMessages` from `shim_pump()`; detail names the HWND            | `platform-pump.test.ts`     |
| 02#5 `userDataDir` dead knob    | coordinator    | `app-loop.ts` derives it from `defaultStateRoot(config.app.id)`        | `app-run.test.ts`           |
| 03#1 preflight never ran        | linux          | `backend.ts` probes before `shim_lib_open`                            | `backend-preflight.test.ts` |
| 03#2 preflight 2 of 15          | linux          | `preflight.ts` covers 12 mandatory symbols                            | `preflight.test.ts`         |
| 03#3 slots never reclaimed      | linux          | `40_window.c` releases a slot on destroy                              | `shim-source.test.ts`       |
| 03#4 dlopen leak on retry       | linux          | `10_prelude.c` closes both handles on a failed open                   | same                        |
| 03#5 GError leak                | linux          | `30_webview.c` resolves and calls `g_error_free`                      | same                        |
| 03#6 `destroy` had no caller    | linux          | `platform.ts` closes every window from `quit()`                       | `platform.test.ts`          |
| 11#2 vacuous Linux pump         | linux          | `shim_pump` returns whether it iterated; `ticks` counts native slices | same                        |
| 04#1 closed window after Cmd+H  | darwin         | `40_window.c` membership in `-[NSApplication windows]`                | `platform.test.ts`          |
| 04#2 selector arity             | darwin         | `92_window_state.c` passes an explicit nil sender                     | `window-state-arity.test.ts` |
| 05#1 flag swallows next flag    | cli            | `parse.ts` peeks; a flag-looking token is left unconsumed             | `parse.test.ts`             |
| 05#2 doctor false-fail          | cli            | `environment.ts` uses `SINGLE_EXTENSIONS`                             | `doctor/command.test.ts`    |
| 05#3/#4 help text               | cli            | `usage.ts` names `.html` and the `main.ts` fallback                   | —                           |
| 05#5 help/version validation    | cli            | `parse.ts` pre-scans both and short-circuits                          | `parse.test.ts`             |
| 18#1 default-export heuristic   | cli            | new `single-export.ts` blanks strings/comments before matching        | `single-page.test.ts`       |
| 18#2 React 17 accepted          | cli            | new `single-react.ts` requires React 18+ and matching majors          | same                        |
| 06#1 sleepAllow lies            | plugins-system | `power.ts` checks `SleepRelease.ok`                                   | `power-native-refusal`      |
| 06#2 unregister lies            | plugins-system | `shortcuts.ts` keeps the key when the OS refuses                      | `shortcuts-native-failure`  |
| 06#3 severity inverted          | plugins-system | `logging.ts` orders `error<warn<info<debug<trace>`                    | `logging-level.test.ts`     |
| 06#4 disarm status ignored      | plugins-system | `crash-reporter.ts` + `crash.ts` propagate the native answer           | `crash-reporter.test.ts`    |
| 06#5 unclaimed unsubscribe      | plugins-system | retained; plugin gains `dispose()`                                    | `shortcuts-native-failure`  |
| 06#6 theme throw                | plugins-system | `ThemeFailure` typed result, fake can refuse                          | `theme-set.test.ts`         |
| 06#7 fabricated power state     | plugins-system | `PowerState.available` + typed failure                                | `power-native-refusal`      |
| 06#8 accessibility throw        | plugins-system | `PromptFailure` typed result                                          | `accessibility-prompt-refusal` |
| 07#1 fs dangling symlink        | plugins-data   | `fs-scope-path.ts` resolves a failed `realpath` through `readlink`    | `fs-scope-dangling.test.ts` |
| 07#2 downloads dangling symlink | plugins-data   | `downloads-scope.ts` same                                            | `downloads-scope.test.ts`   |
| 07#3 list size leak             | plugins-data   | `fs.ts` `entrySize()` gated on `scope.check`                          | `fs-scope-dangling.test.ts` |
| 07#4 clipboard-order bug        | plugins-data   | `clipboard-image.ts` `instanceof` before length                       | `clipboard-image.test.ts`   |
| 08#1 closed label unknown       | plugins-ui     | `window-args.ts` probes `isOpen` when `list()` omits it                | closed-label suite          |
| 08#2 double stale-lock win      | plugins-ui     | new `single-instance-lock.ts`, compare-and-delete                     | stale-lock race suite       |
| 08#3 `__proto__` label          | plugins-ui     | `window-persist-store.ts` null-prototype map                          | proto-label suite           |
| 08#4 protocol-relative URL      | plugins-ui     | `window-create.ts` treats `//host` as absolute                        | create-origin suite         |
| 09#1 throw in close listener    | runtime        | `app.ts` quits anyway and names the listener                          | `app-run.test.ts`           |
| 09#2 crash handlers unarmed     | runtime        | new `runtime-crash-start.ts` arms at launch                           | `runtime-crash-start.test.ts` |
| 09#3 silent guard failure       | runtime        | `runtime-plugins.ts` warns once, naming the reason                    | same                        |
| 09#4 config-only window watch   | runtime        | `app-loop.ts` reads `platform.windowLabels()`, with a config fallback  | `app-run.test.ts`           |
| 19#3 shared `store.json`        | runtime        | `runtime-plugins.ts` passes `root: appRoot`                            | `runtime-plugins.test.ts`   |
| 10#1 `spctl -t install`          | packaging      | execute form                                                          | `notarize-plan.test.ts`     |
| 10#2 AppImage icon              | packaging      | root `<id>.png` + `.DirIcon`                                          | `appimage.test.ts`          |
| 10#3 submit exit ignored        | packaging      | fails before the `accepted` continue                                  | `notarize.test.ts`          |
| 10#4 NSIS shipped every format  | packaging      | `File "<dist>/<binary>"`, not `File /r`                               | `nsis.test.ts` + probe      |
| 10#5 NSIS output location       | packaging      | artefact and script land in `dist`                                    | `nsis.test.ts`              |
| 10#6 dead `signingReality`      | packaging      | `cli/sign.ts` calls it                                                | `sign.test.ts`              |
| 10#7 `--strict` claim           | packaging      | `verify.ts` passes `--strict`                                         | `verify.test.ts`            |
| 12#1 partial public release     | release        | draft → `publish` only on success; `verify` runs under `always()`      | `release-workflow.test.ts`  |
| 12#2 gate totals unparsed       | release        | `gate.ts` uses `shAll`                                                | `gate.test.ts`              |
| 11#4 stubbed parity surfaces    | release        | unavailable lines fail; probes `mark(false)`                          | `e2e-parity-patterns.test.ts` |
| 11#5 constant detail            | release        | `e2e-native.ts` branches on the assertion                             | `e2e-detail.test.ts`        |
| 11#6 lying survivor detail      | release        | `e2e-notify.ts` names leaked pids                                     | same                        |
| 16#1 basename-only digest       | updater        | `updater-node.ts` hashes the relative path                            | `updater-node.test.ts`      |
| 16#2 unbounded zip reads        | updater        | `assertRange` before every archive read                               | `updater-archive.test.ts`   |
| 16#4 contradictory `linkedPath` | updater        | deleted                                                               | same                        |
| 16#5 unbounded download         | updater        | new `updater-fetch.ts`, 512 MB cap, chunked                           | `updater-fetch.test.ts`     |
| 16#6 followed redirects         | updater        | `redirect: "manual"`, 3xx refused by name                             | same                        |
| 17#2 macOS-only dylib naming    | extensions     | `dylibSuffix()` per platform, `-shared` on Linux/Windows              | `extension-compile.test.ts` |
| 17#3 Windows tools not found    | extensions     | `findTool` probes `.exe` / PATHEXT                                    | `extension-tools.test.ts`   |
| 17#4 no ABI check, cached syms  | extensions     | `ABI_SYMBOL` + `reload()` in the generated module                     | `extension-bindings-abi.test.ts` |
| 17#5 duplicate-extension doc    | extensions     | comment matches behaviour (first wins, second recorded)               | `load.test.ts`              |
| 17#6 unescaped `pgrep -f`       | extensions     | new `extension-pattern.ts` `pgrepLiteral`                             | `e2e-native.ts`             |
| 18#3 no single-file test        | cli            | `single-page.test.ts`, 12 cases                                       | itself                      |
| 19#1 relative `cwdRoot`         | config         | `validate-shell.ts` requires an absolute path                         | `validate-shell.test.ts`    |
| 19#2 `app.id` separators        | config         | `validate-app.ts` refuses `. .. / \`                                  | `validate-app.test.ts`      |
| 13#1–#5, 19#4/#5 doc drift      | docs           | parity + config pages, truth derived from source                      | `docs-reference.test.ts`    |
| 14#1 arity guard one file       | tests          | walks every binding file and the whole C set                          | `arity.test.ts`             |
| 14#2 always-true assertion      | tests          | default `dialogPlugin` imported and exercised                         | `dialog.test.ts`            |
| 14#3 untested status bar        | tests          | `status-bar-item.test.ts` + helpers, 16 cases                         | itself                      |
| 15#1 React double build         | tests          | `templates/react/package.json` build is `crust build`                 | `template-build.test.ts`    |
| 19#4/#5 config reference        | docs           | ten `ROOT_KEYS`, `build.urlScheme`, live plugin list                   | `docs-reference.test.ts`    |
| 21 permissions (new)            | permissions    | `security.capabilities` + `grants`, gated in `createRunner`             | `capabilities.test.ts`      |
| 22 min size on every platform   | minsize        | `minHeight` key, `WM_GETMINMAXINFO`, floor = configured minimum        | `min-size.test.ts`          |

**Nothing is open.** The two rows that said `open` after wave 3 — the token in the document and the
dead `userDataDir` — were closed by the token lane and by `app-loop.ts` deriving the folder from
`app.id`, and the two gaps the parity page could not see (no permission model, no per-platform
minimum size) are now features with their own tests.
