# BunKit: how it drives AppKit from Bun, and what its native bridge actually does

Recon for crust. Source read at commit `3c95a36` (2026-09-21, "shorten the readme"), cloned to `research/bunkit/repo`. Every claim below is a `file:line` in that tree or the output of a command in this file. Where I ran a probe to test something the brief asserted, the probe path and its output are named.

---

## 1. What it is

Real AppKit apps in TypeScript on Bun, no webview: windows, `NSTableView`, menus, sheets, and a Metal layer. One contributor with real commits (`hiett`, 27 commits; `alii` has 1), 8 stars, 0 forks, Apache-2.0, created 2026-08-17, `private: true` in `package.json:7`, and no package on npm under that name (the npm `bunkit` at 0.0.2 is an unrelated "A toolkit for Bun" from 2025). Requires macOS on Apple silicon and Bun >= 1.4 (`package.json:28-36`), Xcode Command Line Tools.

One provenance detail that matters when reading it: **the default branch `master` is at `3c95a36` (2026-09-21), while `gh api` reports `pushed_at` 2026-11-11** — that push went to `hiettlight/v2` and `hiettlight/dome-show`, which are not merged. So this document describes master, and newer work exists on those branches unseen.

The layers, per `README.md:63-69`:

| layer | file | job |
|---|---|---|
| 3 | `src/ui/` | `Window`, `VStack`, `Button`, `Table` — 26 classes (README's count; `rg -c '^export class' src/ui/*.ts` totals 27 across eight files, so the README is one short) |
| 2 | `src/objc.ts` | `objc.NSWindow.alloc().init…()`, marshalling, delegates, blocks |
| 1 | `src/bridge.ts` | dlopen, packing arguments into buffers |
| 0 | `build/libobjcbridge.dylib` | libffi, type-encoding parser, runtime classes, run loop |

The artifact is **not committed** (`.gitignore:1-4` ignores `build/`, `dist/`, `*.dylib`, `*.dSYM/`). It is 84,144 bytes arm64, built in 2.0 s by `./native/build.sh` on this machine, exporting **54** `br_*` symbols (`nm -gU build/libobjcbridge.dylib | rg -c ' T _br_'`). `bridge.h` declares **52** of them and `src/bridge.ts` dlopens **51**; the two exports the header never declares are `br_bundle_path` and `br_set_terminate_after_last_window` (both dlopened, `src/bridge.ts:126,133`), and the three header functions never dlopened are `br_sig_get` and `br_ffi_type_for` (native-internal) and `br_class_add_ivar_ptr` (defined at `native/src/closures.m:140`, never called from anywhere). So the header lags the dylib by two, which is worth knowing before trusting it as the API.

Two comments in the repo carry the design's whole reason for existing: `native/src/bridge.h:3-5` says the exported surface is "intentionally small and permanently stable: adding support for a new AppKit class must never require a change to this file", and `CLAUDE.md:27-30` says arm64-only is deliberate because "the dispatcher is written to the arm64 ABI, where struct returns use `x8` and `objc_msgSend_stret` does not exist".

---

## 2. The bridge API

### 2.1 Layer 1 — `src/bridge.ts`

The dylib is found by trying six paths, env var first (`src/bridge.ts:37-51`), and the module throws unless `process.platform === "darwin" && process.arch === "arm64"` (`src/bridge.ts:56-60`).

Everything is declared in one `dlopen` (`src/bridge.ts:73-134`). The declarations are the API, so here it is function by function — signature from `native/src/bridge.h`, behaviour from the `native/src/*.m` body:

**Introspection** (`dispatch.m:17-126`, declared `bridge.h:98-114`)

| function | what it actually does |
|---|---|
| `br_version()` | returns the literal `"objcbridge 0.1.0"` (`dispatch.m:11`) |
| `br_class(name)` | `objc_lookUpClass` — nil for an unknown class (`dispatch.m:17`) |
| `br_metaclass(name)` | `objc_getMetaClass` (`dispatch.m:18`) |
| `br_selector(name)` | `sel_registerName`, so the selector is interned before every call (`dispatch.m:19`) |
| `br_selector_name(sel)` | `sel_getName`, `""` for nil (`dispatch.m:20`) |
| `br_method_signature(cls, sel, instance)` | `class_getInstanceMethod`/`class_getClassMethod` then `method_getTypeEncoding`; NULL if unimplemented (`dispatch.m:22-27`) |
| `br_protocol_method_signature(proto, sel, required, instance)` | `protocol_getMethodDescription`, both requirement kinds (`dispatch.m:29-37`) |
| `br_object_class_name(obj)` | `object_getClassName`, `"nil"` for nil (`dispatch.m:39`) |
| `br_object_class(obj)` | `object_getClass` — the *dynamic* class, which is what a selector lookup must use (`dispatch.m:43`) |
| `br_responds(obj, sel)` | `class_respondsToSelector` on the dynamic class; this is what backs the Proxy's `has` trap (`dispatch.m:47`) |
| `br_class_responds(cls, sel, instance)` | same, choosing metaclass when `!instance` (`dispatch.m:52`) |
| `br_is_kind_of(obj, cls)` | walks `class_getSuperclass` by hand rather than calling `isKindOfClass:` (`dispatch.m:58`) |
| `br_class_super_name(cls)` | `class_getName(class_getSuperclass(cls))` (`dispatch.m:65`) |
| `br_copy_method_list(cls, instance, out, cap)` | serialises the class's own methods as newline-separated `selector\tencoding`, returns bytes needed so JS can retry with a bigger buffer (`dispatch.m:72-89`) |
| `br_copy_class_list(out, cap)` | every registered class name, one per line (`dispatch.m:91-104`) |
| `br_copy_protocol_method_list(proto, out, cap)` | required then optional, each line `selector\tencoding\trequired` (`dispatch.m:106-126`) |

**Layout** (`bridge.h:116-123`, body `encoding.m:367-396`)

| function | what it does |
|---|---|
| `br_signature_layout(types, out, cap)` | parses a whole method encoding and writes the flat int32 array `[nargs, argbufSize, retbufSize, retKind, retSize, retAlign, (kind,size,align,offset)*nargs]` (`bridge.h:117-119`, filled at `encoding.m:367-385`) |
| `br_type_layout(type, out, cap)` | the same three numbers for one bare type: `[kind, size, align]` (`encoding.m:388-396`) |

**Dispatch** (`dispatch.m:155-239`)

| function | what it does |
|---|---|
| `br_msgsend(target, sel, types, argbuf, retbuf, err)` | memoises the signature, writes `self` and `_cmd` into slots 0 and 1 itself, zeroes the return buffer, `ffi_call(objc_msgSend)` inside `@try`, and returns `BR_OK`/`BR_ERR_*` with a `strdup`'d message in `*err` (`dispatch.m:155-183`) |
| `br_msgsend_super(target, superclass, sel, types, argbuf, retbuf, err)` | same, but slot 0 is a stack `objc_super{receiver, super_class}` and the callee is `objc_msgSendSuper` (`dispatch.m:185-213`) |
| `br_call_function(fn, types, argbuf, retbuf, err)` | `ffi_call` on any dlsym'd C function, no `self`/`_cmd` — the escape hatch for C functions and enums (`dispatch.m:222-239`) |

**Runtime class creation** (`closures.m:113-149`)

| function | what it does |
|---|---|
| `br_class_create(name, super)` | `objc_allocateClassPair`, and **NULL if the name already exists** — the caller must pick a fresh name (`closures.m:113-118`) |
| `br_class_add_method(cls, sel, types, jsfn, token, classMethod)` | builds a libffi closure over `types`, installs its code pointer as the IMP, falls back to `class_replaceMethod` when `class_addMethod` refuses (`closures.m:120-132`) |
| `br_class_add_protocol(cls, proto)` | `class_addProtocol`, before registration (`closures.m:134`) |
| `br_class_add_ivar_ptr(cls, name)` | `class_addIvar` of one `^v`; the one export nothing calls (`closures.m:140`) |
| `br_class_register(cls)` | `objc_registerClassPair`; irreversible (`closures.m:147`) |
| `br_object_set_token(obj, token)` / `br_object_get_token(obj)` | an associated `NSNumber` under a private key — how a trampoline finds the right JS handler table from `self` (`closures.m:27-41`) |

**Blocks** (`closures.m:177-212`)

| function | what it does |
|---|---|
| `br_block_create(types, jsfn, token)` | `calloc`s a `BRBlock` + descriptor, `isa = &_NSConcreteGlobalBlock`, `invoke` = a closure code pointer over `types` (`closures.m:177-198`) |
| `br_block_release(block)` | frees the closure, the ctx, the descriptor, the `strdup`'d signature and the block (`closures.m:200-212`) |

**Memory** (`memory.m`)

| function | what it does |
|---|---|
| `br_retain(obj)` / `br_release(obj)` | `CFRetain`/`CFRelease`, nil-safe (`memory.m:9-17`) |
| `br_autorelease(obj)` | `-autorelease` (`memory.m:19`) |
| `br_retain_count(obj)` | `CFGetRetainCount` (`memory.m:24`) |
| `br_autorelease_pool_push()` / `_pop()` | a 64-deep explicit stack of `NSAutoreleasePool`s (`memory.m:30-43`) |
| `br_autorelease_pool_recycle()` | drains and replaces **only** the outermost pool, and only when depth is exactly 1 — so an explicit nesting is never drained out of turn; returns whether it did anything (`memory.m:52-58`) |
| `br_autorelease_pool_depth()` | current depth (`memory.m:60`) |
| `br_free(p)` | `free()` — used to release the `strdup`'d error strings (`memory.m:62`, `src/bridge.ts:328-336`) |

**Strings and symbols**

| function | what it does |
|---|---|
| `br_nsstring(utf8, len)` | `[[NSString alloc] initWithBytes:length:encoding:]`, or `initWithUTF8String:` when `len < 0`; returns **+1**, JS releases it (`memory.m:69-79`) |
| `br_nsstring_utf8(s)` | borrowed `UTF8String`, NULL unless the object is an `NSString` (`memory.m:82-87`) |
| `br_nsstring_len(s)` | byte length in UTF-8, `-1` for a non-string (`memory.m:89-94`) |
| `br_dlsym(name)` | `dlsym(RTLD_DEFAULT, name)` — spelled `(void*)-2` inline rather than importing `<dlfcn.h>` (`dispatch.m:128-131`) |

**Lifecycle and run loop** (`runloop.m`)

| function | what it does |
|---|---|
| `br_app_init(policy)` | runs once: uncaught-exception handler, `sharedApplication`, `setActivationPolicy:`, an internal `BRAppDelegate`, `finishLaunching`, `activateIgnoringOtherApps:YES` (`runloop.m:55-66`) |
| `br_set_terminate_after_last_window(v)` | whether AppKit quits when the last window closes (`runloop.m:68`) |
| `br_set_stop_callback(cb)` | JS function called from `applicationShouldTerminate:` (`runloop.m:70`, `28-33`) |
| `br_pump(seconds)` | the pump: `nextEventMatchingMask:` until a deadline, `sendEvent:` per event, `updateWindows` when events came or every 50th idle pump; returns events handled (`runloop.m:79-114`) |
| `br_stop()` / `br_should_stop()` | the `g_stop` flag (`runloop.m:72-73`) |
| `br_post_empty_event()` | posts an `NSEventTypeApplicationDefined` event to wake a pump blocked in `mach_msg` (`runloop.m:117-131`) |
| `br_now()` | `mach_absolute_time` scaled through `mach_timebase_info`, in seconds (`runloop.m:133-138`) |
| `br_bundle_path()` | `[[NSBundle mainBundle] bundlePath]` (`runloop.m:141-143`) — exported and dlopened but absent from `bridge.h` |

Two headers facts worth carrying: the result codes are a stable ABI (`BR_OK = 0`, then `-1…-6` for bad encoding, exception, no method, nil target, alloc, overflow; `bridge.h:25-33`), and so is the type-kind enum (`BR_K_VOID = 0` … `BR_K_UNKNOWN = 20`; `bridge.h:38-61`) that JS mirrors as `K`.

The one call convention worth noting: **every Obj-C pointer crosses as `u64` (`FFIType.u64`), never `ptr`**. `src/bridge.ts:64` is `const OBJ = FFIType.u64; // an Obj-C pointer (may be tagged)`, and `src/bridge.ts:7-11` explains why — tagged pointers (short strings, small `NSNumber`s, dates) set high bits and exceed 2^53, so they must be `bigint` all the way through.

### 2.2 The call path in layer 2

`invoke()` (`src/objc.ts:832-851`) resolves the selector's encoding from the runtime, then `dispatch()` (`src/objc.ts:859-921`):

1. `resolve()` (`src/objc.ts:758-782`) caches `{selPtr, types, typesBuf, layout, split, family}` per class+selector. `types` comes from `method_getTypeEncoding` via `br_method_signature`.
2. `sigLayout(types)` (`src/bridge.ts:230-256`) calls `br_signature_layout` into a shared `Int32Array(1024)` scratch (`src/bridge.ts:226-227`) and decodes `[nargs, argbufSize, retbufSize, retKind, retSize, retAlign, (kind,size,align,offset)*nargs]`.
3. `acquire()` (`src/bridge.ts:306-317`) takes a slot from a **growing stack** of reusable buffer sets (`src/bridge.ts:284-304`) — nested calls (`msgSend → AppKit → delegate → msgSend`) each get their own slot, and a slot is never handed out twice while live.
4. `writeArg` (`src/objc.ts:522-639`) writes each argument into the packed buffer at the offset the shim computed, with a `DataView` over the slot.
5. `br_msgsend(target, sel, typesBuf, argPtr, retPtr, errPtr)` (`src/objc.ts:893`).
6. `readValue` (`src/objc.ts:679-741`) decodes the return buffer; `init`/`alloc`/`new`/`copy`/`mutableCopy` families get a `+1` retain, and the wrapper's `FinalizationRegistry` releases it (`src/objc.ts:143-148`, `369-383`).

Two details that matter if crust copies this. First, the encoding is parsed **twice**: natively for sizes and offsets (`native/src/encoding.m`) and again in JS for the *text* of each type, because the shim's flat int32 layout does not carry type text — `src/objc.ts:39-43` says exactly that. Second, a `Proxy` answers every unknown property with a selector-dispatch closure (`src/objc.ts:282-306`), which is why `isObjC()` exists and why `CLAUDE.md:39-41` warns that `x.maybeThing?.()` never short-circuits.

---

## 3. Type-encoding parsing

This is the largest single file in `native/src`: `encoding.m`, 397 lines.

### 3.1 Two parsers, one per direction

**Native** (`native/src/encoding.m`) is the authoritative one. `br_ffi_type_for` (`encoding.m:140-288`) parses one bare type and returns an `ffi_type*`; `br_sig_get` (`encoding.m:302-361`) parses a full method encoding and memoises an `ffi_cif`.

**JS** (`src/objc.ts:45-116`) is a lighter tokenizer that only needs each type's *text*: `nextType` (`objc.ts:51-89`) returns `[text, nextIndex]`, and `splitEncoding` (`objc.ts:98-116`) turns `"v24@0:8@16"` into `{ret: "v", args: ["@", ":"]}`.

### 3.2 The encoding-character table

The native table is `prim()` at `native/src/encoding.m:88-115`. Reproduced verbatim:

| char | kind | ffi_type |
|---|---|---|
| `c` | `BR_K_SINT8` | `ffi_type_sint8` |
| `C` | `BR_K_UINT8` | `ffi_type_uint8` |
| `s` | `BR_K_SINT16` | `ffi_type_sint16` |
| `S` | `BR_K_UINT16` | `ffi_type_uint16` |
| `i` | `BR_K_SINT32` | `ffi_type_sint32` |
| `I` | `BR_K_UINT32` | `ffi_type_uint32` |
| `l` | `BR_K_SINT32` | `ffi_type_sint32` |
| `L` | `BR_K_UINT32` | `ffi_type_uint32` |
| `q` | `BR_K_SINT64` | `ffi_type_sint64` |
| `Q` | `BR_K_UINT64` | `ffi_type_uint64` |
| `f` | `BR_K_FLOAT` | `ffi_type_float` |
| `d` | `BR_K_DOUBLE` | `ffi_type_double` |
| `D` | `BR_K_DOUBLE` | `ffi_type_double` |
| `B` | `BR_K_BOOL` | `ffi_type_uint8` |
| `v` | `BR_K_VOID` | `ffi_type_void` |
| `*` | `BR_K_CHARPTR` | `ffi_type_pointer` |
| `@` | `BR_K_OBJECT` | `ffi_type_pointer` |
| `#` | `BR_K_CLASS` | `ffi_type_pointer` |
| `:` | `BR_K_SEL` | `ffi_type_pointer` |
| `?` | `BR_K_POINTER` | `ffi_type_pointer` |

`l`/`L` map to 32 bits with a comment explaining LP64: "On LP64 Apple encodes `long` as `q`; a bare `l` therefore only appears in legacy 32-bit-era encodings" (`encoding.m:96-99`). `D` (`long double`) is a double on arm64 (`encoding.m:104-105`).

Qualifiers are skipped, not decoded: `r n N o O R V A + |` (`encoding.m:17-21`).

The aggregate cases before the table:

- `@?` → `BR_K_BLOCK`, pointer (`encoding.m:149-153`)
- `@"NSString"` → `BR_K_OBJECT` after skipping the quoted class name (`encoding.m:155-161`)
- `^type` → pointer, pointee consumed recursively; an unparseable pointee still leaves the cursor in the right place (`encoding.m:163-172`)
- `bN` bitfields are **refused** (`encoding.m:174-178`) rather than silently mis-sized
- `[Nt]` → `ffi_type` struct with `n` copies of the element (`encoding.m:180-205`), capped at 65536
- `{...}` / `(...)` → struct or union (`encoding.m:207-277`); a union has no libffi type, so it is synthesised as "a struct of one element with max size/align" (`encoding.m:245-259`); an opaque `{CGContext=}` gets one byte (`encoding.m:262-269`)

`ffi_type` descriptors for aggregates are built by hand (`make_aggregate`, `encoding.m:121-128`), then `finalize_aggregate` (`encoding.m:131-136`) calls `ffi_prep_cif` once with the aggregate as a single argument purely to force libffi to compute `size` and `alignment` — the check is `t->size > 0`.

### 3.2.1 What ships to JS, and what does not

`br_signature_layout` (`encoding.m:367-385`) writes a flat int32 array. Note what is absent: type *text*, and the struct's field list. That is why `src/structs.ts:1-6` exists — "Objective-C type encodings carry a struct's *name* and its field types, but not its field names (`{CGRect={CGPoint=dd}{CGSize=dd}}`). So the shim computes sizes and offsets, and this table supplies the names." The table (`src/structs.ts:31-118`) is hand-written for `CGPoint`, `CGSize`, `CGRect`, `CGVector`, `_NSRange`, `NSEdgeInsets`, `CGAffineTransform`, plus the `NSPoint`/`NSSize`/`NSRect`/`NSRange` aliases (`structs.ts:122-125`). Anonymous structs fall back to raw bytes (`src/objc.ts:616-629`).

### 3.3 The cif

`br_sig_get` (`encoding.m:302-361`) memoises per encoding in 1024 buckets, builds `atypes`/`ainfo`, computes packed offsets with `align_up` (`encoding.m:297-300`), sets `argbuf_size = align_up(off, 16)` (min 16) and `retbuf_size = max(ret.size, sizeof(ffi_arg))` aligned to 16 (`encoding.m:346-351`), then `ffi_prep_cif(&s->cif, FFI_DEFAULT_ABI, count, rtype, atypes)` (`encoding.m:353`).

`FFI_DEFAULT_ABI` on arm64-darwin is `FFI_SYSV` = **1** (`/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/ffi/ffitarget_arm64.h:46-57`). My probes pass `1` and `ffi_prep_cif` returns `FFI_OK`.

### 3.4 Dispatch

`br_msgsend` (`dispatch.m:155-183`) writes `self` and `_cmd` into slots 0 and 1 itself ("Slots 0 and 1 (self, _cmd) are owned by us, not by JS", `dispatch.m:162`), zeroes the return buffer, and does:

```c
ffi_call(&s->cif, FFI_FN(objc_msgSend), retbuf, argptrs);
```

inside `@try`/`@catch (NSException*)` (`dispatch.m:173-181`). The comment at `dispatch.m:171-172` is the reason there is no `_stret` or `_fpret` variant anywhere: "arm64 has no objc_msgSend_stret or _fpret: struct returns use x8 and libffi handles them, so there is exactly one entry point." `br_msgsend_super` does the same with `objc_msgSendSuper` and a stack `objc_super` (`dispatch.m:185-213`). `br_call_function` calls an arbitrary dlsym'd C function with a JS-supplied encoding and **no self/_cmd** (`dispatch.m:222-239`).

**Answer to the brief's question: yes, it uses `ffi_prep_cif`/`ffi_call`, and yes, it builds `ffi_type` descriptors itself** — for every struct, union and array. It never hand-writes a `ffi_type` for a scalar; those come from libffi's exported globals.

---

## 4. Delegates and blocks

### 4.1 Delegates: runtime class per shape, one JSCallback for all of them

`createDelegate(handlers, options)` (`src/objc.ts:1118-1177`):

1. One Obj-C class per distinct **shape** (superclass + protocol list + sorted selector list), named `BRJS_<name>_<n>` (`objc.ts:1125-1131`). Registered classes can never be freed, so shape caching is the only thing keeping class creation bounded.
2. Each selector's encoding is found by `findTypes` (`objc.ts:1079-1102`): explicit override first, then `protocol_getMethodDescription` over `DEFAULT_PROTOCOLS` (27 protocols, `objc.ts:1047-1075`) for both required and optional, then a borrow from `FALLBACK_CLASSES` = `NSObject`, `NSResponder`, `NSView`, `NSWindow`, `NSApplication`, `NSControl` (`objc.ts:1077`). If nothing answers, it throws with the fix in the message (`objc.ts:1137-1142`).
3. Each selector gets a `methodSlots` index — a flat `int` token (`objc.ts:1143-1150`).
4. `br_class_add_method(cls, sel, types, dispatchCallback.ptr, token, 0)` (`objc.ts:1151-1153`).
5. `objc_registerClassPair` via `br_class_register` (`objc.ts:1157`).
6. Per **instance**: a handler table is built by translating every key through `toSelector` (`objc.ts:1162-1163`), a token is taken from a free list or appended (`objc.ts:1164-1168`), the class is sent `alloc`/`init` through the normal dispatcher (`objc.ts:1170-1171`), the token is attached as an associated object (`objc.ts:1172`), and `(obj as any).__handlers = table` roots the table for the delegate's lifetime (`objc.ts:1173-1174`).
7. `delegateFinalizers.register(table, instToken)` returns the token to the free list once the table is collected (`objc.ts:1175`, `952-955`).
8. `updateDelegate(delegate, handlers)` mutates the *live* table in place instead of rebuilding the class, reading the token back off the object (`objc.ts:1180-1188`).

On the native side, `br_class_add_method` (`closures.m:120-132`) builds one `br_ctx` per selector and installs `ctx->code` — an `ffi_closure`'s executable code pointer — as the IMP:

```c
ffi_closure* cl = ffi_closure_alloc(sizeof(ffi_closure), &code);
ffi_prep_closure_loc(cl, &s->cif, br_trampoline, ctx, code);
class_addMethod(target, (SEL)sel, (IMP)ctx->code, types);
```

(`closures.m:99-101`, `closures.m:126`.)

**The critical trick: exactly one JS callback for every trampoline.** `br_trampoline` (`closures.m:47-76`) has the fixed signature `void (uint32_t methodToken, uint32_t instanceToken, void *argbuf, void *retbuf)` (`closures.m:14-15`), packs libffi's incoming `void **args` into the *same flat layout* JS uses for `msgSend` (`closures.m:52-59`), resolves the per-instance handler table through an associated-object token (`closures.m:66-69`), and calls the JS function. On the JS side that is one `JSCallback` created once (`src/objc.ts:989-1025`), declared `{ args: [u32, u32, ptr, ptr], returns: void }` (`objc.ts:1024`), held in a `KEEP_ALIVE` set because "if this were collected AppKit would jump into freed memory" (`objc.ts:1027-1028`).

The token table is `instanceHandlers`, an array of **`WeakRef`s on purpose** (`objc.ts:939-955`): a delegate's handlers close over the object that owns them, so a strong table would root the cycle `global array → table → closure → Window → delegate wrapper → table` and every window ever opened would leak. The table is kept alive by `(obj as any).__handlers = table` (`objc.ts:1174`), and a `FinalizationRegistry` recycles the token (`objc.ts:952-955`, `1175`).

Four rules inside that trampoline are load-bearing and easy to miss if you reimplement it:

- **How much of the return buffer the closure may touch** is computed per signature (`closures.m:86-97`). For an aggregate it is exactly the struct's size, because widening would scribble past the end; for a scalar narrower than `ffi_arg` it is widened to `sizeof(ffi_arg)`, because libffi requires the closure to write a whole `ffi_arg` or the caller sees stale register bytes.
- **The instance token is read from `self`**, and only when this is not a block and the first argument is 8 bytes wide (`closures.m:66-69`). A delegate method whose slot 0 is not an object pointer silently gets token 0.
- **Argument decoding skips 1 slot for a block and 2 for a method** (`src/objc.ts:960`), which is why one decoder serves both.
- **A handler whose table has been collected is not called silently**: it warns once per token, telling you to keep the delegate alive (`objc.ts:997-1011`), and a throw from the handler is caught in JS so it never unwinds into Obj-C (`objc.ts:1019-1022`). A native `NSException` escaping the closure is logged and swallowed (`closures.m:71-75`).

`encodeReturn` (`objc.ts:969-987`) mirrors the trampoline's widening rule and autoreleases any object the handler returns (`objc.ts:984-986`), "exactly as a hand-written method would".

### 4.2 Blocks: a synthesised global block over the same closure

`br_block_create` (`closures.m:177-198`) builds a `struct BRBlock` by hand:

```c
struct BRBlock { void* isa; int flags; int reserved; void (*invoke)(void*, ...);
                 struct BRBlockDescriptor* descriptor; br_ctx* ctx; };
```

with `isa = &_NSConcreteGlobalBlock` and `flags = BR_BLOCK_HAS_SIGNATURE (1u<<30)` (`closures.m:155-173`, `191-194`). The comment at `closures.m:189-190` gives the reason for global: "A *global* block is never copied or freed by the runtime, so AppKit holding on to it can never leave us with a dangling closure. We free it explicitly." The `invoke` pointer is the same `ffi_closure` code pointer, so a block and a delegate method share `br_trampoline` and the same `JSCallback`.

JS side: `createBlock(types, fn)` (`src/objc.ts:1230-1248`) allocates a `methodSlots` entry with `isBlock: true` and `fn` inline, calls `br_block_create`, and tracks it in `liveBlocks` — "blocks are freed explicitly, never by GC" (`objc.ts:1246`). `ObjCBlock.dispose()` (`objc.ts:1211-1221`) clears the slot's `fn` and returns the token to `freeSlots`, because "a long-running app that makes a block per sheet keeps every closure it ever created" otherwise (`objc.ts:1215-1216`); then it calls `br_block_release`.

The descriptor is a real one (`closures.m:160-164`, `182-186`): `{reserved: 0, size: sizeof(struct BRBlock) = 40, signature: strdup(types)}`, and the block carries only `BR_BLOCK_HAS_SIGNATURE` (`1<<30`) — deliberately **not** `BR_BLOCK_HAS_COPY_DISPOSE` (`1<<25`, declared at `closures.m:156`), because a global block is never copied. The block also stashes its `br_ctx` past the descriptor (`closures.m:172`, `196`) purely so `br_block_release` can find and `ffi_closure_free` it along with everything else (`closures.m:200-212`).

Blocks are also created implicitly when a method takes one: an argument of kind `BR_K_BLOCK` that arrives as a JS function is converted with `createBlock(blockEncodingFor(enc), fn)` and kept alive in the call's temp list (`src/objc.ts:595-604`), where `blockEncodingFor` turns a bare `@?` into `v@?` (`objc.ts:1194-1197`).

Blocks are used in anger: `src/ui/input.ts:208` (`"@@?@"`, an `NSEvent` monitor), and four times in `src/ui/dialogs.ts:56,135,158,186` (`"v@?q"`, a modal sheet response).

---

## 5. The run loop

### 5.1 Where it is pumped from

`src/runtime.ts:164-214`, `run(options)`. It is a plain `async` function with a `while` loop, not a timer. Each iteration:

```ts
lib.br_autorelease_pool_recycle();
lib.br_autorelease_pool_push();
try {
  const handled = lib.br_pump(idle ? idlePump : activePump);
  quiet = handled > 0 ? 0 : quiet + 1;
  tickFrames();
} finally {
  await Bun.sleep(deep ? deepIdleSleep : idle ? idleSleep : 0);
  lib.br_autorelease_pool_pop();
}
```

(`src/runtime.ts:187-200`.) Defaults: `pumpSeconds = 0.004`, `idlePumpSeconds = 0.002`, `idleSleepMs = 8`, `deepIdleSleepMs = 16`, `idleAfter = 20`, `deepIdleAfter = Infinity` (`runtime.ts:165-170`). The idle cadence exists because "time blocked inside AppKit is time Bun's event loop cannot run" (`runtime.ts:22-26`) — so once quiet, the waiting happens in `Bun.sleep` instead of inside `mach_msg`.

**No `CFRunLoopRunInMode` appears anywhere in the repo**, and no `setInterval` in library code — the only intervals are the two in `examples/demo.ts:240,245` and one in `test/runloop.ts:80` (`rg -n 'CFRunLoop|setInterval' src native tools examples test`). AppKit is pumped by `[NSApp nextEventMatchingMask:untilDate:inMode:dequeue:]` + `[NSApp sendEvent:]` (`native/src/runloop.m:87-99`), with `[NSApp updateWindows]` every event-bearing pump and every 50th idle pump (`runloop.m:104-111`). Each pump runs inside `@autoreleasepool` (`runloop.m:83`). `br_now()` is `mach_absolute_time` (`runloop.m:133-138`).

The pump's shape is worth copying exactly (`runloop.m:84-113`):

- **One deadline per pump**, `[NSDate dateWithTimeIntervalSinceNow:seconds]`, or `distantPast` when `seconds <= 0` so the call cannot block at all.
- **Drain after the first event**: the deadline is replaced with `distantPast` inside the loop (`runloop.m:97-98`), so a burst of queued events all come out of one pump and only the *first* wait can block in `mach_msg`.
- **The blocking wait is in `NSDefaultRunLoopMode`**, not the tracking or modal mode.
- **Every `sendEvent:` is individually wrapped** in `@try`/`@catch` and logged, and so is `updateWindows` (`runloop.m:91-95`, `106-110`). That is what stops one bad event from killing the app — and it is a capability the JS side cannot add, since it must sit on the native side of the call.
- **`updateWindows` is gated** on "we handled events, or 50 idle pumps have gone by" (`runloop.m:100-105`) rather than running on a fixed cadence.
- **It returns the event count**, which is what drives `quiet` and therefore the sleep ladder in JS.

### 5.2 Lifecycle and quit

`br_app_init` (`runloop.m:55-66`) installs an uncaught-exception logger, `[NSApplication sharedApplication]`, `setActivationPolicy:`, a `BRAppDelegate`, `finishLaunching`, `activateIgnoringOtherApps:YES`. The delegate refuses AppKit's own exit: `applicationShouldTerminate:` sets a flag, fires an optional JS stop callback, and returns `NSTerminateCancel` (`runloop.m:28-33`), "so JS gets a chance to unwind, save state and shut the loop down itself". `br_post_empty_event` (`runloop.m:117-131`) posts an `NSEventTypeApplicationDefined` event to wake a pump blocked in `mach_msg`, and `quit()` calls it (`runtime.ts:129-138`).

`CLAUDE.md:34-35`: "**Never add a `runModal*` call to `src/ui/`.** It spins a nested run loop that `br_pump` does not return from, which freezes all of JavaScript. Sheets only." `README.md:88` repeats it for users.

**The tree does not quite obey that, and says why.** `src/ui/dialogs.ts:73` and `:196` both call `a.runModal()`, each guarded by `if (parent)` — the sheet path is `beginSheetModalForWindow_completionHandler_` (`dialogs.ts:69`), and `runModal` is the "no window to attach to" fallback with the comment "This *does* block JS, which is exactly why it is the last resort" (`dialogs.ts:71-72`). So the rule is really "never make `runModal` the normal path", and a dialog with no parent window is the one accepted exception. `applicationShouldTerminateAfterLastWindowClosed:` returns a JS-settable flag (`runloop.m:35-38`, `68`), and `br_app_init` is idempotent through a function-local `static int done` (`runloop.m:56-58`).

### 5.3 Measured behaviour

`test/runloop.ts` is a real suite against a real `NSApplication`. What it encodes: an idle-CPU budget of **3 %** locally and **12 %** on CI (`test/runloop.ts:29`), 10 000 target/action round trips through `-performClick:` (`test/runloop.ts:117-121`), 100 000 direct Obj-C→libffi→JS callback round trips asserted under **5 µs** each (`test/runloop.ts:126-131`), and 200 000 `msgSend` iterations over `-length`, `-frame` (struct return) and `-setFrame:` (struct argument), the first two asserted under 5 µs (`test/runloop.ts:171-188`). The suite also asserts the wrapper count does not blow up, resize/close delegates fire, and `quit()` really returns from `run()` (`test/runloop.ts:139`, `161-164`, `195-199`). I did not run `bun test` here — it opens real windows — so those are the assertions, not my measurements.

`test/all.ts:9-23` runs 13 suites, each in its own process, because "NSApplication is a per-process singleton whose state (menu bar, key window, activation) leaks between suites" (`test/all.ts:1-5`). CI is `macos-26` on Bun canary, and runs the suites with `NSZombieEnabled=YES MallocScribble=1` as an over-release check (`.github/workflows/ci.yml:14`, `46`).

---

## 6. Probes: what `bun:ffi` alone can actually do

DESIGN.md calls two things the largest open risks: driving libffi without a compiled shim, and runtime-created delegates. I tested both on this machine (macOS 27.0.1, Bun 1.4.4, arm64) with throwaway scripts under `research/bunkit/probe/`. Every probe ends in `process.exit(0)`; none opens a window.

### 6.1 libffi is reachable, and a JS-owned `ffi_cif` works

`/usr/lib/libffi.dylib` dlopens from `bun:ffi` and resolves `ffi_prep_cif`, `ffi_call`, `ffi_closure_alloc`, `ffi_prep_closure_loc`, `ffi_closure_free` (`probe/probe18.ts`). Note `ffi_prep_closure` (the non-`_loc` form) is **not** exported.

With the cif as a JS `Uint8Array` and the `ffi_type*` array as a JS `BigUint64Array`, all three call shapes work:

```
prep(strlen) 0
strlen -> 10 (expected 9 )
prep(labs) 0
labs(-5) -> 5
prep(-frame) 0 struct size 32 align 8
NSView 0x10ab6aab0
libffi -frame {"x":0,"y":0,"w":0,"h":0}
bunkit -frame {"x":0,"y":0,"width":0,"height":0}
```

(`probe/probe14.ts`, re-run to produce this block; `probe/probe15.ts` prints the same `-frame` pair. The `strlen` off-by-one is the trailing newline I wrote, not a bug, and a fresh `NSView` has a zero frame — so two independent paths agreeing is the point, not the values.)

The one trap that cost several iterations: **`ffi_call`'s `avalue` is `void **`, so each entry must be the *address of* the argument, not the argument.** Passing the value directly segfaults at exactly that value:

```
prep(labs) rc 0
calling labs(-5) with avalue[0] = 5 (wrong) ...
panic(main thread): Segmentation fault at address 0x5
```

(`probe/probe52.ts`, written to reproduce it deliberately after an earlier scratch probe was overwritten.) The crash address *is* the argument you passed, which makes the mistake easy to recognise. This is the bug the shim exists to hide.

### 6.2 Structs: argument and return, both built in JS

`ffi_type` for `CGRect` synthesised in a `BigUint64Array` as `{size=0, align=0, type=FFI_TYPE_STRUCT(13), elements=[double,double,double,double,NULL]}` — libffi patches in `size=32, align=8` during `ffi_prep_cif` (`probe/probe15.ts` prints `prep(-[NSView frame]) rc 0 size 32 align 8`).

- **Struct return**: `-[NSView frame]` through a JS cif matched bunkit's own dispatcher (`probe/probe15.ts`, re-run: `libffi -[NSView frame] {"x":0,"y":0,"w":0,"h":0}` against `bunkit -[NSView frame] {"x":0,"y":0,"width":0,"height":0}` on a fresh view — same four zeroes, different field names because bunkit's `structs.ts` table names them).
- **Struct argument**: `-[NSView setFrame:]` with `{10,20,300,150}`, then `-frame` read back through bunkit gives `{"x":10,"y":20,"width":300,"height":150}` and the probe prints "struct ARG round-trip WORKS" (`probe/probe17.ts`, re-run).

