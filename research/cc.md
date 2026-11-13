# Is Bun's `cc()` a viable artifact-free bridge for crust?

Probe report. Measured on this machine: Bun **1.4.4** (`38afee6c84fcf48c0edb2466aa4b27d287a59c30`), macOS 27, arm64, Apple clang 21.0.0.

**Verdict: YES.** `cc()` compiles and runs Objective-C, links AppKit and Foundation, calls `objc_msgSend` end to end, and leaves no artifact on disk. No Xcode, no Command Line Tools, and no compiler on `PATH` is needed at runtime. It is a viable stand-in for a compiled bridge.

It is **not** a free pass on the signature ladder. That becomes mandatory, for a reason DESIGN.md does not state: the *plain variadic* `objc_msgSend` declaration compiles and returns garbage.

---

## 0. Fact-checks against the brief

| Brief claim | Finding |
|---|---|
| "with no Xcode on the user's machine" | **Wrong.** Xcode 27.2 is installed at `/Applications/Xcode.app` and `xcode-select -p` points at it. Command Line Tools are also present (`com.apple.pkg.CLTools_Executables` [IP_ADDRESS]). Neither is needed — see 7 — so the verdict is unaffected, but the premise was false. |
| "Bun embeds TinyCC" | **Correct in effect.** `cc` is a native export of `bun:ffi`; its JS wrapper is quoted in 1. |
| "`cc()` compiles C supplied at runtime" | **Mostly right, one correction:** `source` is a **file path** (or array of paths), never inline C text. The shim must ship as a `.c` file on disk, not a template literal. |
| DESIGN.md constraint 1: "On arm64 there is no `al`-style variadic register count, so a fixed prototype passing more pointer arguments than the callee reads behaves correctly" | **Right in outcome, wrong in mechanism.** A fixed prototype works at every arity (verified 1–3 args). But the plain `objc_msgSend(...)` call *does not*, and this is measured, not theoretical: it returns values the callee never received. The ladder is load-bearing; the reason is the callee reading `x2` from a call that never filled it. |
| DESIGN.md escape 3: "compiles C supplied at runtime, so a shim can ship as source with no binary and no Xcode" | **Correct.** Confirmed with a restricted `PATH` (7). |

---

## 1. `cc()` compiles and calls — PASS

`bun:ffi` on 1.4.4 exports exactly:
`CFunction, CString, FFIType, JSCallback, cc, default, dlopen, linkSymbols, native, ptr, read, suffix, toArrayBuffer, toBuffer, viewSource`

`cc` takes **one** argument, an options object (`cc.length === 1`). With no argument it throws `Expected options to be an object`; with no `source` it throws `Expected source to be a string to a file path`.

```js
import { cc, FFIType } from "bun:ffi";

const lib = cc({
  source: "/abs/path/shim.c",           // file path or array of paths. NOT inline C.
  symbols: {                            // required, every exported name
    add:   { args: [FFIType.int, FFIType.int], returns: FFIType.int },
    greet: { args: [], returns: FFIType.cstring },
  },
  flags: ["-framework", "Foundation"],  // optional, see 4
});

lib.symbols.add(2, 3);   // 5
lib.symbols.greet();     // "hi" — cstring returns arrive as a JS string already
lib.close();             // frees the handle; calling a symbol afterwards throws
```

Measured: `add(2,3) === 5`, and a `#include`-heavy file's `hdr()` returned 15 (`malloc` + `memset` + `strlen`). `source: [a.c, b.c]` works and exports symbols from both.

**`FFIType` has no `long`.** Its keys are `bool, c_int, c_uint, char, char*, double, f32, f64, float, i16, i32, i64, i8, int, int16_t, int32_t, int64_t, int8_t, isize, u16, u32, u64, u8, uint16_t, uint32_t, uint64_t, uint8_t, usize, void*, ptr, pointer, void, cstring, i64_fast, u64_fast, function, callback, fn, napi_env, napi_value, buffer, buffer_length, buffer_bytelength`. Asking for `long` fails with `param must be a string (type name) or number` — use `i64`.

`u64`/`i64` returns arrive as **`BigInt`**: `1806466457n`, not `1806466457`. Comparing to a plain number silently fails (`41n !== 41`). Use `Number(...)`.

`ptr(0)` also throws `bun:ffi cannot convert argument to 'ptr'`; pass the literal `0` for NULL.

---

## 2. `#include` — system headers PASS, framework headers FAIL

One header per file, verified against the compiler's own error text:

