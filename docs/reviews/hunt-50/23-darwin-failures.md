# hunt-50 · darwin failure paths: activation, crash, preflight, content-world (23)

Read-only review. Scope: `src/platform/darwin/activation.ts`, `preflight.ts`, `appkit.ts`, `crash.ts`,
`crash-record.ts`, `content-world.ts`, `content-world-source.ts`, and their C units
(`shim/111_crash.c`, `shim/112_crash_install.c`, `shim/121_content_world.c`). "Failure path" means a
branch taken when a selector, world, signal call, fetch or disk write refuses. No code was changed.

Search: `rg --files src/platform/darwin | rg -i 'crash|activat|preflight|content'`, then `rg -n` over
`src` for every exported symbol in those files to trace callers and tests.

**Count: 7 findings (1 high, 4 medium, 2 low).**

**Worst: F1 — a partly installed content-world bridge is remembered as fully installed. The isolated
script scrubs the token, the page half never lands, and `installCrust` throws on every window after
the failure: the app opens blank windows with no client.**

---

## F1 (high, worst) — a partial content-world install poisons the shared controller permanently

- `src/platform/darwin/content-world.ts:73-76` — the isolated half is added **first** and the function
  returns `false` only if that add fails.
- `src/platform/darwin/content-world.ts:78-85` — the page world and page half are resolved/added
  **after** it; both `if (!page) return false` (`:79`) and the final `return <page add>` (`:82-85`)
  leave the isolated script already attached to the controller when they refuse.
- `src/platform/darwin/shim/121_content_world.c:47-71` — `shim_webview_add_user_script` has six
  separate `return 0` exits (nil config, controller, NSString alloc, script alloc, script init), so a
  page-half refusal is a realistic result, not a hypothetical one.
- `src/platform/darwin/content-world.ts:66` — `if (scriptsOn(web) > 0) return true;` counts **any**
  script, not "both halves". One leftover isolated script is indistinguishable from a complete
  install.
- `src/platform/darwin/window-create.ts:182` — the boolean is discarded; the load at `:183` proceeds
  regardless, so nothing reports the refusal.
- `src/bridge/server/assets.ts:115-122` — the served document's config deliberately carries **no**
  token; the page can only get it from `location.search` or from `crustInvoke`.
- `src/bridge/client/install.ts:28-32` — `installCrust` throws
  `crust: no bridge config — window.__CRUST__ was never injected` when neither is present.

**Reached:** the first window whose page-world add fails. The isolated `WKUserScript` runs at document
start, keeps the token and calls `history.replaceState` to scrub it
(`content-world.ts/CONTENT_WORLD_SOURCE` at `content-world-source.ts:27-31`). The page half that would
define `window.crustInvoke` is missing. Every later window is built from the same shared
`WKWebViewConfiguration`, sees `scriptsOn > 0` and returns `true`, so the page half is never retried.
The page has no realm and, after the scrub, no token: `installCrust` throws and the window is inert
for the life of the process. The comment at `content-world.ts:60-61` ("Nothing is half-installed")
is false. `content-world.test.ts:46-64` only asserts the happy path's count is 2; no test exercises
an isolated-only controller.

---

## F2 (medium) — a `scriptsOn` read failure bypasses the dedup guard and stacks a second bridge

- `src/platform/darwin/content-world.ts:33-43` — `scriptsOn` returns `-1` on any throw or a null
  `shim_send_q0` answer.
- `src/platform/darwin/content-world.ts:66` — `> 0` treats `-1` as "not installed" and continues to
  install.
- `src/platform/darwin/preflight.ts:15-154` — none of `configuration`, `userContentController`,
  `userScripts` is a `PREFLIGHT` entry, so a system missing one of them is not rejected at `start()`.

**Reached:** on an older macOS where `WKContentWorld` exists but one of those three selectors does not,
`scriptsOn` returns `-1` even when both scripts are already on the controller. The second window then
adds the isolated script twice. That is the exact failure the comment at `content-world.ts:50-54`
records as measured: the first copy scrubs `?token=` at document start, the second reads an empty
token and posts `Bearer `, so the page's first invoke races a 401 against the real request.

---

## F3 (medium) — a partly armed crash unit leaves live handlers that silently lose the crash

