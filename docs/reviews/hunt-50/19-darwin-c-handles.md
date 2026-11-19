# hunt-50 · Darwin C shim: handles used after they are gone (19)

Scope: `src/platform/darwin/shim/90_*.c` through `125_*.c` (all 37 files in that range; no `122_*.c` exists). Read-only review. `rg`/`fd` only; no files outside this report were changed.

**Count: 3 findings** (1 worst, 2 lower-confidence). Worst is finding 1.

Every obvious in-function release-then-use was checked first and is clean: `110_network.c:85`, `113_network_serve.c:74-112`, `105_power.c:95-151`, `106_accessibility.c:88-135`, `106_accessibility_page.c:126-193`, `118_keychain_a.c:88-152`, `119_keychain_b.c:24-134`, `112_crash_install.c:76-93`, `123_snapshot.c:73,187`, `108_find.c:131-148`, `93_shortcuts.c:131-170`, `114_network_probe.c:140`. Each of those releases either a handle that is never read again or one that is replaced with a known-good value in the same statement. The findings below are the cross-call lifetime cases.

---

## 1 (worst, high) — the cached content-world handle is autoreleased and reused after its pool drains

- `src/platform/darwin/shim/121_content_world.c:11` — `static obj_t content_world = 0;` is the process-wide cache.
- `src/platform/darwin/shim/121_content_world.c:22-24` — `content_world = [WKContentWorld worldWithName:name]` is assigned **without a retain**. `+worldWithName:` is a class factory, so under Cocoa ownership rules the result is `+0`/autoreleased. The only local `name` is also `+1` from `alloc`/`init` and is never released, but that is a leak; the load-bearing problem is the unretained world.
- `src/platform/darwin/shim/121_content_world.c:14` — `if (content_world) return content_world;` hands the stale pointer back on every later call. Nothing re-resolves it and nothing checks liveness.
- `src/platform/darwin/shim/121_content_world.c:68-70` — `crust_webview_add_user_script` passes that pointer into `-initWithSource:injectionTime:forMainFrameOnly:inContentWorld:`. The file's own comment at `:27-30` records that a bad world here faults with no Objective-C exception, so a *freed* world is the dangerous case: the non-nil guard passes and WebKit dereferences deallocated memory.
- `src/platform/darwin/content-world.ts:63-75` — `installContentWorldBridge(web, url)` calls `shim_content_world_named(1)` once per webview and immediately uses the result as an integer handle.

**Reached:** the first window with a `?token=` document URL calls `installContentWorldBridge`, which creates the world and caches the `+0` pointer. The autorelease pool around that bridge call (or the next main-run-loop drain) releases the object. A second window then calls `installContentWorldBridge`; `shim_content_world_named(1)` returns the cached pointer from line 14, and `initWithSource:...inContentWorld:` uses a handle whose object is gone. Multiple windows are normal (`~Window` per workspace), and the two installs happen in separate JS turns, so the drain lands between them.

**Confidence note:** the shim's comment at `:9-10` assumes `worldWithName:` returns the same world each time, which suggests WebKit may cache and retain it internally. If so the object survives and this is only a latent ownership bug. The shim itself takes no retain and documents no such guarantee, so the handle can go away underneath it; this is exactly the "used after gone" shape. Smallest fix: `retain` the world once before caching it (and never release it, matching the other process-lifetime statics in this tree).

---

## 2 (medium) — menu readback stores borrowed row handles across FFI calls

- `src/platform/darwin/shim/98_menu_read.c:10` — `static obj_t menu_read_rows[MENU_READ_MAX];` holds raw pointers.
- `src/platform/darwin/shim/98_menu_read.c:37-43` — `menu_read_push` stores `row`, a borrowed `NSMenuItem` from `-[NSMenu itemAtIndex:]` (`:26-30`) or `-[NSMenuItem submenu]` (`:32-35`). No retain.
- `src/platform/darwin/shim/98_menu_read.c:65-67,100-123` — `menu_api_read_title`, `menu_api_read_key`, `menu_api_read_enabled`, `menu_api_read_mask` and friends are **separate exports**; each calls `menu_msgSend`/`menu_responds` on a pointer saved by an earlier `menu_api_read()` call (`:47-63`), with no liveness re-check.
- `src/platform/darwin/shim/98_menu_api.c:186-193` — `menu_api_install` calls `-[NSApplication setMainMenu:]`; installing a different menu drops AppKit's reference to the old one and its rows.

**Reached:** read the menu (`menu_api_read()`), then replace it (`menu.set` → `menu_api_install`), then read a field by index. The cached `NSMenuItem*` now points at freed memory and the next `objc_msgSend` in `menu_read_string`/`menu_read_flag` uses a gone handle. In the current TS caller (`menu-readback.ts:16-26`) the read and the field calls are synchronous in one turn, so the window is narrow; it opens with a native callback that re-enters between exports or a concurrent command. The byte buffer itself is copied per call (`:98-115`), but the *handle* it is read from is not refreshed.

Smallest fix: retain each row on push and release them at the start of the next `menu_api_read()`, or re-resolve the row from `mainMenu` on every read call.

---

## 3 (low, adjacent class — a live handle is lost rather than reused)

- `src/platform/darwin/shim/105_power.c:133` — `static unsigned int pw_assertion;` is a single slot.
- `src/platform/darwin/shim/105_power.c:139-158` — `crust_power_prevent_sleep` calls `IOPMAssertionCreateWithName` and writes `pw_assertion = id` unconditionally. A second call overwrites the first id without releasing it.
- `src/platform/darwin/shim/105_power.c:163-176` — `crust_power_allow_sleep` releases only the id currently in `pw_assertion`, so the first assertion can never be released by this unit.

**Reached:** a page calls `power.preventSleep` twice (two reasons, or a re-arm). The first IOPMAssertion id is gone from the shim while still held by the OS; `allowSleep` appears to succeed but leaves the original sleep assertion live. This is the inverse of the brief's pattern — a handle lost while the object is still alive — but it belongs in the same lifetime audit. Smallest fix: release the previous id before overwriting, or refuse a second arm while one is held.

---

## Checked and rejected

- `113_network_serve.c:93-113` — `didReceiveResponse:`, `didReceiveData:`, `didFinish` are synchronous; the `done:` releases of `response`/`data`/`mime`/`version` happen after WebKit has consumed them. The dictionary copies its keys and values; `headers` is `+0`. No use-after-gone, though `110_network.c:175` relies on `setURLSchemeHandler:forURLScheme:` copying the scheme string.
- `123_snapshot.c:182-187` — the config is released after the synchronous `takeSnapshotWithConfiguration:` call; WebKit copies it in normal use. `shot_png` is retained on creation (`:119`) and released only in `shot_clear` (`:71-79`), always before reassignment.
- `108_find.c:128-138` — `find_last` is retained before the old value is released; `find_repeat` uses the retained handle, not a borrowed one.
- `106_accessibility.c:100-136` / `106_accessibility_page.c:153-194` — `AXUIElementCopyAttributeValue` outputs are released after their last use; `window`/`target` are borrowed array members used before `CFRelease(windows)`.
- `119_keychain_b.c:96-135` — `query` is released before `result` is read, but `SecItemCopyMatching` returns an independent `+1` result; array/dictionary members are used before `CFRelease(result)`.
- `112_crash_install.c:85-95` — handlers are removed before the record fd is closed.
- `120_network_status.c:38-111` — `ns_target` is never released; `SCNetworkInterfaceCopyAll()` in `ns_kinds` is leaked. Both are leaks, not use-after-gone.
