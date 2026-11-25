# Hunt 22 — lane 03: `src/platform/darwin`

Read-only source audit. No files changed, no app launched, no focus taken. Searches used `rg` scoped to `src/platform/darwin` (and `docs/reviews/hunt-22` to avoid duplicating sibling lanes). Every claim below is from a direct `read` of the cited lines unless marked *static*.

Scope: the TS adapters and the C shim units under `src/platform/darwin/`. The dominant defect class here is **Objective-C ownership**: several units build `+1` objects with `alloc`/`init` or `new`, hand them to AppKit/WebKit, and never balance their own reference. Units that do it correctly (`shim/110_network.c`, `shim/113_network_serve.c`, `shim/123_snapshot.c`, `106_accessibility.c`) show the intended pattern, so these are omissions rather than a deliberate convention.

## HIGH — `shim/121_content_world.c` caches an autoreleased `WKContentWorld` with no owning reference

- where: `shim/121_content_world.c:11-25`, `:31-38`; consumer `content-world.ts:24-25,71-75`; pool drain `shim/50_app.c:139-168`
- mechanism: `shim_content_world()` stores the result of `+[WKContentWorld worldWithName:]` in `static obj_t content_world` and returns it on every later call. `+worldWithName:` is a class convenience factory, so by the Cocoa naming convention the result is `+0`/autoreleased: crust holds no owning reference. `shim_pump()` creates and drains an `NSAutoreleasePool` **on every tick** (`50_app.c:143,167`), so the cached pointer can be freed under the static. `shim_content_world_named(1)` then hands that dangling value to `-initWithSource:…inContentWorld:`, which the same file warns dereferences a nil world at `0x10` (`121_content_world.c:27-30`). A freed world is no safer than a nil one. The file also leaks the `NSString name` built with `alloc`/`initWithBytes:…` at `:16-20`, and `shim_webview_add_user_script` leaks `text` (`:54-60`) and `script` (`:65-74`) on every call — two `+1` objects per window, since `content-world.ts:73-84` adds two scripts.
- reachable by: any built app with a token in its document URL (`content-world.ts:67`); `contentWorldAvailable()` and every window create call into the cache. A window created after the first pump tick is the case where the pointer has crossed a drain. `read` of the ownership convention and the pump's explicit pool; not runtime-probed.
- smallest fix: `retain` the world once when caching it (or ask WebKit for it on each call and keep no static); `release` `name` after `worldWithName:` and `text`/`script` after `addUserScript:`, as `shim/110_network.c:68-74` does for owned strings.

## MEDIUM — `status_bar/*.c` leaks an `NSString` per title/tooltip/menu row and whole menu trees

- where: `status_bar/10_guards.c:25-35` (`tray_nsstring`: `alloc` + `initWithBytes:…`, a `+1` object); callers `30_item.c:34,101`, `40_readback.c:62`, `50_menu.c:17,38-39`; menu objects `50_menu.c:19-24,44-56`
- mechanism: none of those call sites releases the `+1` string. `rg` over `status_bar/` finds **no** `release`, `CFRelease` or `autorelease` anywhere in the unit. `tray_menu_begin` also builds the `NSMenu` with `alloc`/`initWithTitle:` and keeps it in `tray_building_menu`; `tray_menu_end` hands it to `-setMenu:` (which retains it) but never drops crust's `+1`, and `menu_api_begin`'s next call overwrites the static with a new menu. `tray_menu_add` likewise builds each `NSMenuItem` with `alloc`/`init…`, adds it to the menu (menu retains it), and never releases crust's reference. So every `tray.setTitle`, `setTooltip`, `setMenu` and readback grows the heap, and a rebuilt menu leaks its entire row tree.
- reachable by: the `crust:tray` plugin's normal commands; `status-bar-item.ts:83-105,112-133` calls these on every update. A status clock updating once a second leaks a `NSString` per tick, and a menu refresh leaks one string per row plus a menu item per row. Static read; no memory measurement run.
- smallest fix: release each `tray_nsstring` result after the setter that consumes it; release `row` in `tray_menu_add` after `addItem:`; release the previous `tray_building_menu` in `tray_menu_begin` and crust's `+1` after `setMenu:` in `tray_menu_end`.

## MEDIUM — `shim/108_find.c` leaks two objects on every find-in-page search

- where: `shim/108_find.c:37-45` (`find_nsstring`), `:62-72` (`find_config`), `:86-101` (`crust_find_search`)
- mechanism: `text` is `alloc` + `initWithBytes:…` (`+1`) and `config` is `[WKFindConfiguration new]` (`+1`). Both are sent to `-findString:withConfiguration:completionHandler:` at `:98-100` and neither is released on the success path or on any early return. This unit has no `release` at all. Compare `shim/123_snapshot.c:152-160`, which releases its `WKSnapshotConfiguration` after the analogous send, and `shim/110_network.c:68-74`, which documents and fixes exactly this class of leak.
- reachable by: `find.ts:142-163` sends a `crust_find_search` for every `search`/`next`/`previous` call, so repeated searches in a page leak an `NSString` and a `WKFindConfiguration` each. Static read; no heap measurement run.
- smallest fix: release `text` and `config` after the `objc_msgSend` at `:98-100`, and on the early-return paths after each object exists.

