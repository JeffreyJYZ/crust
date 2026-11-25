# Hunt 21 synthesis

Scope: `01-pty.md` … `20-ci-gates.md` plus `21-external-perch.md`. Every HIGH row was checked by opening the cited lines; `HIGH check` is that result. A cluster is one fix, not one file. Severity order: security/data loss → wrong answer → crash → silent lie → wart. Duplicates merged; carry-overs from hunt-20 are in Dropped.

## Ranked findings

| severity | title | report | where (file:line) | cluster | HIGH check |
| --- | --- | --- | --- | --- | --- |
| HIGH | Pinned `updater.pubkey` optional; unsigned artifact installs | 07 | updater-download.ts:42-60, updater-signature.ts:74-84 | documented-boundary-never-engages | confirmed |
| HIGH | `shell.allow` misses execution-capable binaries; allow list stops bounding | 16 | validate-shell.ts:7-18 | documented-boundary-never-engages | confirmed |
| HIGH | Custom CSP with `script-src-elem` bypasses nonce guard | 16 | validate-security.ts:104-123,148-154 | documented-boundary-never-engages | confirmed |
| HIGH | Windows create failure returns handle 0 and aliases app webview | 03 | 57_browser.c:43-55, browser.ts:98-104 | windows-handle-zero-sentinel | confirmed |
| HIGH | `browser.origins` not applied to committed navigations or redirects | 03 | browser.ts:107-132, 107_navigation.c:86-121, 58_browser_events.c:74-84, 31_browser.c:48-77 | origin-gate-entry-only | confirmed |
| HIGH | Concurrent stronghold writes drop secrets; both answer ok | 12 | stronghold.ts:59-65,98-125 | stronghold-write-isolation | confirmed |
| HIGH | Core stronghold uses one vault for every crust app | 12 | core.ts:38-46, stronghold.ts:54 | stronghold-write-isolation | confirmed |
| HIGH | Context menu rewrites live app menu id table; wrong command fires | 13 | menu-api.ts:101-116 | menu-id-table-alias | confirmed |
| HIGH | macOS runtime never passes WKWebViewConfiguration; interception dead | 11 | runtime-plugins.ts:187, network.ts:94-101 | documented-boundary-never-engages | confirmed |
| HIGH | `app.quit()` skips `before-quit`/`will-quit`; save-on-quit lost | 15 | app.ts:177-190, app-window-watch.ts:24-31 | quit-event-sequence-split | confirmed |
| HIGH | `crust build` embeds unvalidated extension exports; app dies at start | 06 | build.ts:105-133, entry-source.ts:35-41,53, registry.ts:22-32 | build-validates-only-existence | confirmed |
| HIGH | Windows `SHIM_SWP_FRAME_ONLY` is `0x34`; style writes move/resize to 0 | 09 | 11_win32_style.c:53-56, 45_style.c:41-48 | win32-style-flag-constant | confirmed |
| HIGH | `bun run test` omits probe/guard regression suites | 20 | package.json:31 | gate-coverage-gaps | confirmed |
| HIGH | Dev watch guard gated on `dev.url`; asset writes restart backend | 21 | dev/runtime.ts:80, ignore.ts:15-19 | dev-instance-isolation | confirmed |
| CRASH | Linux snapshot result global; late callback answers next capture | 08,10 | 90_snapshot.c:30-38,122-155, snapshot.ts:97-144 | async-native-result-without-request-identity | confirmed |
| MEDIUM | Timed-out eval late completion settles next command with stale answer | 05,08,10,13 | testing-darwin.ts:85-96,131-135, snapshot.ts:149-171, find.ts:34-62 | async-native-result-without-request-identity | — |
| MEDIUM | Command against one window blocks on a hung eval on another | 05 | testing-darwin.ts:142,170-171 | async-native-result-without-request-identity | — |
| MEDIUM | Windows `pty.close` emits `pty-exit` with fabricated code 0 | 01 | pty-conpty.ts:67-74, 66_pty_io.c:104-108 | pty-lifecycle-state | — |
| MEDIUM | Naturally exited terminal never closed or pruned; `list()` lies | 01 | pty.ts:55-59,114-127,169-174 | pty-lifecycle-state | — |
| MEDIUM | No emit budget or backpressure on `pty-data` | 01 | pty-stream.ts:11,22-39, events.ts:82-90 | pty-stream-unbounded | — |
| MEDIUM | Scope checked on canonical path, raw string opened (TOCTOU) | 02 | preview.ts:95-98, darwin/preview.ts:111-115 | preview-scope-toctou | — |
| MEDIUM | macOS surface open/close leaks NSView, WKWebView, config, delegates | 03,08 | browser.ts:80-104, 131_browser.c:50-77 | native-object-ownership | — |
| MEDIUM | Autorelease pool never created or drained; `+1` Cocoa objects retained | 08 | 50_app.c:39-49,84-106, index.ts:136-138 | native-object-ownership | — |
| MEDIUM | AXChildren refusal reported as "AX listed no windows" | 04 | 106_accessibility.c:114-133, accessibility.ts:85-89 | misclassified-native-status | — |
| MEDIUM | `trusted`/`elementCount` throw instead of typed refusal | 04 | accessibility-trust.ts:55-58,85-101 | typed-refusal-contract | — |
| MEDIUM | Page a11y tree omits shadow DOM and falsely refuses focus | 04 | a11y-page.ts:138-145,171-180 | shadow-dom-tree | — |
| MEDIUM | Native symbol named after generated local makes unparseable module | 06 | extension-names.ts:58-61, extension-bindings.ts:76-105 | extension-bindings-validation | — |
| MEDIUM | Failed `reload()` closes the working dylib handle | 06 | extension-bindings.ts:84-104 | extension-bindings-validation | — |
| MEDIUM | Zip symlink redirects later writes; digest describes wrong tree | 07 | updater-node.ts:111-126, updater-slip.ts:44-65 | updater-integrity | — |
| MEDIUM | Deflated entry inflates unbounded; 512 MB wire to hundreds of GB | 07 | updater-archive.ts:96-106,117, updater-fetch.ts:16 | updater-integrity | — |
| MEDIUM | Relaunch failure after successful swap reported inside `ok: true` | 07 | updater.ts:151-157 | updater-answer-shape | — |
| MEDIUM | `install` cannot say rollback also failed; app at `appPath` absent | 07 | updater-node.ts:140-150, updater.ts:158-160 | updater-answer-shape | — |
| MEDIUM | Second file pick parsed as multi-select from stale buffer bytes | 09 | 48_dialog.c:116-126, 48_dialog_paths.c:26-52 | win32-buffer-reuse | — |
| MEDIUM | Title-bar close consumes a min-size slot permanently | 09 | 20_class.c:60-67, 44_minsize.c:10-40 | win32-slot-lifecycle | — |
| MEDIUM | Linux `close` drops host wrapper without destroying GtkFixed | 03,10 | 30_webview.c:147-154, 42_host.c:20-29 | linux-host-wrapper-leak | — |
| MEDIUM | Tray menu flattens labels on `\n`; clicks hit wrong handler | 10 | 81_tray.c:101-137,71-75, tray-args.ts:43-63 | tray-delimiter-injection | — |
| MEDIUM | Second `navigation.start` deletes first page's listener | 11 | darwin/navigation.ts:112-130, 107_navigation.c:160-180 | listener-map-mutation | — |
| MEDIUM | `deep-link.scheme` always not-implemented; scheme guard inert | 11 | deep-link.ts:72-97, runtime-plugins.ts:133-135,191 | documented-boundary-never-engages | — |
| MEDIUM | Later deep links stored but never delivered to a page | 11 | app-loop.ts:117-125, darwin/deep-link.ts:100-115 | deep-link-delivery | — |
| MEDIUM | Windows keychain target names collide on `\` | 12 | keychain.ts:62-71, 48_keychain.c:91-104 | keychain-name-validation | — |
| MEDIUM | Find/repeat in one window searches another window's text | 13 | 108_find.c:37,118-131,145-156, find.ts:120-165 | global-state-without-window-key | — |
| MEDIUM | Overlapping find completion answers the newer search | 13 | find.ts:34-38,45-62,65-107 | async-native-result-without-request-identity | — |
| MEDIUM | Repeated `sleepPrevent` leaks first assertion; `sleepAllow` reports released | 13 | 105_power.c:133-176, power.ts:124-144 | single-resource-handle | — |
| MEDIUM | Shortcut unregister drops bookkeeping before OS agrees | 13 | darwin/shortcuts.ts:148-164, 93_shortcuts.c:98-108 | state-before-os-confirm | — |
| MEDIUM | Bare key accepted as a global hotkey | 13 | shortcut-accelerator.ts:78-107, 93_shortcuts.c:82-93 | missing-input-validation | — |
| MEDIUM | One invoke fills disk; each failed line written twice | 14 | records.ts:36-52,70-92, plugins/logging.ts:128-133 | unbounded-log-input | — |
| MEDIUM | `Error` redacts `message` but not `stack`; secret leaks in stack[0] | 14 | redact.ts:110-117 | redaction-incomplete | — |
| MEDIUM | Crash guard watches pid by number only; recycled pid orphans it | 15 | runtime-crash-guard.ts:42-50,153-159 | pid-identity | — |
| MEDIUM | `logging.dir` escapes app data root with `..` | 16 | validate-logging.ts:26-29, logging/paths.ts:33-39 | config-path-containment | — |
| MEDIUM | `build.assets` accepts absolute and climbing paths | 16 | validate-build.ts:19, resolve-assets.ts:42-83 | config-path-containment | — |
| MEDIUM | Duplicate `windows[].label` validates then crashes startup | 16 | validate-windows.ts:33-56, app-windows.ts:56-67 | config-validation-gaps | — |
| MEDIUM | Failed build leaves partial `.app` that `package` and `doctor` certify | 17 | packaging/app.ts:83-128, util.ts:130-143, cli/doctor/bundle.ts:17-37 | false-success-artifacts | — |
| MEDIUM | Repeated boolean flag silently drops release stage or scaffold | 17 | cli/argv.ts:43-44,85-90 | cli-flag-normalization | — |
| MEDIUM | `doctor` says bun ok on host where build cannot spawn bun | 17 | cli/doctor/environment.ts:63, packaging/build.ts:77 | false-success-artifacts | — |
| MEDIUM | Regex literal makes `hasDefaultExport` false; single file loads blank | 18 | single-export.ts:10-72 | single-file-scan | — |
| MEDIUM | `typedClient` cannot call a plugin command though docs say it can | 18 | typed.ts:24-26,83-88, client/install.ts:129-132 | bridge-api-contract | — |
| MEDIUM | Under `crust dev` every window carries `main`'s grants | 18 | runtime-host.ts:61-77, vite.ts:37-53 | dev-prod-divergence | — |
| MEDIUM | Ad-hoc `keychain.set` refusal not documented; visibility app-side | 21 | plugins/keychain.ts:123-137 | keychain-adhoc-doc | — |
| MEDIUM | Single-instance lock id cannot be isolated per project or instance | 21 | single-instance-lock.ts:28-35,43-51 | dev-instance-isolation | — |
| MEDIUM | `check:lines` skips real source tree because `SKIP` contains `build` | 20 | line-cap.ts:14,29, cli/build/** | gate-coverage-gaps | — |
| MEDIUM | `check:links` ignores navigation every docs page renders | 20 | check-links.ts:29-37, site/lib/nav.ts | gate-coverage-gaps | — |
| MEDIUM | Agent memory states three fixed security holes as live | 19 | docs/agents/defects.md:3-5 | stale-agent-memory | — |
| LOW | Windows discards plugin env; `TERM` never set | 01,19 | pty-conpty.ts:31-41, 65_pty_open.c:140 | pty-env-divergence | — |
| LOW | `pty.write` counts UTF-16 units, not UTF-8 bytes (doc says bytes) | 01,19 | pty-args.ts:89-94, pty/page.mdx:27 | pty-arg-validation | — |
| LOW | Fractional terminal sizes silently floored | 01 | pty-args.ts:26-41 | pty-arg-validation | — |
| LOW | Failed macOS show/hide reported as `not-implemented` | 02 | preview-surface.ts:63-80 | typed-refusal-contract | — |
| LOW | Compiled preview unit is a predictable, never-cleaned temp file | 02 | darwin/preview-unit.ts:80-84 | predictable-temp-source | — |
| LOW | Refused `-addSubview:` ignored; invisible surface answers ok | 03 | darwin/browser.ts:85, 131_browser.c:67-72 | false-success-artifacts | — |
| LOW | `focus` never returns `bad-request` for an unknown label | 04 | accessibility-page.ts:147-154 | typed-refusal-contract | — |
| LOW | `waitFor` reports configured budget as elapsed and returns raw failure | 05 | testing-observe.ts:43-62 | testing-honesty | — |
| LOW | Every evaluated script buffer retained for process lifetime | 05 | testing-darwin.ts:98-99,121-124 | testing-honesty | — |
| LOW | `click`/`clickAt` answer `clicked:true` without proving a click landed | 05 | testing-script.ts:79-92 | testing-honesty | — |
| LOW | Fake selector engine certifies selectors that fail in a real page | 05 | testing-fake-dom.ts:46-65, fake-document.ts:34-50 | testing-honesty | — |
| LOW | `renderBindings` accepts invalid FFI types and duplicate names | 06 | extension-bindings.ts:59-62,97-104 | extension-bindings-validation | — |
| LOW | `fetchJson` reads manifest with no byte cap | 07 | updater-node.ts:57-65 | updater-integrity | — |
| LOW | Download and extraction temp directories never removed | 07 | updater-node.ts:91-93,110 | predictable-temp-source | — |
| LOW | Pinned and manifest keys compared as text, so spellings disagree | 07 | updater-signature.ts:11-18,36-40 | key-canonicalisation | — |
| LOW | Non-canonical `pubkey` imports as a different key | 07 | updater-signature.ts:11-18, validate-updater.ts:5-6 | key-canonicalisation | — |
| LOW | Hostile entry collision answers `download-failed`, not `invalid-archive` | 07 | updater-node.ts:110-127,79-87 | updater-answer-shape | — |
| LOW | Stale fullscreen record restored onto reused HWND | 09 | window-fullscreen-adapter.ts:64-81 | win32-slot-lifecycle | — |
| LOW | Over-long `args` silently dropped by ConPTY spawn | 09 | 65_pty_open.c:127-138, pty-conpty.ts:33-41 | pty-arg-validation | — |
| LOW | Linux view-state table never frees a slot; 33rd view loses state | 10 | 32_view_state.c:12,41-64, 30_webview.c:94-107 | linux-slot-table-leak | — |
| LOW | Host created with all 32 slots taken is leaked | 10 | 42_host.c:31-47 | linux-slot-table-leak | — |
| LOW | `allow` body at exactly `NETWORK_BODY_LIMIT` drops last byte | 11 | network-rules.ts:66-72, 113_network_serve.c:11,46-50 | off-by-one-bound | — |
| LOW | Linux keychain silently truncates a secret containing NUL | 12 | keychain.ts:127-131, cstring.ts:5-7, 70_keyring.c:94-107 | keychain-buffer-truncation | — |
| LOW | Windows `keychain.get` can return a truncated secret | 12 | windows/keychain.ts:45-61, 48_keychain.c:130-152 | keychain-buffer-truncation | — |
| LOW | `isDefault` is a shape check; caller-built bar claims default | 13 | 98_menu_read.c:131-142, menu-readback.ts:38-40 | menu-id-table-alias | — |
| LOW | `theme.current` throws; `set` flips override before readback | 13 | plugins/theme.ts:48-78, darwin/theme.ts:69-75 | typed-refusal-contract | — |
| LOW | `dock.badgeLabel` answers ok with empty label when native unavailable | 13 | darwin/dock.ts:76-82, plugins/dock.ts:106-109 | false-success-artifacts | — |
| LOW | Redaction misses `jwt`/`auth`/`bearer`/`session`, `?apiKey=`, `Cookie:` | 14 | redact.ts:16-56,62-68 | redaction-incomplete | — |
| LOW | `tail` raw path returns unredacted credential from truncated line | 14 | sink.ts:135-140, record.ts:56-66 | redaction-incomplete | — |
| LOW | `errors.jsonl` is a second copy of every page warn | 14 | sink.ts:92-98, rotate.ts | unbounded-log-input | — |
| LOW | `sidecar.kill` answers ok for a child that already exited | 15 | sidecar-commands.ts:89-115 | false-success-artifacts | — |
| LOW | `plugins: [""]` validates, then fails with a plain error | 16 | schema.ts:58, runtime-shim.ts:29-47 | config-validation-gaps | — |
| LOW | `app.icon` accepts absolute path with no containment check | 16 | validate-app.ts:18, cli/build.ts:70-79 | config-path-containment | — |
| LOW | `browser.origins` accepts credentials that are silently dropped | 16 | validate-features.ts:46-66, browser-origin.ts:14-24 | config-validation-gaps | — |
| LOW | Combined short flags (`-hv`) ignored by help/version check | 17 | cli/index.ts:86-87 | cli-flag-normalization | — |
| LOW | Documented `crust-security:` pragma in a `<pre>` configures the app | 18 | single-detect.ts:33-57 | single-file-scan | — |
| LOW | Console tap throws out of `console.log` for a throwing `toString` | 18 | page-console.ts:38-59 | bridge-api-contract | — |
| LOW | `crust.ready` resolves on a 401/403/404 refusal | 18 | client/invoke.ts:140-144, install.ts:42-52 | bridge-api-contract | — |
| LOW | `once()` has no timeout; listener retained for page lifetime | 18 | client/install.ts:115-121 | bridge-api-contract | — |
| LOW | `.crust/dev.json` never removed; stale or foreign handshake | 18 | runtime-host.ts:61-85, vite.ts:37-53 | dev-prod-divergence | — |
| LOW | Agent memory calls three wired surfaces "not wired" | 19 | docs/agents/preview-darwin.md:51, changelog-truth.md:10, window-webview.md:28 | stale-agent-memory | — |
| LOW | Browser guide says capture dimensions equal last `setBounds` size | 19 | browser/page.mdx:30 | stale-agent-memory | — |
| LOW | API index says 38 namespaces; its list names 39 | 19 | api/page.mdx:7-17 | stale-agent-memory | — |
| LOW | `skill:check` is not in CI or the release gate | 20 | package.json:45, scripts/skill.ts:83-90 | gate-coverage-gaps | — |

## Dropped

- 21 page-side capture stall / "App Nap" — reporter and owner confirmed focus-dependent WebKit throttling; withdrawn, rule is probes under 15 s, no code change.
- 02 Windows preview host lifecycle — `preview.show` hands no HWND, so that path is unreachable by design; refusal is intentional.
- 11 shared native `reply`/`net_text` cross-talk — needs a live WebKit threading probe and interception is already dead (HIGH above); not claimed as a finding.
- 01 cross-window `pty-data` — already filed in `hunt-20/19-security.md`; not a new pty defect.
- 08 carry-overs: `native()` on a closed window, PREFLIGHT omissions, `+1` Cocoa releases, download cancel/33rd slot — unchanged from `hunt-20/08`, not re-ranked.
- 09 carry-overs: `handler_wait` reentrancy, `screen.list` scale 1, fullscreen HWND reuse — unchanged from `hunt-20/08-windows`, not re-ranked.
- 10 carry-overs: dialog race, WM-close double destroy, display-name placeability, 33rd window, pointer slot reuse, sync clipboard — unchanged from `hunt-20/09-linux`.
- 12 carry-over: unreadable/directory `store.json` read as empty — unchanged from `hunt-20/03-store-db`.
- 15 carry-over: recycled-pid single-instance lock — unchanged from `hunt-20/15`; the lock-id isolation row above is a different defect.
- 17 carry-overs: value-flag coercion, Svelte/Vue watch gaps — unchanged from hunt-20.
- 06 carry-overs: swallowed `readdir`, symlinked discovery, absolute config names, brand-only `isExtension`, stale comment — unchanged from the older extensions report.
- 07 carry-over: swallowed `replaceBundle` rollback — unchanged from `hunt-20/22-error-paths`; the answer-shape row above is new.
- 20 carry-overs: release draft-flip on rerun, `verify-release.ts` not invoked — hunt-20/12-13; no new path found.

## Proposed fix lanes

Ordered by worst finding. Each lane owns disjoint directories; carve-outs are named lines inside a file another lane owns.

1. **Security gates** — `src/config/**`, `src/plugins/updater-*.ts`, `src/bridge/server/assets.ts`, `src/bridge/server/csp.ts`. Signed-or-refuse gate, CSP3 directive resolution, interpreter warning, updater integrity and answer shape, config path/validation gaps.
2. **Persistence and secrets** — `src/plugins/stronghold*.ts`, `src/plugins/store-file.ts`, `src/plugins/store-scope.ts`, `src/plugins/core.ts`, `src/plugins/keychain.ts`, `src/platform/{darwin,windows,linux}/keychain*` and their shims. File lock across instances, per-app vault, key name collisions, ad-hoc doc.
3. **Windows and Linux native** — `src/platform/windows/**`, `src/platform/linux/**` (minus keychain). `0x34` flag, handle-0 sentinel, snapshot generation id, GtkFixed host, tray delimiter, min-size and view-state slots, buffer reuse.
4. **Darwin native** — `src/platform/darwin/**` (minus keychain), `src/plugins/preview*.ts`, `src/runtime-network.ts`, plus the `darwinNetworkPlugin()` line in `src/runtime-plugins.ts`. Preview owner threading, autorelease/ownership, menu id table, find query key, AX status, network wiring.
5. **Embedded surfaces** — `src/plugins/browser*.ts`, `src/plugins/network*.ts`, `src/plugins/navigation*.ts`, `src/plugins/deep-link.ts`, `src/plugins/accessibility*.ts`, `src/bridge/client/a11y-page.ts`. Navigation decision hook, listener map restore, deep-link delivery and scheme, shadow-DOM tree.
6. **CLI, build, dev and gates** — `src/cli/**`, `src/packaging/**`, `src/plugins/single-instance-lock.ts`, `src/vite.ts`, `src/runtime-host.ts`, `package.json`, `scripts/harness/**`, `scripts/line-cap.ts`, `scripts/check-links.ts`, `scripts/skill.ts`, `scripts/release/**`. Dev watch guard and lock id together, build validation, flag normalisation, bundle honesty, test/link/line coverage.
7. **Runtime lifecycle** — `src/app.ts`, `src/app-*.ts`, `src/runtime*.ts` (except `runtime-network.ts`), `src/child-reap.ts`, `src/single-*.ts`. Quit event sequence, crash-guard identity, single-file scanner.
8. **Plugin surfaces, logging and docs** — `src/plugins/{pty*,testing*,sidecar*,shell*,shortcuts*,power*,theme*,dock*,tray*,find*,downloads*,opener*}.ts`, `src/logging/**`, `src/bridge/client/**` (minus `a11y-page.ts`), `src/bridge/typed.ts`, `docs/agents/**`, `site/app/docs/**`, `site/lib/nav.ts`, `site/public/SKILL.md`. Async request ids, pty lifecycle and bounds, shell chrome, redaction and log caps, stale memory and guides.