**Resolved with no flags:** `stdlib.h`, `string.h`, `stdio.h`, `stdint.h`, `math.h`, `objc/message.h`, `objc/runtime.h`, `objc/objc.h`, `pthread.h`, `sys/stat.h`, `dirent.h`.

`<objc/runtime.h>` is genuinely usable, not merely found: a body calling `class_getName(0)` compiles.

**Not resolved, with or without flags:**

```
FAIL <Foundation/Foundation.h>       :: error: include file 'Foundation/Foundation.h' not found
FAIL <AppKit/AppKit.h>               :: error: include file 'AppKit/AppKit.h' not found
FAIL <CoreFoundation/CoreFoundation.h> :: error: include file 'CoreFoundation/CoreFoundation.h' not found
FAIL <CoreGraphics/CoreGraphics.h>   :: error: include file 'CoreGraphics/CoreGraphics.h' not found
```

`-I` is honoured, and a bogus `-I/nonexistent/path/xyz` is accepted silently, but `-I` does not rescue framework headers:

```
FAIL -I <sdk>/System/Library/Frameworks/Foundation.framework/Headers
  :: error: include file 'Foundation/Foundation.h' not found
FAIL -I <sdk>/System/Library/Frameworks/           (trailing slash)
  :: error: include file 'Foundation/Foundation.h' not found
PASS absolute-path include, then
  :: Foundation.framework/Headers/Foundation.h:6: error: include file 'CoreFoundation/CoreFoundation.h' not found
PASS a flat dir with Foundation.h copied in, then
  :: fakeinc/Foundation.h:6: error: include file 'CoreFoundation/CoreFoundation.h' not found
```

The header files are all present and readable — the failure is TCC's preprocessor refusing the framework include mapping, not a missing path. `-iframework`/`-F` is not a TCC option:

```
FAIL flags: ["-F<sdk>/System/Library/Frameworks"]
  :: tcc: error: invalid option -- '-F/...'
```

There is no `/usr/include` on this system at all (`ls: /usr/include: No such file or directory`). TCC finds `stdio.h` through the SDK anyway, and it honours `SDKROOT`: with `SDKROOT=/nonexistent/sdk` the same file fails `include file 'stdio.h' not found`, while `SDKROOT=<either real SDK>` compiles.

**Consequence for crust:** hand-written `extern` prototypes are mandatory. No `#include <AppKit/AppKit.h>`, so no typed `[obj alloc]`, no `CGRect` from `CoreGraphics`. DESIGN.md already assumed this.

---

## 3. `objc_msgSend` — which of the three routes links and runs

**(a) `extern void *objc_msgSend(void *, void *, ...);` — COMPILES, links, but calls with arguments are WRONG. No error is raised.**

This is the most dangerous finding in the report. A runtime class with a known implementation (`one:` returns `a * 2`, records what it received):

```
send_fixed(inst, 41)     -> 82           callee saw: 41     <- correct
send_variadic(inst, 41)  -> 12271909488  callee saw: 12271909472  <- garbage
```

Same function, same class, same argument. The only difference is whether the call goes through a cast prototype or through `...`. Zero-argument sends (`alloc`, `init`, `class`, `description`) work through either form, because nothing needs to be passed.

The identical trap fires on a delegate IMP:

```
call_fixed(inst, 41)     -> 42              hit = 41
call_variadic(inst, 7)   -> 6167068105      hit = 6167068104
```

**This is the mechanism behind a failure mode that looks like success.** An earlier probe created a delegate class and got `1` back from `call_incr_on_class` — I initially recorded that as "the IMP did not fire". It did fire; the *argument* was wrong. A selector typo and a variadic call are indistinguishable from the outside, because both produce a plausible-looking pointer or small integer.

**(b) `#include <objc/message.h>` — the plain form is rejected outright.**

```
FAIL  #include <objc/message.h> + extern void *objc_msgSend(void *, void *, ...);
      :: objc_message_h.c:6: error: too many arguments to function

FAIL  #include <objc/message.h> + a different extern redefinition
      :: objc_e2e.c:6: error: incompatible types for redefinition of 'objc_msgSend'
```

On this SDK the header declares `objc_msgSend` as `void objc_msgSend(void)` unless `OBJC_OLD_DISPATCH_PROTOTYPES` is defined, so it is useless for real calls. What *does* compile is a local cast, which is exactly route (a):

```c
#include <objc/message.h>
void *send_description(void *self, void *sel) {
  return ((void *(*)(void *, void *))objc_msgSend)(self, sel);
}
```

