# hunt-50 · second-run defects in notification / power / autostart / theme (08)

Scope: `src/plugins/notification*`, `src/plugins/power*`, `src/plugins/autostart*`, `src/plugins/theme*`, plus the native halves those plugins call (`src/platform/darwin/notifications*`, `power*`, `theme.ts`, `src/platform/linux/shim/80_notify.c`). Read-only review. "Second run" covers a second command invocation and a second process launch.

**Count: 8 findings** (2 high, 3 medium, 3 low). Worst is finding 1.

---

## 1 (worst) — `autostart` forgets the id on relaunch, so `disable()` fails and the login item stays armed

- `src/plugins/autostart.ts:90-95` — `let known: string | undefined` is local to one `createAutostartPlugin()` call; `resolveId` is `given ?? adapter.bundleId ?? known`.
- `src/plugins/autostart.ts:146` — `known` is set only inside `enable`, never persisted to disk.
- `src/plugins/autostart.ts:149-152,169-177` — `disable` and `isEnabled` call `unknownId()` when no id is given and the adapter has none.
- `src/plugins/autostart-types.ts:42-44` — `AutostartIdArgs` carries only `bundleId`; there is no `appPath` a second launch could pass to re-derive the id.
- `site/app/docs/guides/autostart/page.mdx:39-40` — "After one `enable` the plugin remembers the id it used, so a page that enabled at first launch needs no argument later."
- `src/plugins/autostart.test.ts:130-142` — the memory test stays inside a single plugin instance; `:144-156` only proves a fresh plugin with no id refuses.

Reached: with the default adapter (`createAutostartPlugin()`, no `bundleId`), call `enable({appPath})` at first launch — the id is read from `Info.plist` at `:123` and cached in `known` at `:146`. Quit and relaunch the app; a new plugin instance starts with `known === undefined`. `isEnabled({})` and `disable({})` both return `{ok:false, code:"bad-request", message:"no bundle id known"}` (`:97-101`). The LaunchAgent plist from the first launch is still on disk and still runs at login; the page has no API path to remove it. This is the documented first-launch → later-launch flow that breaks, and the failure is silent from the user's point of view (a refused invoke, not a wrong `enabled` value).

---

## 2 — A second `sleepPrevent` overwrites the only assertion slot and leaks the first IOKit assertion

- `src/platform/darwin/shim/105_power.c:133` — one static `pw_assertion` for the whole unit.
- `src/platform/darwin/shim/105_power.c:139-158` — every `crust_power_prevent_sleep` creates a **new** IOKit assertion and assigns `pw_assertion = id` at `:156`; the previous id is dropped with no `IOPMAssertionRelease`.
- `src/platform/darwin/power.ts:146-154` — `preventSleep` returns the new id to the caller; the first caller's id is no longer held.
- `src/platform/darwin/power.ts:155-163` and `105_power.c:163-176` — one `allowSleep` releases only the id in the slot; a refused release keeps that id for a retry.
- `src/plugins/power.ts:6-8,133-155` — the plugin advertises that it answers the assertion id "so a caller can release exactly what it took", but `sleepAllow` takes no id and the C unit can hold only one.
- `src/plugins/power.test.ts:129-142` — covers one `prevent` + one `allow`; the fake at `:38-48` models an unbounded counter, so a second prevent is invisible to the test.

Reached: two long tasks both call `power.sleepPrevent({reason})`. Each gets `{ok:true, id}`; `pmset -g assertions` shows two assertions. One `power.sleepAllow()` releases only the second; the first stays alive until process exit, holding off idle sleep with no handle left to release it (`heldAssertion()` at `power.ts:168-171` reads only the latest id). `releaseOnExit` (`power.ts:96-109`) is registered once and calls `crust_power_allow_sleep()` once, so even the exit path cannot recover the lost first id.

---

## 3 — `NotifyOptions.id` is published as a dedupe key but no adapter uses it; a second notify duplicates