## MEDIUM — `shim/98_menu_api.c` leaks the menu tree whenever the app menu is rebuilt

- where: `shim/98_menu_api.c:48-57` (`menu_nsstring`, `+1`), `:63-70` (`menu_new_menu`, `+1`), `:109-118` (`menu_api_begin`), `:121-140` (`menu_api_item`), `:143-162` (`menu_api_submenu`)
- mechanism: `menu_api_begin` resets `menu_depth = 0` at `:110`, abandoning the previous root menu without releasing it, and leaks the `title` at `:112` plus the new menu's `+1`. `menu_api_item` leaks `title` and `equivalent` per row at `:127-128`; `menu_api_submenu` leaks `title`, `equivalent` and the new submenu at `:149-155`. `-setMainMenu:` and `-addItemWithTitle:action:keyEquivalent:` retain what they need, so crust's own `+1` references are surplus. This unit has no `release` either.
- reachable by: every `crust:menu` `setAppMenu`/`showContext` call rebuilds through `menu_api_begin`; a page that refreshes a menu leaks the whole previous tree. Static read.
- smallest fix: retain the root once while installed, release it in `menu_api_begin` before replacing, and release `title`/`equivalent`/`submenu` after the AppKit sends that copy or retain them.

## MEDIUM — `shim/106_accessibility_page.c` leaks an `NSString` per announcement and per title set

- where: `shim/106_accessibility_page.c:56-63` (`ax_nsstring`, `+1`), `:108-134` (`crust_ax_announce`), `:138-147` (`crust_ax_title`)
- mechanism: `message` at `:110` is built with `alloc`/`init…`, placed in the announcement dictionary at `:119`, then only the dictionary and app element are released at `:131-132`; `message` is never released. `name` at `:142` is sent to `-setAccessibilityLabel:` at `:144-145` and never released. The sibling unit `106_accessibility.c:27-61,100-141` carefully balances every CF object; this unit's `10` `CFRelease` calls cover only CF objects, not these two Objective-C `+1` strings.
- reachable by: `crust.accessibility.announce` and `crust.accessibility.setTitle` on every call. Static read. (Distinct from lane 25's finding on the unchecked `AXUIElementSetAttributeValue` returns in `crust_ax_focus`.)
- smallest fix: `release` `message` after `CFRelease(info)` and `name` after the `setAccessibilityLabel:` send.

## LOW — `shim/115_window_material.c` leaks the effect view

- where: `shim/115_window_material.c:19-35`
- mechanism: `fx` is `alloc` + `initWithFrame:` (`+1`), inserted with `addSubview:positioned:relativeTo:` at `:34-35` (the content view retains it), and never released by crust.
- reachable by: one leak per window created with a vibrancy material. Static read.
- smallest fix: `release` `fx` after the `addSubview:` send.

## LOW (static) — a failed `class_addMethod` wedges four runtime delegate classes

- where: `shim/107_navigation.c:126-156`, `shim/122_media_capture.c:88-103`, `shim/95_deeplink.c:86-93`, `shim/98_menu_api.c:83-93`
- mechanism: each helper calls `objc_allocateClassPair` and, when a later `class_addMethod` fails, returns `0` without `objc_registerClassPair` **and without `objc_disposeClassPair`**. Every subsequent call first does `objc_getClass(name)`, which cannot see an unregistered class, then retries `objc_allocateClassPair` with a name the runtime already allocated. The result is a permanent install failure for that process. `shim/110_network.c:148-153` explicitly disposes the class pair on the same failure and states the reason ("a failed selector must not wedge the unit"); these four do not.
- reachable by: requires `class_addMethod` to fail on a fresh class (rare), so impact is bounded. Static read; not runtime-probed.
- smallest fix: call `objc_disposeClassPair(cls)` before each `return 0` after allocation, matching `110_network.c`.

## Checked and clean

- **FFI arity**: `arity.test.ts:11-172` walks every C source and every binding module; all declared symbols exist with matching arity. No arity defect found.
- **Ownership done right**: `shim/110_network.c:68-74,170-177`, `113_network_serve.c:52-113`, `123_snapshot.c:106,155-160`, `106_accessibility.c:100-141`, `119_keychain_*.c`, `90_clipboard.c:1` all balance or deliberately process-pin their `+1` objects.
- **Window liveness**: `windows.ts:52-143` uses the measured `visible || miniaturized || appHidden || inAppWindows` rule from `liveness.ts`, not raw `-windowNumber`, and prunes closed labels on read.
- **Launcher**: `platform.ts:56-75,166-186` starts AppKit in the verified order and bypasses deferred termination on `quit()`.
- **Cross-window label resolution**: `webview-target.ts:39-52` and `browser-platform.ts:34-51` refuse an unknown label instead of falling back to the first window.