**This contradicts DESIGN.md §2 constraint 2 as written.** That section says struct arguments and returns "are where a hand-declared ladder breaks" and that "without libffi the mitigation is to never pass or return a struct". But libffi *is* available without an artifact, and structs are the case it handles best. The struct risk is real only for a hand-declared fixed-arity ladder — which is the approach DESIGN.md should not take.

**It also contradicts a claim another crust lane posted to the shared board** ("structs cannot cross `bun:ffi` in either direction on Bun 1.4.4"). Either that lane's probe had a different bug — the `avalue`-is-a-pointer rule (`probe52`), a `ffi_type` whose `elements` array was collected, or a `cif` in a `Uint8Array` that got GC'd (`probe48` vs `probe49`) — or it tested a struct baked into the *declared* `dlopen` signature, which `FFIType` genuinely cannot express (`probe53`: no struct tag). What is *not* possible is declaring a struct in a `dlopen`/`JSCallback` signature; building one as raw bytes and calling `ffi_call` yourself is a different path, and that path works. Reproduce in one command: `bun probe/probe17.ts` from `research/bunkit/`.

### 6.3 Fixed-arity `objc_msgSend` and float arguments

DESIGN.md §2 constraint 1 says the signature ladder "fails on float arguments and struct returns". Measured:

- `-[NSNumber numberWithDouble:]` through `objc_msgSend` declared `(ptr, ptr, f64) -> ptr`, then `-doubleValue` → `3.5` (`probe/probe23.ts` case `(c)`).
- An IMP declared `(ptr, ptr, f64) -> f64` computing `x * 2` returned `9` for `4.5` (`probe/probe40.ts`).

So on arm64 a fixed prototype does carry a `double` argument and return correctly. The float failure mode DESIGN.md warns about did not reproduce.

### 6.4 Delegates: a `JSCallback` works as an IMP directly

```
class_addMethod(d@:d) rc 1 (1 = added)
scale:(4.5) -> 9
JS throw inside an IMP: surfaced as Error: deliberate JS throw inside an IMP
process alive after the throw
-(void)probe: sender 0x10ab859c0
-(void)probe: added 1 invocations 1
```

(`probe/probe40.ts`, re-run; the pointer values differ per run.) `objc_allocateClassPair` + `class_addMethod` with `new JSCallback(...).ptr` as the IMP works, the callback receives `self`/`_cmd`/arguments, a `double` argument and `double` return survive, and a JS exception thrown inside an IMP surfaces to the caller and does not kill the process.

What a `JSCallback` cannot express is a **struct return or struct argument** — `FFIType` has no aggregate tag. `Object.keys(FFIType)` is 60-odd scalars, pointers and callback forms plus the numeric aliases `0`–`17` that mirror libffi's `FFI_TYPE_*` constants; it contains no `struct`, `union` or `array` tag (`probe/probe53.ts`: `has struct tag: false`). `FFIType[13]` exists as the `FFI_TYPE_STRUCT` *number* but a tag is not a descriptor — there is nowhere to put the element list. For those, the closure route works.