The header buys nothing over (a). Skip it.

**(c) Passing `objc_msgSend`'s address in as a `void*` parameter — COMPILES AND RUNS.**

```c
typedef void *(*msgsend_fn)(void *self, void *sel, ...);
typedef void *(*getclass_fn)(const char *name);
typedef void *(*selreg_fn)(const char *name);

void *call_description(void *msgsend, void *getclass, void *selreg) {
  void *cls = ((getclass_fn)getclass)("NSObject");
  void *sel = ((selreg_fn)selreg)("description");
  return ((msgsend_fn)msgsend)(cls, sel);
}
```
Fed from JS by `dlopen("/usr/lib/libobjc.A.dylib", { objc_msgSend: {args:[ptr,ptr], returns:ptr} }).symbols.objc_msgSend` plus `objc_getClass` and `sel_registerName`. Works. It is functionally identical to (a); it just moves the symbol lookup to JS.

**On this system `/usr/lib/libobjc.A.dylib` and `/usr/lib/libobjc.dylib` are not files** — macOS 27 keeps them only in the dyld shared cache. `dlopen` resolves them by name anyway:

```
PASS dlopen /usr/lib/libobjc.A.dylib   (objc_getClass, sel_registerName)
PASS dlopen /usr/lib/libobjc.dylib     (objc_getClass)
PASS dlopen /usr/lib/libffi.dylib      (ffi_call)
```

Trap: an **empty** symbol map always fails with `Expected at least one symbol`, which reads like a missing library. It is not — supply one real symbol and it resolves.

**Verdict: all three link. Only (a) with fixed prototypes and (c) run correctly.** (c) is redundant with (a).

---

## 4. Framework linking — PASS, and load-bearing

The option is **`flags`** (array of strings). Every other plausible name is accepted **silently and ignored** — `cflags`, `args`, `options`, `defines`, `libraries`, `libs`, `frameworks`, `include`, `includes`, `I`, `L`, `l`, `link`, and even `bogusOption: true`. There is **no validation of unknown keys**, so a typo looks like success.

Distinguishing the real one from the inert ones, with a `#ifdef CRUST_EXTRA` probe:

```
PASS flags: ["-DCRUST_EXTRA"]   -> with_extra() = 1   <- honoured
PASS defines: ["CRUST_EXTRA"]   -> with_extra() = 0   <- ignored
PASS D: ["CRUST_EXTRA"]         -> with_extra() = 0   <- ignored
PASS libraries: [...], libs: [...], frameworks: [...], include: [...], link: [...]
                                -> all ignored
FAIL define: ["CRUST_EXTRA"]    :: define_probe.c: error: invalid macro name '0'
```

Framework link, proven with a Foundation **function** (`NSHomeDirectory`), which cannot resolve unless Foundation is actually linked:

```
FAIL no link flags :: tcc: error: unresolved reference to '_NSHomeDirectory'
PASS flags: ["-framework", "Foundation"]   -> homedir_len() = 5, first byte 47 ('/')
PASS flags: ["-lFoundation"]               -> same
FAIL flags: ["-framework","Foundation","-F<sdk>/System/Library/Frameworks"]
     :: tcc: error: invalid option -- '-F/...'
```

`-framework <Name>` is the form. `-F` is rejected. For crust: `flags: ["-framework", "AppKit", "-framework", "Foundation"]`.

An AppKit-only symbol proves AppKit really links:

```
FAIL appkit symbol, no flags         :: tcc: error: unresolved reference to '_NSApp'
PASS appkit symbol, -framework AppKit
```

**Struct returns: they work, but only by declaring them `ptr`.** `CGRect make_rect(...)` declared as `returns: FFIType.ptr`, with `rect_width` taking `args: [FFIType.ptr]`:

```
PASS make_rect -> 6167166448, rect_width -> 3, make_size -> 6167166496, sum_squares(3,4) -> 25
```

TCC returns a 32-byte struct through the x8 indirect-result pointer, so `ptr` carries a valid address. Correct answers, but the values are only reachable by reinterpreting memory — `bun:ffi` has no struct type. This is the same "avoid structs" advice DESIGN.md gives, arriving by another route: **TCC handles structs; `bun:ffi` cannot describe them.**

---

## 5. End-to-end — PASS

Exact working source (`c/e2e_steps.c`), no `objc/*` includes:

