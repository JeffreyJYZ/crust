# Hunt-21 fix-wave closure audit

Scope: every row of `SYNTHESIS.md` (rows 9–114, 106 rows) audited against merged `main` at `0846df6`.
A lane report is a claim; each `fixed` below was checked by opening the cited file on `main` and
finding both the change and a test that would fail without it. Rows marked source-only have no
test — the fix lives in docs/config/C source with no executable assertion. No table row was
withdrawn or unreachable, so `dropped` is empty; the SYNTHESIS "Dropped" section is separate.

Second audit (wave 2): the 20 rows that were `open` at `e33c5fa` were re-checked against merges
#53 (extensions), #54 (deep-link), #55 (bridge), #56 (darwin/preview) and #57 (testing/pty/sidecar).
Every one of those rows had its target file last touched by one of those five commits, and each
carries a fix plus a failing-without-it test on `main`; all 20 verdicts below are corrected.
A `regression check` confirms the five highest-severity fixed rows survived the wave-2 sequence.

Verdict key: `fixed` — change + test present on `main`; `open` — defect still reachable;
`dropped` — none. `S` marks source-only (no test).

| # | Sev | Verdict | Evidence on `main` |
| --- | --- | --- | --- |
| 9 | HIGH | fixed | `src/plugins/updater-download.ts:48` gates signature when `pubkey` pinned; `src/plugins/updater-hunt21-lifecycle.test.ts` ("signed-capable app refuses an unsigned artifact"). |
| 10 | HIGH | fixed | `src/config/validate-shell.ts:14,111` warns on execution-capable programs; `src/config/hunt21-security.test.ts` ("warns for every program whose argv can execute a command"). |
| 11 | HIGH | fixed | `src/config/validate-security.ts` `scriptDirective()` resolves CSP3 order; `hunt21-security.test.ts` ("loose script-src-elem wins over strict script-src"). |
| 12 | HIGH | fixed | `src/platform/windows/shim/57_browser.c` returns -1; adapter refuses `<=0`; `src/platform/windows/browser.test.ts` ("create that answers handle 0 is a failure"). |
| 13 | HIGH | fixed | `src/plugins/browser.ts:116` builds the decision; all three adapters consult it — darwin `browser-navigation-policy.ts` + `shim/110_navigation_policy.c`, windows `browser-navigation.ts` + `shim/58_browser_events.c`, linux `browser-navigation.ts` + `shim/31_browser.c`. Tests: `src/plugins/browser-navigation.test.ts` + `browser-navigation.test.ts` in each platform tree. Deferral closed by lanes 4/3. |
| 14 | HIGH | fixed | `src/plugins/stronghold.ts` takes the path-keyed file lock and re-reads inside it; `stronghold-concurrency.test.ts` ("concurrent set keeps both secrets"). |
| 15 | HIGH | fixed | `src/runtime-data-plugins.ts` builds stronghold with the app data root; `runtime-plugins-vault.test.ts` ("two app ids can never resolve to one file"). |
| 16 | HIGH | fixed | `src/platform/darwin/menu-api.ts` uses disjoint tag ranges; `menu-id-table.test.ts` ("popping a context menu cannot reindex the app bar"). |
| 17 | HIGH | fixed | `src/runtime-network.ts` passes the shared configuration; `src/platform/darwin/network-registration.ts`; `network-wiring.test.ts`. |
| 18 | HIGH | fixed | `src/app-quit.ts` `finishQuit`; test `app-quit-events.test.ts` ("app.quit() itself emits before-quit and will-quit"). |
| 19 | HIGH | fixed | `src/cli/build.ts:118-127` calls `validateExtensionEntries()` and fails the build on a bad default/duplicate, embedding only `validated.files`; `src/extensions/entry-source.ts` owns the gate. Tests `src/extensions/entry-validation.test.ts` + `src/extensions/build-validation.test.ts`. Closed by #53. |
| 20 | HIGH | fixed | `src/platform/windows/shim/11_win32_style.c` uses `0x37`; `win32-fixes.test.ts` ("FRAME_ONLY is 0x37"). |
| 21 | HIGH | fixed | `scripts/test-files.ts` discovers all `*.test.ts`; `scripts/test-files.test.ts` ("every *.test.ts under the shipped roots is discovered"). |
| 22 | HIGH | fixed | `src/cli/ignore.ts` + `dev/runtime.ts` ignore frontend extensions without `dev.url`; `src/cli/ignore.test.ts` ("a PNG next to main.ts does not restart even with no dev.url"). |
| 23 | CRASH | fixed | `src/platform/linux/shim/90_snapshot.c:40,170` generation as callback data; `src/platform/linux/snapshot.ts:135-139`; `snapshot.test.ts` ("late result cannot answer a later capture"). Lane 3 closed lane 8's deferral. |
| 24 | MEDIUM | fixed | `src/plugins/testing-eval-queue.ts` request ids + darwin `shim/125_snapshot_ids.c`, `shim/109_find_ids.c`; tests `testing-eval-queue.test.ts`, `snapshot-unit.test.ts`, `find-isolation.test.ts`. |
| 25 | MEDIUM | fixed | `src/plugins/testing-eval-queue.ts` `createLabeledQueue`; `testing-eval-queue.test.ts` ("hung command on one window does not hold up another"). |
| 26 | MEDIUM | fixed | `src/plugins/pty.ts:125-130,180` maps page close to `{exitCode:null,signal:"SIGTERM"}` regardless of the shim code; `pty-lifecycle.test.ts` ("page close reports a termination"). ConPTY half not needed for the page-visible defect. |
| 27 | MEDIUM | fixed | `src/plugins/pty.ts:80-83,133-143` prunes dead records; `pty-lifecycle.test.ts` ("naturally exited terminal leaves the list"). |
| 28 | MEDIUM | fixed | `src/platform/windows/pty-conpty.ts:27,88-94` `MAX_DRAIN_FRAMES=8` bounds `drain()`; `src/bridge/server/events.ts:90-101,140` `emit()` skips full subscribers + `highWaterMark=256`. Tests `src/platform/windows/pty-drain-budget.test.ts` ("one bounded batch per tick"), `src/bridge/server-events.test.ts` ("a subscriber whose queue is full is skipped"). Closed by #57. |
| 29 | MEDIUM | fixed | `src/plugins/preview.ts:98-104` hands the canonical checked path to the surface; `src/plugins/preview.test.ts` ("symlink is opened at the path the scope approved"). |
| 30 | MEDIUM | fixed | `src/platform/darwin/browser.ts:92-99` + `shim/131_browser.c` release +1 objects; `browser-adapter.test.ts` ("close releases every owned object"). |
| 31 | MEDIUM | fixed | `src/platform/darwin/shim/50_app.c` creates/drains the pool; `index.ts` binds exports; `pump-pool.test.ts` ("pool created at entry and drained on every path"). |
| 32 | MEDIUM | fixed | `src/platform/darwin/shim/106_accessibility.c` gives AXChildren its own sentinel; `ax-status.test.ts` ("AXWindows and AXChildren refusals are reported as refusals"). |
| 33 | MEDIUM | fixed | `src/plugins/accessibility-trust.ts:54-59,67-85,113-118` wraps `trusted`/`prompt`/`elementCount` adapter awaits in try/catch → typed `handler-error`; `src/plugins/accessibility-trust-refusal.test.ts` ("a throwing trusted()/elementCount() becomes a typed handler-error"). Closed by #57. |
| 34 | MEDIUM | fixed | `src/bridge/client/a11y-page.ts` walks `shadowRoot` and follows the activeElement chain; `a11y-page.test.ts` ("walks into a shadow root"). |
| 35 | MEDIUM | fixed | `src/packaging/extension-names.ts:63-87` `GENERATED_LOCALS` (ffi/DYLIB/open/reload/…) refused by `checkName()`, called by `renderBindings`; `src/packaging/extension-bindings-validation.test.ts` ("every name the generated module declares at module scope is refused"). Closed by #53. |
| 36 | MEDIUM | fixed | `src/packaging/extension-bindings.ts:126-142` `reload()` opens a fresh copy in try/finally and closes the old handle only after success; `src/packaging/extension-bindings-abi.test.ts` ("a failed reload leaves the working handle usable"). Closed by #53. |
| 37 | MEDIUM | fixed | `src/plugins/updater-slip.ts` refuses entries below symlinks and cycles; `updater-hunt21-integrity.test.ts`. |
| 38 | MEDIUM | fixed | `src/plugins/updater-archive.ts` + `updater-fetch.ts` bound declared and stream sizes; `updater-hunt21-integrity.test.ts` ("deflate stream larger than its declared size is refused"). |
| 39 | MEDIUM | fixed | `src/plugins/updater.ts` answers `relaunch-failed`; `updater-relaunch.test.ts`. |
| 40 | MEDIUM | fixed | `src/plugins/updater-node.ts` + `updater.ts` answer `rollback-failed` with `parkedAt`; `updater-hunt21-lifecycle.test.ts`. |
| 41 | MEDIUM | fixed | `src/platform/windows/shim/48_dialog.c` zeroes the whole name buffer; `win32-fixes.test.ts` ("dialog reset clears the whole name buffer"). |
| 42 | MEDIUM | fixed | `src/platform/windows/shim/20_class.c` resets min-size on `WM_DESTROY`; `window-fullscreen-adapter.test.ts` ("title-bar close frees its minimum-size slot"). |
| 43 | MEDIUM | fixed | `src/platform/linux/shim/42_host.c` destroys the wrapper before forgetting; `native-lifecycle.test.ts` ("closed surface destroys its GtkFixed wrapper"). |
| 44 | MEDIUM | fixed | `src/platform/linux/tray-adapter.ts` + `shim/81_tray.c` refuse `\n` and stop at `count`; `tray-adapter.test.ts`. |
| 45 | MEDIUM | fixed | `src/plugins/navigation-listeners.ts` keeps one delegate with a fan-out; `navigation-events.test.ts` ("two starts on one window keep both listeners"). |
| 46 | MEDIUM | fixed | `src/app-loop.ts:51,99` calls `configureDeepLink(config)` from both platform loaders; `src/app-deep-link.ts:24-26` feeds it to `deepLink.configure()`. `src/runtime-deep-link-wiring.test.ts` ("a configured scheme is the one the mounted plugin answers"). Closed by #54. |
| 47 | MEDIUM | fixed | `src/app-loop.ts:128-140` calls `attachDeepLinkDelivery()` and drains pending URLs each pump tick; `src/app-deep-link.ts:29-58` `queueDeepLink`/`armDeepLinkPage` deliver through the attached sink; `src/runtime-app-deep-link.ts:16` arms a page via the app namespace. `runtime-deep-link-wiring.test.ts` ("a later link reaches an armed page through the attached sink exactly once"). Closed by #54. |
| 48 | MEDIUM | fixed | `src/platform/windows/keychain.ts` refuses `\`; `keychain-target.test.ts` ("backslash refused before advapi32"). |
| 49 | MEDIUM | fixed | `src/platform/darwin/find.ts` keeps a per-webview query; `find-isolation.test.ts` ("next in one window repeats that window's search"). |
| 50 | MEDIUM | fixed | `src/platform/darwin/shim/109_find_ids.c` carries request ids; `find-isolation.test.ts` ("older request cannot settle the newer search"). |
| 51 | MEDIUM | fixed | `src/plugins/power.ts` reuses one assertion; `power.test.ts` ("second sleepPrevent reuses the held assertion"). |
| 52 | MEDIUM | fixed | `src/platform/darwin/shortcuts.ts:153-180` keeps `ids`/`byId` until the OS agrees; `src/platform/darwin/shim/93_shortcuts.c` keeps native refs on refusal; tests `shortcuts.test.ts` + `shortcuts-c.test.ts` ("a refused removal keeps the ref, so a retry reaches the OS again"). Closed by #56. |
| 53 | MEDIUM | fixed | `src/plugins/shortcut-accelerator.ts` requires a modifier; `shortcuts.test.ts` ("unknown modifier, repeat, unknown key each name themselves"). |
| 54 | MEDIUM | fixed | `src/logging/records.ts` + `src/plugins/logging.ts` cap page fields and line length; `records.test.ts` ("megabyte-long name cannot write a megabyte-long line"). |
| 55 | MEDIUM | fixed | `src/logging/redact.ts` passes stack lines through the text redactor; `redact.test.ts` ("stack does not repeat the credential removed from its message"). |
| 56 | MEDIUM | fixed | `src/runtime-crash-guard-token.ts` + `runtime-crash-guard-watch.ts`; `runtime-crash-guard-identity.test.ts` ("lost token ends the watch while pid alive"). |
| 57 | MEDIUM | fixed | `src/config/validate-logging.ts` + `path-rule.ts`; `hunt21-paths.test.ts` ("logging.dir refuses a climb and a Windows absolute"). |
| 58 | MEDIUM | fixed | `src/config/validate-build.ts` uses the same containment; `hunt21-paths.test.ts` ("build.assets refuses an absolute or climbing path"). |
| 59 | MEDIUM | fixed | `src/config/validate-windows.ts` rejects duplicate labels by index; `hunt21-security.test.ts`. |
| 60 | MEDIUM | fixed | `src/packaging/app.ts` stages then renames; `src/cli/doctor/bundle.ts` checks Info.plist; `complete-bundle.test.ts` + `find-bundle.test.ts`. |
| 61 | MEDIUM | fixed | `src/cli/argv.ts` normalises boolean arrays; `argv-normalize.test.ts` ("repeated stage and scaffold flags survive"). |
| 62 | MEDIUM | fixed | `src/cli/doctor/environment.ts` uses `Bun.which`; `bun-check.test.ts` ("unresolvable bun is a failure"). |
| 63 | MEDIUM | fixed | `src/single-export.ts` uses `Bun.Transpiler.scan`; `single-export-regex.test.ts` ("regex before a default export"). |
| 64 | MEDIUM | fixed | `src/bridge/typed.ts:98-120` `invoke()` addresses `app.invoke` with a 3-arg call so a string input stays data, and `invokePlugin()` splits dotted keys; `src/bridge/typed.test.ts` ("a string input stays the app command's argument", "invokePlugin splits a dotted map key"). Closed by #55. |
| 65 | MEDIUM | fixed | `src/runtime-host.ts` mints label-bound tokens; `src/vite.ts` selects by `?window=`; `src/bridge/dev-label-token.test.ts` ("served page cannot fetch another label's token"). |
| 66 | MEDIUM | fixed (S) | `site/app/docs/guides/keychain/page.mdx` + `site/public/SKILL.md` document the ad-hoc entitlement refusal; no test — doc-only. Lane 6 skipped it, lane 2 (#48) closed it. |
| 67 | MEDIUM | fixed | `src/config/validate-single-instance.ts` + `lockIdFor()` in the runtime; `single-instance-isolation.test.ts` ("one app id in two project dirs names two different locks"). |
| 68 | MEDIUM | fixed | `scripts/line-cap.ts` no longer prunes bare `build`; `line-cap-roots.test.ts`. |
| 69 | MEDIUM | fixed | `scripts/check-links.ts` walks `site/lib/nav.ts`; `check-links.test.ts` ("nav entry pointing at a missing route is reported"). |
| 70 | MEDIUM | fixed (S) | `docs/agents/defects.md:3-5` now says FIXED with code references; no test — doc-only. |
| 71 | LOW | fixed | `src/platform/windows/pty-conpty.ts` `environmentBlock()` + `shim/65_pty_open.c:151-154` passes it with `CREATE_UNICODE_ENVIRONMENT`; `pty-env-block.test.ts` + `pty-spawn-guard.test.ts`. |
| 72 | LOW | fixed | `src/plugins/pty-args.ts` uses `Buffer.byteLength`; `pty-lifecycle.test.ts` ("cap counts UTF-8 bytes"). |
| 73 | LOW | fixed | `src/plugins/pty-args.ts` requires `Number.isInteger`; `pty-lifecycle.test.ts` ("fractional size is refused"). |
| 74 | LOW | fixed | `src/plugins/preview-surface.ts:34-54,86-115` failed show/hide answer typed `preview-failed` with the native reason; `preview.ts:118,136` maps it back. `src/plugins/preview-surface.test.ts` ("a refused show is a typed preview-failed carrying the native reason"). Closed by #56. |
| 75 | LOW | fixed | `src/platform/darwin/preview-unit.ts:85-119` compiles C in a `mkdtempSync` per-process 0700 dir removed in `finally`; `src/platform/darwin/preview-unit.test.ts` ("C source lives in a private dir that is removed on every path"). Closed by #56. |
| 76 | LOW | fixed | `src/platform/darwin/browser.ts:95-100` reads `shim_browser_attach`'s return and tears the half-built surface down on failure; `src/platform/darwin/browser-adapter.test.ts` ("a refused attach is a failure, not an invisible surface answered ok"). Closed by #56. |
| 77 | LOW | fixed | `src/plugins/accessibility-page.ts` classifies "no window matched" as `bad-request`; `accessibility-focus.test.ts` ("unknown label is bad-request"). |
| 78 | LOW | fixed | `src/plugins/testing-observe.ts:47-71` `waitFor` uses `performance.now()` wall time and wraps a probe failure with its own code; `src/plugins/testing-honesty.test.ts` ("waitedMs is the wall time spent, not the configured budget", "a page failure is a structured failure naming the wait"). Closed by #57. |
| 79 | LOW | fixed | `src/plugins/testing-eval-queue.ts` drops the waiter/buffer after settle and `testing-eval.c:138-144` copies bytes into an NSString; `testing-eval-queue.test.ts` ("send that never starts leaves no pending entry"). |
| 80 | LOW | fixed | `src/plugins/testing-script.ts:77-101` `click`/`clickAt` install a listener and answer `clicked:observed, verified:observed`; `src/plugins/testing-honesty.test.ts` ("click claims a click only when a listener on the element observed the event"). Closed by #57. |
| 81 | LOW | fixed | `src/plugins/testing-fake.ts:99-111` marks every fake answer `fake:true`; `src/plugins/testing-honesty.test.ts` ("successes and refusals both carry fake:true"). Closed by #57. |
| 82 | LOW | fixed | `src/packaging/extension-bindings.ts:67-93,101-102` `validateSymbols()` refuses duplicate names and unknown FFI types before emitting; `src/packaging/extension-bindings-validation.test.ts` ("a duplicate symbol name is refused", "an unknown argument type is refused"). Closed by #53. |
| 83 | LOW | fixed | `src/plugins/updater-node.ts` uses a shared bounded read; `updater-hunt21-integrity.test.ts` ("fetchJson's shared bounded read refuses an oversized feed"). |
| 84 | LOW | fixed | `src/plugins/updater-node.ts` cleans temp dirs in `finally`; `updater-hunt21-lifecycle.test.ts` ("refused download removes the directory it created"). |
| 85 | LOW | fixed | `src/plugins/updater-signature.ts` compares decoded key bytes; `updater-hunt21-integrity.test.ts` ("two spellings compare equal by bytes"). |
| 86 | LOW | fixed | `src/config/validate-updater.ts` requires canonical base64; `updater-signature.ts` refuses non-canonical keys; `hunt21-security.test.ts` + integrity test. |
| 87 | LOW | fixed | `src/plugins/updater-node.ts` answers `invalid-archive` on extraction failure; `updater-hunt21-integrity.test.ts`. |
| 88 | LOW | fixed | `src/platform/windows/window-fullscreen-adapter.ts` keys records by label + hwnd and checks `WS_POPUP`; `window-fullscreen-adapter.test.ts` ("stale record is dropped"). |
| 89 | LOW | fixed | `src/platform/windows/shim/65_pty_open.c:137-141` fails spawn when `shim_pty_wide` cannot fit args; `pty-spawn-guard.test.ts`. |
| 90 | LOW | fixed | `src/platform/linux/shim/32_view_state.c` adds `shim_state_forget`, called on close/destroy; `native-lifecycle.test.ts` ("view-state record is compacted away"). |
| 91 | LOW | fixed | `src/platform/linux/shim/42_host.c` resolves the slot before allocating; `native-lifecycle.test.ts` ("full host table refuses before creating a widget"). |
| 92 | LOW | fixed | `src/plugins/network-rules.ts` + `network-types.ts` refuse at the native bound; `network-body.test.ts` ("body at or over the native buffer is refused"). |
| 93 | LOW | fixed | `src/plugins/keychain.ts` refuses NUL, `src/platform/linux/keychain.ts` guards again; `keychain.test.ts` + `platform/linux/keychain.test.ts`. |
| 94 | LOW | fixed | `src/platform/windows/keychain.ts` retries a growing secret; `keychain.test.ts` ("settles after a grow and answers the whole secret"). |
| 95 | LOW | fixed | `src/platform/darwin/shim/98_menu_read.c` compares the installed bar's pointer; `menu-default-identity.test.ts`. |
| 96 | LOW | fixed | `src/plugins/theme.ts` + `theme-types.ts` use typed failures and commit the override after readback; `theme.test.ts` + `theme-set.test.ts`. |
| 97 | LOW | fixed | `src/plugins/dock.ts:118-127` probes with an idempotent `setBadge(label)` and refuses on failure; `dock-commands.test.ts` ("badgeLabel the native unit never read refuses"). Plugin probe makes the skipped darwin half unnecessary. |
| 98 | LOW | fixed | `src/logging/redact.ts` covers jwt/auth/bearer/session, `?apiKey=` and `Cookie:`; `redact.test.ts`. |
| 99 | LOW | fixed | `src/logging/sink.ts` redacts truncated raw fragments before `tail`; `sink.test.ts`. |
| 100 | LOW | fixed | `src/logging/sink.ts` keeps page warnings in `app.jsonl`; `sink.test.ts` ("page warnings do not fill the errors file"). |
| 101 | LOW | fixed | `src/plugins/sidecar-commands.ts:93-113` checks `departed(live.child)` and answers `killed:false`, pruning the record and sending no signal; `src/plugins/sidecar-kill-honesty.test.ts` ("answers killed:false, sends no signal and prunes the record"). Closed by #57. |
| 102 | LOW | fixed | `src/config/schema.ts` rejects blank entries with an index; `hunt21-security.test.ts` ("blank plugins entry is refused with its index"). |
| 103 | LOW | fixed | `src/config/validate-app.ts` + `cli/build.ts` require a contained PNG; `hunt21-paths.test.ts`. |
| 104 | LOW | fixed | `src/config/validate-features.ts` refuses userinfo in origins; `hunt21-security.test.ts`. |
| 105 | LOW | fixed | `src/cli/index.ts` + `argv.ts` decide help/version from parsed keys; `argv-normalize.test.ts` ("combined -hv answers help and version"). |
| 106 | LOW | fixed | `src/single-detect.ts` + `single-pragma.ts` mask `<pre>`/comments/strings; `single-detect-pragma.test.ts`. |
| 107 | LOW | fixed | `src/bridge/page-console.ts:43-55` `text()` wraps `String(value)` in try/catch and records `[unprintable <type>]`; `src/plugins/testing-console.test.ts` ("a value whose toString throws cannot break console.log or lose the record"). Closed by #55. |
| 108 | LOW | fixed | `src/bridge/client/install.ts:52-69` `markHandshake` rejects `ready` on 4xx with the status/reason; `src/bridge/client/invoke.ts:151` passes the real status. `src/bridge/client.test.ts` ("a 401 refusal rejects ready with the status and the bridge's reason"). Closed by #55. |
| 109 | LOW | fixed | `src/bridge/client/install.ts:133-159` `once()` has a named 30 s timeout that removes the waiter on settle/timeout; `src/bridge/client.test.ts` ("once rejects with a named timeout and leaves no waiter behind"). Closed by #55. |
| 110 | LOW | fixed | `src/runtime-host.ts` + `src/dev-handshake-path.ts` moved the handshake out of `.crust` and remove it on stop/exit; `src/bridge/dev-handshake.test.ts` ("removes the file on stop"). Lane 6 closed lane 7's deferral. |
| 111 | LOW | fixed (S) | `docs/agents/preview-darwin.md`, `changelog-truth.md`, `window-webview.md` now mark the surfaces wired; no test — doc-only. |
| 112 | LOW | fixed (S) | `site/app/docs/guides/browser/page.mdx:30` now states page pixels = bound × scale; no test — doc-only. |
| 113 | LOW | fixed (S) | `site/app/docs/reference/api/page.mdx:7` now says 34 registered + 5 conditional = 39; no test — doc-only. |
| 114 | LOW | fixed | `.github/workflows/ci.yml` + `scripts/release/gate.ts` run `skill:check`; `scripts/release/gate.test.ts` ("gate checks the committed SKILL.md command table"). |

Counts: **fixed 106** (101 with a test, 5 source-only) / **open 0** / **dropped 0**.

## Still open

None. All 20 rows that were open at `e33c5fa` closed in wave 2 (#53–#57); each verdict is corrected
in the table above, with the file and test that prove it. Summary by row:

**HIGH**
- #19 — fixed: `src/cli/build.ts:118-127` validates then embeds only clean exports; `entry-validation.test.ts` + `build-validation.test.ts` (#53).

**MEDIUM**
- #28 — fixed: `pty-conpty.ts:27,88-94` bounds `drain()` and `server/events.ts:90-101,140` bounds `emit()`; `pty-drain-budget.test.ts` + `server-events.test.ts` (#57).
- #33 — fixed: `accessibility-trust.ts:54-118` returns typed `handler-error` on adapter throw; `accessibility-trust-refusal.test.ts` (#57).
- #35 — fixed: `extension-names.ts:63-87` refuses generated-local symbol names; `extension-bindings-validation.test.ts` (#53).
- #36 — fixed: `extension-bindings.ts:126-142` opens a fresh image before closing the working handle; `extension-bindings-abi.test.ts` (#53).
- #46 — fixed: `app-loop.ts:51,99` calls `configureDeepLink()`; `runtime-deep-link-wiring.test.ts` (#54).
- #47 — fixed: `app-loop.ts:128-140` + `app-deep-link.ts:29-58` attach and deliver; `runtime-deep-link-wiring.test.ts` (#54).
- #52 — fixed: `darwin/shortcuts.ts:153-180` + `shim/93_shortcuts.c` keep bookkeeping until the OS agrees; `shortcuts.test.ts` + `shortcuts-c.test.ts` (#56).
- #64 — fixed: `bridge/typed.ts:98-120` adds `invokePlugin()` and routes `invoke()` through `app.invoke`; `typed.test.ts` (#55).

**LOW**
- #74 — fixed: `preview-surface.ts:34-54,86-115` answers typed `preview-failed`; `preview-surface.test.ts` (#56).
- #75 — fixed: `preview-unit.ts:85-119` compiles in a private dir removed in `finally`; `preview-unit.test.ts` (#56).
- #76 — fixed: `darwin/browser.ts:95-100` checks `shim_browser_attach`'s return; `browser-adapter.test.ts` (#56).
- #78 — fixed: `testing-observe.ts:47-71` reports wall time and wraps probe failures; `testing-honesty.test.ts` (#57).
- #80 — fixed: `testing-script.ts:77-101` proves the click with a listener; `testing-honesty.test.ts` (#57).
- #81 — fixed: `testing-fake.ts:99-111` marks every answer `fake:true`; `testing-honesty.test.ts` (#57).
- #82 — fixed: `extension-bindings.ts:67-93,101-102` validates names/types before emitting; `extension-bindings-validation.test.ts` (#53).
- #101 — fixed: `sidecar-commands.ts:93-113` answers `killed:false` on a departed child; `sidecar-kill-honesty.test.ts` (#57).
- #107 — fixed: `page-console.ts:43-55` catches a throwing `toString`; `testing-console.test.ts` (#55).
- #108 — fixed: `client/install.ts:52-69` rejects `ready` on 4xx; `client.test.ts` (#55).
- #109 — fixed: `client/install.ts:133-159` times out `once()` and clears the waiter; `client.test.ts` (#55).

## Regression check

The five highest-severity fixed rows, re-opened on `main` at `0846df6` after the wave-2 sequence:

- #9 updater signature gate — intact: `updater-download.ts:48` still refuses a missing signature with a pinned `pubkey`.
- #10 shell.allow warning — intact: `validate-shell.ts:112-115` still `console.warn`s on execution-capable argv.
- #11 CSP directive resolution — intact: `validate-security.ts:112-126` still resolves `script-src-elem` → `script-src` → `default-src`.
- #15 stronghold per-app vault — intact: `runtime-plugins.ts:48,74` still computes `appRoot` and passes it to `dataPlugins()`.
- #20 Windows `0x37` mask — intact: `shim/11_win32_style.c:67` still ORs NOSIZE/NOMOVE/NOZORDER/NOACTIVATE/FRAMECHANGED = `0x37`.

## Open count

HIGH 0 · CRASH 0 · MEDIUM 0 · LOW 0 — total **0**.
