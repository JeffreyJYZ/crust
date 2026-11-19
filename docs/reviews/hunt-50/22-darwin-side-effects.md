# hunt-50 · darwin deep-link, opener, power, devtools side effects (22)

Scope: `src/platform/darwin/deep-link*`, `opener.ts`, `power*`, `devtools.ts`, the matching C units
(`shim/95_deeplink.c`, `shim/117_lifecycle.c`, `shim/91_opener.c`, `shim/105_power.c`,
`shim/116_power_events.c`, `shim/30_webview.c`) and their plugin/app call sites. Read-only source
inspection: no GUI app launched, no sleep assertion taken, no URL opened, no cursor moved.

**Count: 5 findings** (1 high, 2 medium, 2 low). Worst is finding 1.

---

## 1 (worst) — a second `sleepPrevent` leaks the first assertion; `sleepAllow` cannot release it

- `src/platform/darwin/shim/105_power.c:156` — `pw_assertion = id;` overwrites any id already held.
- `src/platform/darwin/power.ts:146-153` — `preventSleep` calls the C symbol on every invoke; no dedup guard.
- `src/plugins/power.ts:132-147` — `sleepPrevent` forwards every call and returns each new id; `sleepAllow` at `:150-155` passes no id, and the C `crust_power_allow_sleep` (`shim/105_power.c:163-175`) releases only `pw_assertion`.

`IOPMAssertionCreateWithName(pw_key("PreventUserIdleSystemSleep"), 255u, name, &id)` creates a new
`PreventUserIdleSystemSleep` assertion on every call. A second call overwrites the only handle, so the
first assertion stays held by IOKit until the process dies. One `sleepAllow` releases only the newest
assertion, yet the plugin reports `released: true` and the Mac never idle-sleeps. The plugin's own
contract (`src/plugins/power.ts:6-8`: "answers the assertion id so a caller can release exactly what
it took") is false at the darwin layer: the adapter accepts no id and stores exactly one.

Reached: a page calls `power.sleepPrevent({ reason: "encode" })`, then again with another reason
(two windows, a retry, a reconnect), then `power.sleepAllow()` — laptop stays awake and drains
battery for the rest of the app's life.

---

## 2 — a shipped app becomes inspectable from an inherited environment variable

- `src/platform/darwin/devtools.ts:9-10` — gate is `process.env.CRUST_DEV_INSPECT === "1"`, read at runtime.
- `src/platform/darwin/window-create.ts:90` — every window creation calls `shim_webview_enable_devtools(web)` when the flag is set.
- `src/platform/darwin/shim/30_webview.c:84-100` — sets private `developerExtrasEnabled` and sends `setInspectable:1` behind `respondsToSelector:`.

The comment at `window-create.ts:89` and `devtools.ts:3-4` claims a built app never carries the flag,
but the flag is inherited at launch, not baked at build. Any launcher, shell export, or parent that
starts a shipped bundle with `CRUST_DEV_INSPECT=1` makes every webview inspectable: right-click
Inspect Element and full DevTools over production page state. No signature or bundle check backs the
gate; the only "proof" test (`devtools.test.ts:32-36`) greps that `crust dev` sets and deletes the
text, not that a built app refuses it.

Reached: `export CRUST_DEV_INSPECT=1; open MyApp.app` (or any `Bun.spawn`/launcher that inherits the
env) — production webview exposes DevTools to whoever is at the machine.

---

## 3 — deep-link URLs beyond 8191 bytes are silently truncated; the re-read path cannot detect it

- `src/platform/darwin/shim/95_deeplink.c:35-41` — `dl_store` clamps to `CRUST_DEEPLINK_CAP - 1` (8191) and records the clamped length.
- `src/platform/darwin/shim/95_deeplink.c:107-114` — `crust_deeplink_last` returns that clamped length, so the caller's "full length" is the truncated length.
- `src/platform/darwin/deep-link.ts:85-98` — `read()` re-reads at `length + 1`, which is enough only for the bytes C kept; truncation is invisible.
- The C comment at `95_deeplink.c:18-19` says the shorter length exists so the caller can re-read the full string — impossible once C discarded the tail.

Reached: cold launch with a `crust://...` argv URL longer than 8191 bytes (argv has no Apple Event
cap) — `app.ts:151-155` hands `deepLink.launch()` a cut URL; the app navigates to a different
resource with no error.

---

## 4 — `opener.revealItem` always activates Finder, taking focus from the human

- `src/platform/darwin/shim/91_opener.c:143-144` — `activateFileViewerSelectingURLs:` on `NSWorkspace`.
- `src/platform/darwin/opener.ts:155`, `src/plugins/opener.ts:162-174` — every `revealItem` invoke ends here; no non-activating variant exists.

The documented effect is "select the item in a Finder window"; the actual OS effect is stronger —
AppKit brings Finder to the foreground. A page calling it mid-task yanks the human out of whichever
app they are typing in. Unlike `openUrl`/`openPath`, the caller cannot reveal without this focus
change, and `app.ts` has no focus guard around plugin invokes.

Reached: any page invoke of `opener.revealItem({ path })` while the user works in another app —
Finder becomes frontmost.

---

## 5 — single-file `crust dev` returns before the `CRUST_DEV_INSPECT` cleanup runs

- `src/cli/dev.ts:64-65` — flag is set, then `return devSingle(...)` bypasses the `try/finally` at `:177-184` that deletes it (`:182`).
- `src/cli/dev/single.ts:43-48` — the child is spawned with `env: { ...process.env, ... }`, inheriting the flag (intended for the dev window).
- `src/platform/darwin/devtools.test.ts:32-36` — the test only asserts the `delete` line exists in `dev.ts`, not that it runs on this path.

Reached: `crust dev app.tsx` with single-file detection — the CLI process keeps the flag set for
the rest of its life, so any later child spawned in that process is inspectable. In the ordinary CLI
exit the env dies with the process, so this is a latent leak rather than a shipped-app exposure.

---

## Worst

Finding 1. It is the only defect that changes the state of the physical machine *after* the caller
has explicitly undone the action: two `sleepPrevent` calls plus one `sleepAllow` leave an uncounted
IOKit assertion that keeps the Mac awake until process exit. The plugin promises id-for-id release
while the C unit stores a single id, so no amount of caller discipline can work around it. Finding 2
is a real exposure but needs a launcher to set the flag; finding 1 needs only two ordinary calls from
a page.