### 6.5 Closures: `ffi_closure_alloc` + `ffi_prep_closure_loc` + a `JSCallback` handler

All five symbols must be declared in **one** `dlopen` — bun caches a handle per path, and a second `dlopen` of the same dylib returns the *first* handle's symbol set (`probe/probe20.ts`: "second dlopen exposes only ffi_closure_alloc => first handle wins: yes"). This is a real bun:ffi behaviour worth recording.

A closure only works when the `JSCallback`'s declared signature is libffi's own `void (*)(ffi_cif*, void*, void**, void*)`. A two-`i64` callback handed to `ffi_prep_closure_loc` runs but produces garbage (`probe/probe14.ts`: "JS callback saw 4841659826688 6126224848", result `20` instead of `42`) — that was my first mistake, not a limitation. With the right signature:

```
prep 0
prep_loc 0
handler: cif 3228260467008 ret 6167035904 argsPtr 6167035488 user
  args[0] bytes c0 7f 95 6f 01 00 00 00
  av[0] 6167035840 av[1] 6167035848
  x 20 y 22
result 42
```

(`probe/probe22.ts`, re-run to produce this block: the handler reads `args` as a `BigUint64Array` over `void**`, dereferences each into an 8-byte view, and writes the return buffer through `toArrayBuffer`.)