```c
extern void *objc_msgSend(void *self, void *sel, ...);
extern void *objc_getClass(const char *name);
extern void *sel_registerName(const char *name);
extern const char *NSHomeDirectory(void);

int objc_strlen(const char *s) { int n = 0; while (s[n]) n++; return n; }

int description_len(void) {
  void *c = (void *)objc_getClass("NSObject");
  void *o = objc_msgSend(c, sel_registerName("alloc"));
  if (!o) return -1;
  o = objc_msgSend(o, sel_registerName("init"));
  if (!o) return -2;
  void *d = objc_msgSend(o, sel_registerName("description"));
  if (!d) return -3;
  const char *p = (const char *)objc_msgSend(d, sel_registerName("UTF8String"));
  if (!p) return -4;
  return objc_strlen(p);
}
```

With `flags: ["-framework", "Foundation"]`:

```
PASS description_len() -> 23
PASS homedir_len()     -> 5
PASS class_returns_self() -> 1
```

**Foundation must be linked, not merely dlopened.** In a bare Bun process:

```
objc_getClass(NSObject)      = 8205007984
objc_getClass(NSString)      = null
objc_getClass(NSApplication) = null
objc_getClass(NSWindow)      = null
objc_msgSend(init, "description") = null
```

`NSObject` resolves because Bun itself links libobjc. `NSString` does not, because Foundation is not loaded. `-framework Foundation` fixes all of them. This is the operationally dangerous fact for crust: **without a framework link, `objc_msgSend` "works" and returns NULL, which reads as a selector typo rather than a missing library.**

**Runtime class creation + `class_addMethod` works**, with the right symbol name:

```
PASS make_delegate_class() -> 4394977280   (a real class pointer)
PASS call_fixed(inst, 41)  -> 42   hit = 41
```

`objc_addMethod` does **not** exist on this system (`Symbol "objc_addMethod" not found in "/usr/lib/libobjc.A.dylib"`). The real one is `class_addMethod`. Signature: `int class_addMethod(void *cls, void *sel, void *imp, const char *types)`. A C function pointer can be the IMP, so a delegate is a runtime class whose methods are C functions.

**`JSCallback` crosses the other way**, which is what a delegate needs for the JS half:

```
PASS total(5) = 100   seen = 0,1,2,3,4
```

Declared `FFIType.function` for the callback parameter; constructed with `new JSCallback(fn, { args: [FFIType.int, FFIType.ptr], returns: FFIType.int })`; passed as the plain number `0` for a NULL user pointer.

**`cc()`-compiled code cannot take a JS string argument.** Passing `"hello"` throws `a JavaScript string is not valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray`. Use `ptr(new TextEncoder().encode("hello"))`, or declare the parameter a pointer. Return values in the other direction are fine — `returns: FFIType.cstring` yields a JS string.

---

## 6. Compile latency — measured

Same small source, six compiles in one process:

```
run#0 8.196ms   run#1 0.323ms   run#2 0.261ms
run#3 0.246ms   run#4 0.241ms   run#5 0.235ms
```

Cold, fresh process, eight separate `bun` launches:

```
#1 7.897   #2 7.645   #3 6.416   #4 5.880
#5 5.967   #6 6.331   #7 6.267   #8 5.992   (ms)
```

Objective-C externs + `-framework Foundation`, cold: **2.1–3.4 ms** (3.402, 2.732, 2.436, 2.186, 2.437, 2.483, 2.386, 2.426).

So: **~6–8 ms for a trivial file's first compile, ~2–3.5 ms for an objc + Foundation file, ~0.24 ms for repeats.** TCC caches per source path in-process, hence the ~30x drop after run#0. The cache is per-process, so it is paid **on every app launch** — 6–8 ms against Bun's own startup is not a launch-latency risk.

**No artifact reaches disk.** In an isolated `TMPDIR` containing one `.c` file, after a compile the directory held only the original `.c` plus TCC's own header copies (`stdalign.h`, `stdarg.h`, `stdbool.h`, `stddef.h`, `stdnoreturn.h`, `tgmath.h`, `varargs.h`, `node/node_api.h`, …). No `.dylib`, no `.so`, no `.node`. The `.bun-501-*.dylib` files visible in the system `TMPDIR` are Bun's own plugin cache, unrelated to `cc()`, and `close()` does not touch them. `close()` does invalidate the handle: calling a symbol afterwards throws `bun:ffi: cannot call 'a' because its library was closed`.

---

## 7. Xcode / Command Line Tools — neither is required

`cc()` invokes **no compiler binary**. Measured with `env -i HOME=$HOME PATH=<a dir containing only bun>`:

