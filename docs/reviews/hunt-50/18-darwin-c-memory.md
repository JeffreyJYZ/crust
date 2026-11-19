# Darwin C shim (`50_*.c`–`85_*.c`) — memory and ownership

Read-only hunt. Scope: the seven numbered shim files in range — `50_app.c`, `55_menu.c`,
`60_panels.c`, `70_sheet_block.c`, `75_open_panel.c`, `80_save_panel.c`, `85_sheet_result.c` — plus
the TS that calls their symbols. "Memory and ownership" here means objects created through
`alloc`/`init` or an autoreleasing convenience constructor, who retains them, and when they die.
No code was changed.

Files searched: `fd -e c '^([5-8][0-9])_.*\.c$' src/platform/darwin/shim` → 7 files, 756 lines.
Callers and pool lifetime traced with `rg` over `src/**/*.ts` and `src/platform/darwin/shim/**/*.c`.

**Count: 4 findings (2 high, 2 medium).**

**Worst: F1 — `shim_sheet_cancel` sends `-cancel:` with the wrong arity. Its `objc_msgSend` prototype
takes only `(self, _cmd)`, but `-[NSSavePanel cancel:]` (inherited by `NSOpenPanel`) is an IBAction
with one `sender` argument. Every programmatic `dialog.cancel` therefore hands AppKit an
uninitialised `x2` as an object pointer.**

---

## F1 (high, worst) — `cancel:` sent with one argument too few, so `sender` is garbage

- `src/platform/darwin/shim/85_sheet_result.c:16-17` — the guard checks for `"cancel:"` (a selector
  with one colon), then casts `objc_msgSend` to `(void (*)(void *, void *))` and calls it with only
  `panel` and `sel_registerName("cancel:")`. No third argument is passed.
- The method really is `- (IBAction)cancel:(id)sender;` on `NSSavePanel`; `NSOpenPanel` inherits it.
  On arm64 the third argument register (`x2`) is left holding whatever the preceding
  `panel_has_instance` / `sel_registerName` calls left there, and the callee reads it as an object.
- `src/platform/darwin/shim/downloads/30_api.c:98-99` is the same selector sent correctly in this
  same codebase: `(void (*)(void *, void *, void *))objc_msgSend)(download, sel_registerName("cancel:"), &dl_cancel_block)`.
  So the arity is known here; this file just missed it.

**Reached:** `src/platform/darwin/dialog.ts:136-144` calls the page-level cancel, which goes through
`src/platform/darwin/panel-shim.ts:68` `sheetCancel()` → `shim_sheet_cancel()`. The comment at
`85_sheet_result.c:8-9` explicitly says this is meant to "run the same path as clicking Cancel",
but a real click passes the button as `sender` and this call passes an uninitialised pointer. If
AppKit's `cancel:` ignores its sender the sheet still ends by luck; if it forwards or compares the
sender, it messages a garbage object and aborts with no JS error (uncaught ObjC exceptions are
fatal — see `src/platform/darwin/index.ts:3`). Every `dialog.cancel` on a live sheet reaches this.

---

## F2 (high) — every `alloc`/`init` object is left at +1; no `release` exists in any of the seven files

- `src/platform/darwin/shim/55_menu.c:12-19` `menu_nsstring` returns an owned NSString; its callers
  `menu_new` (`:48-53`) and `menu_row` (`:62-72`) never release `text` or `equivalent`. The `row`
  and `menu` objects themselves are also left at +1 after being handed to `addItem:` / `setSubmenu:`
  / `setMainMenu:`, which retain their own copies.
- `src/platform/darwin/shim/60_panels.c:140-143` — `panel_nsstring(ext)` returns +1 and is added to
  the NSMutableArray, which retains it; the +1 is never released. One leak per filter extension.
- `src/platform/darwin/shim/75_open_panel.c:41-42` and `src/platform/darwin/shim/80_save_panel.c:23-24`
  — title NSString `t` never released; `80_save_panel.c:31-34` — suggested name `n` never released.