**And the whole point**: a JS-built closure can be installed as an Obj-C IMP with a struct return.

```
prep(-(CGRect)probeRect:) rc 0 struct size 32
closure for IMP: alloc 0x74d7008480 code 0x109c50000 prep rc 0
class_addMethod with a JS-built closure IMP rc 1
  handler: self 0x16b87bf20 sender 0x16b87bf30
-[instance probeRect:] -> {"x":1,"y":2,"w":3,"h":4} handler calls 1
```

(`probe/probe44.ts`.) So a delegate method returning `CGRect` needs no compiled code either.

### 6.6 `toArrayBuffer` is write-through, so JS can write native memory

This is the claim in DESIGN.md §2 constraint 1 I most expected to be a wall: "`bun:ffi`'s `toArrayBuffer` copies rather than views, so there is no obvious write primitive from JavaScript."

Measured: it is a **view**, and a write through it is visible in the original buffer.

```
toArrayBuffer copy? NO (it is a view)
same ArrayBuffer as source? no
write through a copy visible in the source buffer? yes
```
```
native byte after JS write: AB len via strlen =
strlen(native) = 2 => JS write reached native memory
```

(`probe/probe41.ts` for the first block, `probe/probe44.ts` for the second, both re-run.) The nuance is the middle line: bun hands back a *new* `ArrayBuffer` object that aliases the same native bytes, so identity comparison fails while writes still land. `new Uint8Array(toArrayBuffer(addr, 0, n))` aliases the target, and `strlen` on a 32-byte `calloc`'d block into which JS wrote `"AB\0"` returns 2.