- `src/plugins/notification.ts:13-14` — `id?: string` documented "Caller-chosen dedupe key".
- `src/plugins/notification.ts:107-121` — `notify` validates `title`, then passes `options` to `adapter.post` or `adapter.notify`; nothing reads `options.id`.
- `src/platform/darwin/notifications.ts:55-88` — `postNotification` reads only `title`, `body` and `waitMs`.
- `src/platform/darwin/notifications/40_modern.c:142` — the request identifier comes from `nf_identifier()`, never from the caller.
- `src/platform/linux/notification-adapter.ts:74-92` and `src/platform/windows/notification-adapter.ts:76-89` — both pass only `title`/`body` to their C units.
- `src/platform/linux/shim/80_notify.c:164` — `shim_notify_release()` closes the previous notification on every post, so a repeated id still replaces/dismisses rather than deduping by the caller's key.
- `site/app/docs/guides/notifications/page.mdx:18` — documents the `id` dedupe key; `src/plugins/notification.test.ts:78-142` tests `waitMs` and statuses but never `id`.

Reached: a page posts `notify({title:"Sync", id:"sync-done"})`, then posts the same call again to report progress. First call looks right. The second call creates a second notification (macOS) or dismisses the first and posts a fresh one (Linux/Windows) instead of updating the one keyed `sync-done`. The contract cannot be honoured by any current adapter, so a caller that relies on dedupe accumulates or loses notifications.

---

## 4 — Notification request ids restart at `crust-1` on a second launch, so run 2 replaces run 1's notification

- `src/platform/darwin/notifications/00_prelude.c:29` — `static int nf_counter`, process-local.
- `src/platform/darwin/notifications/30_blocks.c:124-125` — comment promises "a fresh identifier per post, so a second notification is queued beside the first rather than replacing it".
- `src/platform/darwin/notifications/30_blocks.c:126-143` — `nf_identifier()` formats `crust-<++nf_counter>`; `:132` resets to `crust-1` in every new process.
- `src/platform/darwin/notifications/40_modern.c:148-149` — that string becomes the `UNNotificationRequest` identifier.

Reached: a bundled app posts a notification, quits, and is relaunched; the first `notify` of run 2 again uses identifier `crust-1`. `UNUserNotificationCenter` treats a repeated identifier as an update, so the earlier notification is replaced instead of appearing beside the new one — exactly the failure the comment at `30_blocks.c:124-125` says the counter prevents. Only observable across a second process run; within one run the counter behaves as documented. (Unbundled processes skip the modern path per `40_modern.c:15-20`, so this needs an app with a bundle id.)

---

## 5 — `theme.set` commits the override before the read-back; a failed set is reported as a success on the next call

- `src/plugins/theme.ts:64-77` — in `apply`, `override = ...` is assigned at `:72` **before** `publish(ctx, state(target))` at `:73`; both sit inside the same `try`, and `catch` at `:74-76` returns a typed failure without reverting `override` or emitting `theme:changed`.
- `src/plugins/theme.ts:53-57` — `state()` derives `source` solely from `override`, so the mutated flag leaks into every later `current()`.
- `src/platform/darwin/theme.ts:75-80` — `current()` throws when `crust_theme_current()` reports anything other than 0/1 ("NSApplication did not report an effective appearance").
- `src/platform/darwin/shim/103_theme.c:56-69` — that unreadable result is returned for a nil app/appearance/name or a name matching none of `Dark`/`Aqua`/`Light`.
- `src/plugins/theme-set.test.ts:56-68` — the refusal fixture throws from `set()` itself, so `override` is untouched; the throw-from-read-back ordering is untested.

Reached: `theme.set({appearance:"dark"})` where `-[NSApplication setAppearance:]` succeeds (`103_theme.c:104-106`) but the immediate effective-appearance read throws. The invoke returns `{ok:false, code:"handler-error"}` and emits no `theme:changed`; a subsequent `theme.current()` reports `{ok:true, source:"override"}` though the caller was told the change failed. The second call is the only place the contradiction is visible.

