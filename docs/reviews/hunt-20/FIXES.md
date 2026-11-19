# Hunt 20 — fixes

All 23 lanes reported. Findings were validated in `VALIDATION.md` (reproduced, or read with the
mechanism confirmed). This file is the fix list, one section per lane. **Each lane does one section
only**, and the "Own" line is the boundary — other lanes are editing this same tree.

Order matters: FIX 1–5 are a crash, a security hole and two data-loss paths in a shipped release.

---

## FIX 1 — `createFsPlugin` TDZ crash on Windows and Linux

`src/runtime-plugins.ts:54` builds `scoped`, which calls `createFsPlugin`, but `createFsPlugin` is
destructured at `:118` from an `await import` that the non-darwin early return at `:82` never reaches.

Reproduced: `nativePlugins(corePlugins, undefined, { fs: { scope: ["/tmp"] } }, "win32")` →
`ReferenceError: Cannot access 'createFsPlugin' before initialization.`

Every Windows and Linux app with `fs.scope` dies on start, and `v0.1.32` ships it.

Fix: make `createFsPlugin` available before `scoped` can run — a static import at the top, or move the
destructure above the early return. Then a test that calls `nativePlugins(…, "win32")` with a scope and
asserts it resolves; that test would have caught it.

Own: `src/runtime-plugins.ts` and one test file. Nothing else.

---

## FIX 2 — `fs` scope escape through a symlinked `..`

`fs-scope-path.ts` `canonical()` folds `..` lexically (`resolve()`), then the command runs the **raw**
string, which the OS resolves through the symlink. Reproduced: `…/scope/link/../secret.txt` is allowed
by `contains()` and reads a file outside the grant.

Fix: resolve the real path of the raw string (no `resolve()` first) so `realpath` sees `link/..`, or
return the canonical path from the check and **operate on that**. Keep the missing-leaf and
dangling-symlink behaviour the existing comment describes, and keep the store-path refusal.

Test: the escape above must fail before the fix and pass after. `rg canonical(` for every caller.

Own: `src/plugins/fs-scope-path.ts`, `src/plugins/fs-scope.ts`, fs tests.

---

## FIX 3 — a page can choose another window's label

Two paths, both validated:

- `window-create.ts:76` — `bridgeOwned ? url : withWindowLabel(...)`: a bridge-owned absolute URL keeps
  the page's own `?window=`, so the minted document token binds to a **page-chosen label**
  (`handler.ts:78-86`). A page with only `window:create` gets another window's grants.
- `vite.ts:78` — a dev page receives the **process** token in `window.__CRUST__`, and the process token
  may mint any label. Dev-only, but it makes per-window separation fiction in `crust dev`.

Fix: the label must come from the token or from the runtime, never from the query string the page
controls. Strip/replace any page-supplied `window=` on a bridge-owned URL before the token is added, and
refuse a mint whose label does not match the creating window's authority.

Also in scope, same field: document tokens are never deleted from `state.labels` (`handler.ts:79`), so
the map grows per navigation and a closed window's credential stays valid — bound it or revoke on close.

Own: `src/plugins/window-create.ts`, `src/bridge/server/handler.ts`, `src/platform/darwin/vite.ts`,
`src/bridge/window-identity.ts` + tests.

---

## FIX 4 — Windows: closing any window quits, and eight closes wedge the process

`20_class.c:49-56`:

```c
if (msg == SHIM_WM_CLOSE)  { DestroyWindow(hwnd); return 0; }
if (msg == SHIM_WM_DESTROY) { PostQuitMessage(0); return 0; }
```

- `WM_DESTROY` posts a quit **unconditionally**, so closing one of three windows ends the app — not
  what `window-all-closed` means anywhere else.
- The title-bar X never calls `shim_webview_close`, so the controller slot is never handed back. Eight
  user closes exhaust the eight-slot table and every later `window.create` refuses — the comment in
  `42_webview.c:159` explains exactly why that release exists.

Fix: release the slot on `WM_DESTROY` (or route `WM_CLOSE` through the same teardown), and post the
quit message only when the last tracked window is gone — the runtime's own `window-all-closed` watcher
already decides when the app should end, so the shim must not pre-empt it.

Test with the fake shim: close one of two windows and assert no quit; close both and assert one quit;
close eight and assert a ninth `create` still binds.

Own: `src/platform/windows/shim/20_class.c`, `42_webview.c` and their tests.

---

## FIX 5 — `before-quit` never fires on the normal quit

`app.ts:163-172`: `window-all-closed` → `platform.quit()` → `immediate()` → `process.exit(0)`.
`before-quit` is emitted only from the platform lifecycle source, so the most common quit skips it and
anything saved in that listener is lost. `app-types.ts:75` already documents that `platform.quit()` is
the wrong call here.

Fix: on `window-all-closed`, emit `before-quit` (and `will-quit` if it has the same shape) before
quitting, with the same "a throwing listener is named and does not block termination" rule the existing
code uses. Do not change what a user's ⌘Q does.