- `src/platform/darwin/shim/112_crash_install.c:73-79` — the five `cr_install` calls are short-circuited
  by `||`. If signal 2..5 refuses after signal 1 succeeded, the code closes `fd` and returns `3`
  **without restoring the handlers it already installed**.
- `src/platform/darwin/shim/111_crash.c:84-85` — `cr_fd` was never assigned (still `-1`), so a live
  handler that fires calls `_exit(CR_EXIT_CRASH)` with no record.
- `src/platform/darwin/crash.ts:128-135` — `armed` is computed only from the returned status, so a
  `refusedSignal` answer reports `armed: false` even though handlers remain installed.
- `src/runtime-crash-guard.ts:157-158` — the guard writes nothing when no record exists; a clean exit
  and a handler that could not write are indistinguishable.

**Reached:** `runtime-plugins.ts:150-155` → `runtime-crash-start.ts:59-61` arms once at launch. When a
mid-sequence `sigaction` refuses, the warning says handlers did not arm, but SIGSEGV (or whichever
succeeded first) still points at `cr_emit`. A later fault exits 70 with an empty record and the crash
is never reported. Disarm eventually clears it, but a crash before then is lost.

---

## F4 (medium) — `crust_crash_disarm` ignores every per-signal refusal and always reports success

- `src/platform/darwin/shim/112_crash_install.c:85-96` — all five `cr_install(CR_SIG…, 0)` return values
  are discarded; the function unconditionally `cr_reason_set("disarmed"); return 0;`.
- `src/platform/darwin/crash.ts:150-160` — the comment promises "The C unit answers the signal it
  could not clear, so a partial disarm is visible here", but `status` can never be non-zero.
- `src/platform/darwin/crash-disarm.test.ts:27,65-71` — the "refused" case passes only by replacing
  `u.symbols.crust_crash_disarm` with a function that returns `11`, a value the real C never emits.

**Reached:** any `sigaction` refusal during uninstall. The TS adapter and the `crash-reporter.uninstall`
command (`src/plugins/crash-reporter.ts:160-165`) report `status: 0` and `armed: false` while a
handler may still be installed and now has a closed `cr_fd`; a subsequent fault exits 70 without a
record. The test gives false confidence in a safeguard that does not exist.

---

## F5 (medium) — a malformed `crust:req` leaves the page promise pending forever

- `src/platform/darwin/content-world-source.ts:65-67` — the isolated half returns early on a
  `JSON.parse` failure without ever calling `answer`.
- `src/platform/darwin/content-world-source.ts:148-160` — the page half stores `resolve` in `waiting[id]`
  and has no timeout or rejection path; only a `crust:res` deletes it.

**Reached:** any page (or injected script) that dispatches a `crust:req` DOM event with a detail that
is not valid JSON. `crustInvoke` awaits a promise that nobody will settle, and `waiting` grows. The
event is a public DOM channel, so a buggy or hostile page can hit this without touching native code.

---

## F6 (low) — no timeout on the isolated half's fetch or response body

- `src/platform/darwin/content-world-source.ts:83-120` — `send().then(response.text())… .catch(…)`
  covers a rejected fetch but not a connection that stays open or a body that never finishes.

**Reached:** a bridge that accepts the POST and stalls. The page's `crustInvoke` promise hangs with no
`crust:res`, the same symptom as F5, and there is no diagnostic to distinguish a stalled bridge from a
missing one.

---

## F7 (low) — the crash unit compiles whatever file already sits at its predictable temp path

- `src/platform/darwin/crash.ts:52-59` — `sourcePath()` derives the filename from a SHA-256 of the
  published `crashSource`, so every process uses the same `/tmp/crust-crash-<hash>.c`; if it exists,
  `writeFileSync` is skipped and `cc()` compiles the file as-is.
- `src/platform/darwin/crash.ts:61-69` — the compiled symbols are then installed as native handlers
  via `bun:ffi`.

**Reached:** any local process that can write to the user temp dir can pre-create that exact filename
with different C before the app's first arm. The app compiles and loads it without verifying content.
This is a native-code trust failure on the compile path; arming happens at launch
(`runtime-plugins.ts:150-155`), so it needs no page interaction.