---

## 6 — A second power adapter silently disconnects every listener registered through the first one

- `src/plugins/power.ts:116-117` — `darwinPowerAdapter()` calls `darwinPowerEvents()` on **each** invocation; nothing memoizes the adapter.
- `src/platform/darwin/power-events.ts:49-50` — each `darwinPowerEvents()` creates a fresh `listeners` Map and a fresh `channel`.
- `src/platform/darwin/power-events.ts:64-71` — the first `arm()` creates a `JSCallback` and calls `crust_power_set_sink(pointerOf(channel))`; a second adapter calls it again with a different pointer.
- `src/platform/darwin/shim/116_power_events.c:26,30` — C holds a **single** sink pointer; the second write discards the first.
- `src/platform/darwin/shim/116_power_events.c:132-143` — `pw_watching` bits are already set from the first adapter, so `crust_power_watch` on the second returns 1 without registering anything new.
- `src/runtime-plugins.ts:181` — normal startup creates one adapter, which is why the fault needs a second construction.

Reached: any code path that calls `darwinPowerAdapter()` twice in one process (two `createPowerPlugin(darwinPowerAdapter())` registries, an app re-registering native plugins, or a test that constructs a second adapter) and subscribes `onSleep` through both. C still posts the OS notification, but it dispatches into the second channel's map; the first page's listener is orphaned and never fires, and the first `JSCallback` is never freed. The first subscription returned `{ok:true, event:"power:sleep"}` and keeps claiming to be armed.

---

## 7 — A second `onX` subscribe replaces the first page's listener while both pages get `ok:true`

- `src/platform/darwin/power-events.ts:73-77` — `arm()` does `listeners.set(kind, listener)`, a one-slot map keyed by kind, before calling `crust_power_watch`.
- `src/plugins/power-subscribe.ts:41-49` — the listener closes over that invocation's `ctx.emit`, so a different page's subscribe supplies a different context.
- `src/plugins/power-types.ts:116-118` — `PowerSubscribeResult` tells each caller which event was armed; `power-subscribe.ts:50-51` returns `{ok:true,...}` for both.
- `src/platform/darwin/shim/116_power_events.c:132-134` — the C comment states re-subscribing replaces the listener rather than stacking duplicates.

Reached: page A calls `power.onSleep` and receives `power:sleep`; page B calls `power.onSleep` later. Both invocations return `ok:true`; C's observer bit is already set so the second `crust_power_watch` is a no-op, and the JS map now holds only B's listener. Every later sleep notification reaches B alone. The replacement is intentional at the C layer, but the plugin contract reports success to A without ever telling it that it lost the subscription — a defect that exists only after the second call.

---

## 8 — Cached C source is written non-atomically, so a crash on the first launch poisons every later launch

- `src/platform/darwin/notifications-ffi.ts:47-54` — `if (!existsSync(file)) writeFileSync(file, notificationsSource)` writes the content-hashed `.c` directly to its final path.
- `src/platform/darwin/power-ffi.ts:66-71` — same pattern for `crust-power-<hash>.c`.
- `src/platform/darwin/theme.ts:29-35` — same pattern for `crust-theme-<hash>.c`.
- `src/platform/darwin/notifications.ts:65-73`, `power.ts:66-73` — a compile failure becomes a typed `not-implemented`/status for every command in that family.

Reached: the first launch is interrupted while `writeFileSync` is writing one of these files; a truncated `.c` remains at the hashed path. Every subsequent launch sees `existsSync(file) === true`, skips the rewrite, and feeds the truncated source to `cc()`. All notifications (or all power reads/assertions, or all theme calls) then fail permanently on the second and every later run. `autostart`'s `writeAtomic` (`autostart-mechanism.ts:32-37`) shows the temp-file-then-rename shape these three should use.