- `src/platform/darwin/shim/50_app.c:17-35` — `allocd` NSString and `allocd` NSImage are init'd into
  `file` and `image`; both stay at +1. `-setApplicationIconImage:` retains `image` on top of that.
- `rg -n 'release|retain' <the seven files>` returns nothing. The repo's own stated rule is the
  opposite: `src/platform/darwin/network-ownership.test.ts:7,26-32` ("balances every +1 object it
  creates") counts `release` calls and asserts 9 for a served request. These seven files do not.

**Reached:** `src/platform/darwin/panel-shim.ts:45-63` → every `shim_open_panel` / `shim_save_panel`
call leaks the title, one NSString per extension, and (save only) the suggested name. Because it is
per dialog rather than one-shot, this is the unbounded half. The menu leaks are reached once at
startup via `src/platform/darwin/appkit.ts:35` / `src/platform/darwin/menu-api.ts:120`
(`shim_menu_install`) and again on menu restore; the icon leak via `src/platform/darwin/dock-icon.ts:19`
when the app has an `icon` option.

---

## F3 (medium) — no autorelease pool is ever created, although `50_app.c` says the caller holds one

- `src/platform/darwin/shim/50_app.c:11` claims "The `NSImage` is autoreleased by the pool the caller
  already holds open." There is no such pool: `shim_pool_new` / `shim_pool_init` / `shim_pool_drain`
  are defined at `50_app.c:39-49` and declared as FFI symbols at `src/platform/darwin/index.ts:136-138`,
  but `rg` finds no call to them anywhere in `src` (the spike declares them but never calls them
  either). The only real pool in the shim is a local one inside `114_network_probe.c:131`.
- Every convenience object these files create is therefore autoreleased with no pool in place and
  leaks: `+[NSOpenPanel openPanel]` / `+[NSSavePanel savePanel]` (a whole panel object graph),
  `+[NSMutableArray array]`, `+[NSDate date]` and `-dateByAddingTimeInterval:` in `50_app.c:90-93`,
  `+separatorItem` in `55_menu.c:79`, and `-URLs` / `-path` / `-UTF8String` in `60_panels.c:88-113`.

**Reached:** on every pump tick — `50_app.c:84-105` creates two autoreleased NSDate objects per
`shim_pump` call, and the pump runs at frame rate, so this is a continuous leak independent of any
dialog. On every open/save, the panel itself leaks. The false comment makes it worse: a maintainer
"fixing" the icon leak by draining a pool would fix nothing, because that object is `alloc`'d (+1),
not autoreleased — that part belongs to F2.

---

## F4 (medium, latent) — `panel_sheet_panel` stores an autoreleased object without retaining it, then dereferences it asynchronously

- `src/platform/darwin/shim/75_open_panel.c:56,75` and `src/platform/darwin/shim/80_save_panel.c:42,58`
  assign the `+openPanel` / `+savePanel` result (a +0 autoreleased object) straight into the static
  `panel_sheet_panel` declared at `60_panels.c:26`. No `retain` is sent.
- It is read later, off the JS call stack, in the completion handler at
  `src/platform/darwin/shim/70_sheet_block.c:50-53` (`panel_collect` / `panel_collect_save`) and in
  `shim_sheet_cancel` at `src/platform/darwin/shim/85_sheet_result.c:13-17`. The comment at
  `75_open_panel.c:52-54` explicitly relies on that later read ("a sheet that ends immediately must
  still find it").

**Reached:** a sheet started from `panel-shim.ts:45-63`, completed by a user click or by
`shim_sheet_cancel`; the handler runs on the main thread after the invoke returned. Today AppKit
retains the presented sheet (window's attached sheet, or the modal session for
`beginWithCompletionHandler:`), so the pointer is normally still valid — which is why this is
latent rather than a live crash. But the C holds no ownership of its own: if AppKit releases the
panel before the handler runs (immediately-ending sheet, or a presentation path that does not keep
it), `panel_collect` sends `URLs` to freed memory. With F3 there is also no pool that would keep the
object alive by accident.