That means an `ffi_cif` can live in a JS `Uint8Array`, and so can the `ffi_type` graph — provided both stay reachable, which the `KEEP_ALIVE` pattern in `src/objc.ts:1027-1028` already demonstrates for the callback.

### 6.7 Blocks from JS

A global block synthesised in JS works — but only with the right field order. `struct BRBlock` on arm64 is `{isa; int flags; int reserved; invoke; descriptor;}`: `flags` and `reserved` pack into **one** 8-byte slot, so `invoke` is at +16 and the descriptor at +24, `size` 40 (`native/src/closures.m:166-173` is bunkit's own copy of that layout). With that layout, `sortUsingComparator:` invokes the JS handler:

```
block 0x4aa1d41c130
block2 0x4aa1d41c160
sorting with block (flags<<31)
  hits 3
sorting with block2 (flags<<30)
  hits 2
```

(`probe/probe37.ts`, re-run.) Two honest notes on that output. First, the probe built *two* blocks to test the flag question, and **both invoked the handler** — so what is proven is the field *order*, not that `flags` must be `1<<30`; Foundation did not reject the nonsense `1<<31` variant. Bunkit's value is `BR_BLOCK_HAS_SIGNATURE = 1u<<30` with `reserved = 0` (`closures.m:157`, `192-193`), which is the correct flag by the ABI, so copy that. Second, an interactive test cannot tell "flags and reserved share a slot" from "flags was read correctly anyway"; the packing follows from the C struct, and the offsets that matter (`invoke` +16, `descriptor` +24) are what the hits confirm.

Getting this wrong segfaults inside Foundation, which is what a string of earlier attempts did (`probe26.ts`–`probe31.ts`), and a `Block_copy`/`Block_release` pair would not dlopen as named (`probe/probe36.ts` — the symbols are `_Block_copy`/`_Block_release`; `lib.br_dlsym` finds `ffi_closure_alloc` fine, so this is a bun:ffi symbol-name issue, not a missing API).

Bunkit's own block on the same selector works first try (`probe/probe30.ts`: "bunkit comparator invocations 2").

### 6.8 Cost: the dylib is *not* the fast path

Same selector, same machine, 200 000 iterations after 5 000 warm-up:

```
bun:ffi + libffi, zero JS alloc: 59 ns/call
bunkit dylib, cached pool slot:  171 ns/call
```

(`probe/probe43.ts`, re-run for this figure; an earlier run of the same probe read 66 and 160, so treat the ratio as ~2.5–3× and the absolute numbers as machine-dependent.) The compiled bridge is ~2.9× **slower** per `objc_msgSend` than libffi driven directly from `bun:ffi`, because bunkit's path crosses into the dylib, does `alloca`, and copies. This is n=1 on one machine and one selector, but it is the opposite of the assumption that the artifact buys speed.

### 6.9 What did *not* work

- **`Bun`'s TinyCC is not present in 1.4.4.** `typeof globalThis.cc === "undefined"`, and no `Bun` key matches `/c/i` (`probe/probe45.ts`). DESIGN.md's `cc()` escape hatch does not exist on this machine.
- **`/usr/lib/libffi-trampolines.dylib` is not the closure library.** `file` calls it a universal binary with `x86_64`, `arm64e` and `arm64e.x1` slices, and `nm -gU` shows one exported symbol per non-x86 slice, `_ffi_closure_trampoline_table_page`; `dlopen`ing it for `ffi_closure_alloc` fails `Symbol "ffi_closure_alloc" not found` (`probe/probe19.ts`). The closure entry points are in `libffi.dylib`, which is inside the dyld shared cache — no file on disk, so `nm` there prints nothing and only a `dlopen` at runtime shows the surface: `ffi_prep_closure_loc`, `ffi_prep_cif`, **`ffi_prep_cif_var`**, `ffi_call`, `ffi_type_void`, `ffi_get_struct_offsets`, and no `ffi_prep_closure` (`probe/probe18.ts`). `ffi_prep_cif_var` matters: it is the variadic variant, so even a `...` call site is reachable without compiled code.
- **`ffi_prep_cif`'s arguments are easy to get wrong**, and getting them wrong segfaults: the signature is `(cif, abi, nargs, rtype, atypes)` and `rtype` comes *fourth* (`ffi.h:252-262`, `ffitarget_arm64.h:46-57`). Two of my probes crashed before I read the header.
- **A JS `Uint8Array` holding a cif must stay reachable.** `probe/probe48.ts` crashed with "Segmentation fault at address 0x0" until the backing bytes were retained; `probe/probe49.ts` shows the same call sequence succeeding once they are.

---

## 7. What crust must replicate

### 7.1 The minimum viable mechanism

Nothing in crust's design needs a compiled artifact. The five pieces, each measured above:

1. **A signature cache keyed on the encoding string.** `method_getTypeEncoding` → `ffi_prep_cif` once per distinct encoding, reusing the `ffi_cif` forever. bunkit's `br_sig_get` (`encoding.m:302-361`) is the reference; the JS side can own the `ffi_cif` bytes if it retains them.
2. **A type-encoding parser in JS**, not in C. bunkit parses natively because it needs `size`/`align` for the flat buffer layout. From `bun:ffi` you can parse in JS for the same reason, and the parser is ~90 lines (`objc.ts:51-116` is the text half; the size half is `encoding.m:88-115`). The two must agree on qualifiers (`rnNoORVA+|`) or a struct will mis-size.
3. **`ffi_call` with `avalue` pointing at each argument.** This is the one non-obvious rule, and getting it wrong is a segfault rather than a wrong answer. `ffi_cif` and `ffi_type` both live in JS memory that must stay reachable.
4. **Delegates as `JSCallback` IMPs for anything that is not a struct.** `objc_allocateClassPair` + `class_addMethod` with a `JSCallback` works for `void`/`BOOL`/`NSInteger`/`double`/object arguments and returns, including `windowShouldClose:` → `BOOL`. For struct-returning delegate methods, one libffi closure with the `JSCallback` handler from §6.5.
5. **A run loop pumped from JS.** crust's `CFRunLoopRunInMode` sketch is fine for waking up; the part to check in v1 is that bunkit's pump does more than idle — it calls `[NSApp sendEvent:]` itself (`runloop.m:87-99`), and a bare `CFRunLoopRunInMode` only runs whatever AppKit installed as run-loop observers. For a webview app the practical difference is dispatch: someone has to deliver `NSEvent`s to the responder chain, and in bunkit that someone is `br_pump`. Measured shape either way: pump in bounded slices, then yield to Bun.

### 7.2 The parts that genuinely need compiled code

One, and it is not on the critical path for v1:

- **Exception containment.** bunkit's `@try`/`@catch` around `ffi_call` (`dispatch.m:173-181`, `203-211`, `232-237`) converts an Obj-C exception into a `strdup`'d string plus `BR_ERR_EXCEPTION`; the pump does the same per event (`runloop.m:91-95`, `106-110`). From `bun:ffi` there is no way to catch an Obj-C exception: it crosses `objc_msgSend` as a native throw and unwinds through Bun's own frames. So **if crust wants "an Obj-C exception does not take down the process", it needs native code for the `@try`, or it accepts the crash risk.**
- **Variadic call sites do *not* need C**: `ffi_prep_cif_var` is exported (`probe/probe18.ts`), so a `...` callee is expressible from `bun:ffi` given explicit argument types.
- **Per-closure context does *not* need C**: `ffi_prep_closure_loc`'s fourth argument is `user_data`, passed straight to the handler. I passed `0n` in the probes; passing a token is the same call.
- **Nested-run-loop containment** is not a bridge problem at all. `runModal*` freezes JS because the nested loop never returns to `br_pump` — property of AppKit, and crust already rules out modal dialogs for v1.

Everything else bunkit does natively is a plain C function or a plain `objc/runtime.h` call that `bun:ffi` reaches: `br_nsstring` is `[[NSString alloc] initWithBytes:length:encoding:]` (`memory.m:69-79`); `br_retain` is `CFRetain` (`memory.m:9-12`); `br_dlsym` is `dlsym(RTLD_DEFAULT, name)` spelled `(void*)-2` (`dispatch.m:128-131`); `br_now` is `mach_absolute_time` scaled by `mach_timebase_info` (`runloop.m:133-138`); `br_object_set_token` is `objc_setAssociatedObject` with an `NSNumber` (`closures.m:30-41`).

### 7.3 Where DESIGN.md is wrong

Checked against the source and the probes:

1. **"bun:ffi's `toArrayBuffer` copies rather than views, so there is no obvious write primitive from JavaScript"** (DESIGN.md §2, constraint 1). Wrong: it is a view, and writes through it land in native memory (§6.6).
2. **"there is no `al`-style variadic register count, so a fixed prototype passing more pointer arguments than the callee reads behaves correctly"** (constraint 1). Correct for pointer arguments, and the float claim attached to it is wrong: `f64` arguments and returns survive a fixed prototype on arm64 (§6.3).
3. **"Without libffi the mitigation is to never pass or return a struct"** (constraint 2). The premise is wrong: libffi is reachable (§6.1) and structs are the case it handles best (§6.2). Crust can pass and return `CGRect` with no artifact.
4. **"Delegate handlers ... must not throw across the FFI boundary"** (§3). Partly wrong: a JS throw inside a `JSCallback` IMP surfaces as a JS error and the process survives (§6.4). bunkit still guards it (`objc.ts:1019-1022`), but the failure mode is not instant death.
5. **"It has a small compiled bridge over libffi, and so it violates crust's no-native-artifact rule"** (§2, Prior art). The premise is right and the conclusion is not: the bridge is 84 KB and 54 symbols, and every one of those symbols is a thin wrapper over a symbol crust can `dlsym` itself (§7.2).
6. **"`cc()`. Bun embeds TinyCC and compiles C supplied at runtime"** (constraint 1, third escape). Not on this machine: Bun 1.4.4 exposes no `cc` global — `typeof globalThis.cc === "undefined"`, and no `Bun` key matches `/c/i` (`probe/probe45.ts`). Other crust lanes report a `cc()` that compiles a shipped `.c`, links `-framework AppKit` and runs end to end, so DESIGN.md's claim is right *somewhere* and simply not reachable from this Bun build; treat it as version-dependent and re-check with `typeof cc` before relying on it.
7. **Prior art facts.** BunKit is not "one contributor": `hiett` has 27 commits, `alii` has 1 (`gh api repos/scarletindustries/bunkit/contributors`). 8 stars, Apache-2.0, last push 2026-11-11, and `private: true` — so "no npm package" is right in substance (npm's `bunkit` is an unrelated 2025 package), but the name is taken.
8. **"its API is `new Application()`, `new Window(...)`, `await app.run()`"** (§2, Prior art). Right, and the implementation is `src/ui/app.ts:76-80`, which calls `run(this.options)` then `process.exit(0)` unless `exitOnQuit === false`.
9. **The run loop sketch** (DESIGN.md §3): `setInterval(() => CFRunLoopRunInMode(...), 4)`. Workable, but bunkit's measured choice is the opposite — `Bun.sleep` in the idle path, `nextEventMatchingMask:` for the pump, with no `CFRunLoopRunInMode` anywhere in the tree and no interval in library code (the only `setInterval`s are `examples/demo.ts:240,245` and `test/runloop.ts:80`) — see `runtime.ts:187-200` and `runloop.m:87-99`. The 4 ms interval also puts `updateWindows`-equivalent work on a fixed cadence; bunkit gates it (`runloop.m:104-111`).
10. **"Never add a `runModal*` call to `src/ui/`"** (`CLAUDE.md:34-35`). The tree itself calls `-runModal` twice, in `src/ui/dialogs.ts:73,196`, both as the documented "no window to attach to" fallback. So the rule as written is stricter than the code; the real rule is that it must not be the normal path.

### 7.4 The three things to copy verbatim

- **`KEEP_ALIVE` for the callback** (`src/objc.ts:1027-1028`). If the `JSCallback` is collected, AppKit jumps into freed memory. Nothing about that is obvious from the API.
- **WeakRef handler tables with a finalizer recycling the token** (`src/objc.ts:939-955`, `1164-1175`). The strong-reference version leaks every window. `CLAUDE.md:42-43` says to run `test/soak.ts` after touching delegate code for exactly this reason.
- **Pointers are `bigint` end to end** (`src/bridge.ts:7-11`, `CLAUDE.md:32-33`). A tagged pointer as a `number` is silently wrong.

### 7.5 What crust does *not* need to copy

- **The dylib.** 84 KB of wrappers over symbols that are already on the process.
- **The `sigLayout` int32 export.** The reason bunkit exports a flat layout is that its `ffi_call` happens natively, so the native side needs offsets. From JS, the offsets are whatever JS computed.
- **The `methodSlots` token table**, if crust keeps a per-delegate JS object and passes the `JSCallback`'s own identity through `user_data`. bunkit's token exists because one callback serves every trampoline; that is a design choice, not a constraint.
- **The `structs.ts` hand-written field table.** Crust needs `CGRect`, `NSSize`, `NSRange` and `NSPoint` for a webview — about 30 lines — not AppKit's full geometry surface.

### 7.6 What their native layer does that a `.c` compiled by `cc()` could not

Short answer: **nothing, and the artifact is the least capable of the three options.** Walking the exported surface against what plain C gets you:

| what `bridge.h` exposes | needs anything C cannot do? |
|---|---|
| introspection (`dispatch.m:17-126`) | no — every one is an `objc/runtime.h` call: `objc_lookUpClass`, `sel_registerName`, `class_getInstanceMethod`, `method_getTypeEncoding`, `protocol_getMethodDescription`, `class_copyMethodList`, `objc_copyClassList` |
| layout export (`encoding.m:367-396`) | no — the parser is C over `ffi_type` structs, and `ffi_type` is a plain struct |
| dispatch (`dispatch.m:155-239`) | **yes, for `@try`** — `ffi_call` itself is C, but catching an Obj-C exception around it is Obj-C syntax (`.m`), not C |
| runtime classes (`closures.m:113-149`) | no — `objc_allocateClassPair`, `class_addMethod`, `class_addProtocol`, `objc_registerClassPair`, `objc_setAssociatedObject` |
| blocks (`closures.m:177-212`) | no — `extern void* _NSConcreteGlobalBlock[32]` and a hand-built struct is ordinary C |
| memory (`memory.m`) | no — `CFRetain`, `CFRelease`, `-autorelease`, `NSAutoreleasePool`, `free` |
| strings (`memory.m:69-94`) | no — `initWithBytes:length:encoding:` |
| run loop (`runloop.m:79-143`) | **yes, for `@try` around `sendEvent:`**, and for `@interface BRAppDelegate` — both are Obj-C source |
| `br_dlsym`, `br_now`, `br_bundle_path` | no — `dlsym`, `mach_absolute_time`, `[[NSBundle mainBundle] bundlePath]` |

So the honest comparison is not "artifact versus no artifact" but **three ways to get the same two Obj-C facilities**:

1. **A prebuilt dylib** (bunkit's choice). What it actually buys: a permanently stable C surface, so supporting a new AppKit class never recompiles anything (`bridge.h:3-5`), and no toolchain at runtime. What it costs: 84 KB and 54 exported wrappers, an arm64-only ABI promise (`CLAUDE.md:27-30`), a build step that must run before `dlopen` or the module fails on a missing symbol (`CLAUDE.md:22-23`), and it measured ~2.9× *slower* per `objc_msgSend` than libffi driven from JS (§6.8).
2. **A shipped `.c`/`.m` compiled by `cc()` at runtime** — the option the other crust lanes established. It covers 100% of the table above, including the `@try` rows if the file is compiled as Obj-C, and it removes the build step and the ABI promise entirely. The only cost is the compile itself, once, and a toolchain dependency where bunkit's dylib has none.
3. **Pure `bun:ffi` + libffi** — covers every row except the two `@try` rows, and is the fastest of the three (§6.8).

The specific conclusion for crust: **do not port bunkit's split.** The encoding parser, the `ffi_type` graph, the flat-layout export and the `sigLayout` int32 protocol exist only because bunkit's `ffi_call` lives behind a C ABI boundary in another translation unit. If crust compiles anything at all, it should compile the *smallest* possible unit — an `@try`-wrapped `objc_msgSend` (and, if it pumps, an `@try`-wrapped `sendEvent:` + `nextEventMatchingMask:`) — and keep the parser, the type graph and the buffer pool in TypeScript, where they need no ABI at all and no `ffi_type` is ever `calloc`'d.

One open question for whoever owns the `cc()` lane: whether their compile step accepts Obj-C source. Plain C cannot contain `@try`, and `@try` is the only row in that table that pure C cannot serve — so if `cc()` only takes `.c`, crust still needs `bun:ffi` for everything and a *separate* answer for exception containment (or it accepts that an AppKit exception kills the process).

---

## 8. Provenance

- Source: `research/bunkit/repo` at `3c95a36f57f6237c49ab27d22483d8e6e0a4d85b` (2026-09-21).
- Probes: `research/bunkit/probe/probe*.ts`, all self-terminating, none opening a window. The load-bearing ones: `probe14` (cif + `ffi_call` for a scalar, a pointer and a struct return), `probe15` (struct return, JS cif vs bunkit), `probe17` (struct argument round-trip), `probe18` (which libffi symbols exist), `probe19` (trampolines dylib is not the closure library), `probe20` (one `dlopen` per path — bun's handle cache), `probe22` (closure with the correct `(cif, ret, args, user)` handler), `probe37` (JS-built global block), `probe40` (`JSCallback` as IMP, `double` args, throw containment), `probe41`/`probe44` (`toArrayBuffer` is a view; closure IMP with a `CGRect` return), `probe43` (ns/call), `probe45` (`typeof cc`), `probe52` (the `avalue` segfault, on purpose).
- Four probes were repaired while verifying this document: `probe14`, `probe15` and `probe17` each did a *second* `dlopen` of `/usr/lib/libffi.dylib` (or of the trampolines dylib) and therefore saw no closure symbols, and `probe52` was written to reproduce the `avalue` crash after an earlier scratch probe had been overwritten. Every figure quoted above was re-produced by the probe named beside it on 2026-11-12 after those repairs.
- Upstream facts: `gh api repos/scarletindustries/bunkit`, `gh api repos/scarletindustries/bunkit/contributors`, `curl https://registry.npmjs.org/bunkit`.
- SDK headers: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/ffi/{ffi.h,ffitarget_arm64.h}`.