Test: a listener that records a flag, close all windows, assert it ran before exit.

Own: `src/app.ts`, `src/app-watch.ts` if needed, and their tests.

---

## FIX 6 — `store` and `window-state` lose writes; `window-state` is shared between apps

- `store`: each mutating command reads the whole snapshot, merges, writes back, unserialised.
  `Promise.all([set a, set b])` leaves `{seed, a}` — `b` gone (reproduced).
- `window-state`: same shape, and `createWindowStatePlugin({ native })` is called with no `app`/`root`
  (`runtime-plugins.ts:175`, `runtime-plugins-other.ts:105,116`), so **every crust app writes the same
  `crust/window-state.json`**.
- `store-file.ts:49` reports `recovered: <path>` even when the quarantine rename failed, and the next
  persist then destroys the corrupt bytes it claimed to preserve.

Fix: serialise mutations per file with a promise queue, and re-read at the start of each queued write so
a second instance's commit is not clobbered. Give the window-state plugin its app id and root. Only
report `recovered` when the rename succeeded.

Own: `src/plugins/store*.ts`, `src/plugins/window-persist*.ts`. **Do not touch `runtime-plugins.ts`** —
FIX 1 has it. Report the one-line wiring owed and it lands in the follow-up.

---

## FIX 7 — keychain returns truncated secrets; crash-reporter's fence is lexical

- `keychain.ts:66-73` clamps with `Math.min(length, buffer.length - 1)` after a second overrun and
  returns the prefix as `{ ok: true, found: true, secret }`. The comment one line above says a truncated
  secret is worse than a refusal. `list` has the same clamp.
- `crash-reporter.ts:58-63` `insideRoot` is `resolve()` + `startsWith`, so a symlink inside the data root
  passes and records are written outside the fence — the same class as FIX 2.

Fix: on a second overrun, retry once with a fresh size and then refuse with a named error; never return
clamped bytes. Make the crash fence resolve the real path before comparing.

Own: `src/platform/darwin/keychain.ts`, `src/plugins/crash-reporter.ts` + tests.

---

## FIX 8 — `dev.url` and a custom CSP

- `validate-dev.ts:10` accepts any non-empty string: `localhost:5173` parses as scheme `localhost:` with
  an empty host, so `crust dev` waits 30 s on host `""`; `"not a url"` throws uncaught.
- `security.csp` replaces the whole policy, so a strict `script-src 'self'` cannot admit the per-response
  nonce: the page loads, `window.crust` never installs, every invoke fails silently.

Fix: validate `dev.url` as an absolute `http(s)` URL with a non-empty host at config time. For CSP,
either accept a `{{nonce}}` placeholder the bridge substitutes, or refuse a `script-src` without
`'unsafe-inline'` and explain why in the message.

Own: `src/config/**` + tests. Do not touch `site/` — FIX 9 owns the docs.

---

## FIX 9 — the docs that are wrong

- Four guides promise typed failures arrive as **HTTP 200**; `resultStatus()` now sends 4xx/5xx, and the
  API index and `SKILL.md` already say so — the docs contradict each other.
- The shell guide describes an older plugin (no `write`/`close`, "No stdin").
- The API index omits `database`, `keychain`, `screen`, `sidecar` and misstates the namespace count.
- `SKILL.md`: `shell.write` is given only `{id}`; the quickstart pins `v0.1.29`.
- The CSP page never says a custom policy cannot carry the nonce.
- The lifecycle guide's save-on-quit example needs whatever FIX 5 decides.

Fix what the code does, not what reads nicely, and label anything read-from-code. Never touch
`SKILL.md`'s generated region — `bun run skill:check` owns it.

Own: `site/app/docs/**` and `site/public/SKILL.md` prose.

---

## FIX 10 — the `--next` scaffold never quits, and the e2e lies in two places

- `templates/next/main.ts` has no `window-all-closed` listener (the other four templates do), so a Next
  app never quits when its window closes.
- `probe()` keeps `code: 0` after its own SIGTERM, and `e2e.ts:132` / `e2e-dev.ts:86` assert
  `code === 0` with no `timedOut` guard, so a killed app can print PASS "exit 0".
- Every suite's `finally` restores the **raw** capture, bypassing `guardFocus()`'s refusal — the cascade
  guard is only in force on the signal path.

Fix: add the listener to the Next template; set `code = null` in `probe()`'s timeout branch as
`runCommand()` already does; make `finally` restore the target `guardFocus()` decided.

Own: `templates/next/**`, `scripts/harness/probe.ts`, the e2e call sites.

---

## Rules for every lane

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Red first**: the test must fail against today's code and pass after. Paste both runs.
- **Never weaken a test or widen a boundary to make a case legal.**
- Stay inside your Own line. Another lane is editing this tree right now.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Final message

Under 12 lines: what the red test proved, what you changed, the files touched, and anything you found
that belongs to another lane.