```
run#0: 1.767ms (compute(21)=42)
objc+Foundation compile: 2.994ms (description_len=23)
```

Every compile succeeded with no `cc`, `clang`, `xcrun` or `xcodebuild` on `PATH`. `SDKROOT` is honoured for *header search* only — a bogus `SDKROOT` breaks `<stdio.h>`, and either real SDK works — so an SDK must be present for `#include`, but nothing is executed from it.

`DEVELOPER_DIR` makes no difference (both CLT and Xcode values compile).

For a shipped `.app`: **nothing needs installing.** crust ships a `.c` file and Bun compiles it at runtime. Headers resolve against whatever SDK the machine has; if a target machine had no SDK at all, the `extern`-only shim would still compile, since every probe's objc declarations are `extern` and only the trivial probes include `<stdlib.h>`.

On **this** machine Xcode 27.2 and CLT are both installed, contrary to the brief.

---

## 8. Bottom line for crust

**`cc()` is a viable artifact-free bridge.** A `.c` file shipped as source replaces the compiled shim. It compiles in 2–8 ms per launch, links AppKit and Foundation via `flags`, runs real Objective-C through `objc_msgSend`, creates runtime classes, and writes no binary to disk.

Three rules it forces, none fatal:

1. **Every `objc_msgSend` call site is a fixed prototype.** A plain variadic declaration compiles and returns garbage with no diagnostic. The failure looks like a selector typo or a dead delegate, which is exactly the wrong conclusion to reach. DESIGN.md's signature ladder is load-bearing, but not for the reason it gives.
2. **No Foundation/AppKit headers.** `#include <objc/runtime.h>` is fine; `#include <AppKit/AppKit.h>` is not, and no `-I` or `-F` rescues it. Every symbol is a hand-written `extern` with a `void *`.
3. **Frameworks must be linked by name.** `objc_getClass("NSString") === null` in a bare process is the tell; `flags: ["-framework", "Foundation"]` is the fix.

What it does not solve: struct arguments and returns cannot be described to `bun:ffi` (they can be smuggled as `ptr` and reinterpreted), and none of it is type-checked.

---

## 9. Files

Every probe and C source, in this directory. Each ends in `process.exit(...)` or `exit 0`.

**Verdict run (all claims in one pass, 11 pass / 0 fail):** `probe28-verdict.ts`

**API shape:** `probe00-shape.ts` (exports, `cc` source, arity), `probe02-cc-source.ts`, `probe08-ffitype.ts` (`FFIType` keys), `probe31-close.ts` (`close()` semantics, source arrays), `probe32-artifact.sh` + an isolated-`TMPDIR` run (no artifact on disk)

**Compile + headers:** `probe01-env.sh` (toolchain), `probe05b-cc-matrix.ts`, `probe09-defines.ts` (which options are real), `probe19-headers.ts` (header matrix), `probe20-fw-headers.ts`, `probe21-include-why.ts`, `probe30-sdk.sh` (`SDKROOT`/`DEVELOPER_DIR`)

**objc:** `probe03-dlopen.ts`, `probe04-dlopen-syms.ts` (dyld cache, empty-symbol trap), `probe06-objc-deep.ts`, `probe10-e2e.ts`, `probe13-e2e-link.ts`, `probe15-framework-e2e.ts`, `probe23-verbose-appkit-struct.ts` (AppKit link, struct returns), `probe26-variadic.ts`, `probe27-ladder.ts` (the variadic trap), `probe29-delegate-impl.ts` (delegate IMP fires)

**Foundation loading:** `probe14-foundation-loaded.ts`, `probe16-load-foundation.ts`

**Delegates + callbacks:** `probe24-callback-delegate.ts`, `probe25-delegate.ts`

**Latency:** `probe17-latency.ts`, `probe18-cold.sh`

**No toolchain:** `probe22-no-toolchain.sh`

**C sources:** `c/e2e_steps.c` (the end-to-end proof), `c/framework_e2e.c`, `c/basic.c`, `c/headers.c`, `c/headers_io.c`, `c/hdr_all.c`, `c/objc_extern.c`, `c/objc_message_h.c`, `c/objc_message_typed.c`, `c/objc_ptrparam.c`, `c/objc_e2e.c`, `c/e2e_no_message_h.c`, `c/define_probe.c`, `c/flags_probe.c`, `c/framework_link.c`, `c/appkit_include.c`, `c/appkit_symbol_ref.c`, `c/foundation_include.c`, `c/plain.c`