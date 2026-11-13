# Can libffi be driven from `bun:ffi` alone?

Probe report. Measured on Bun **1.4.4** (`38afee6c84fcf48c0edb2466aa4b27d287a59c30`), macOS 27.0.1, arm64 (Apple silicon), against `/usr/lib/libffi.dylib` as shipped by the OS. No `.c` file, no headers, no compiler, no build step, no artifact on disk.

**Verdict: YES.** libffi is fully drivable from `bun:ffi`. Cif, argument array and type descriptors are all built in native memory with `malloc`/`memcpy`; `ffi_call` runs C functions and Objective-C methods; `ffi_prep_closure_loc` gives an IMP that calls back into JavaScript with correct arguments. 34 checks pass across `probe.ts` (22) and `limits.ts` (12), and `probe.ts` also passes inside a `bun build --compile --trim --minify` binary.

It is **not** the simpler route, and it does not remove the signature ladder — it moves it. Details in 12–14.

```
bun /Users/jyz/dev/crust/research/libffi/probe.ts     # 22 checks: the verdict
bun /Users/jyz/dev/crust/research/libffi/limits.ts    # 12 checks: malloc/free, 1 KB writes, cif size, pointers, floats
bun /Users/jyz/dev/crust/research/libffi/crashes.ts   # 5 failure modes, each in a child process
bun /Users/jyz/dev/crust/research/libffi/micro.ts     # per-call cost, median of 5 interleaved rounds
bun /Users/jyz/dev/crust/research/libffi/symcheck.ts  # which handle carries objc_msgSend
```

---

## 0. Fact-checks against the brief and DESIGN.md

| Claim under test | Finding |
|---|---|
| DESIGN.md §2 and §9 risk 1: "Driving libffi directly — unproven." | **Now proven, and the sentence is stale.** Restated as a measured PASS in 1. |
| "libffi is a system library, and the write primitive exists" | **Correct.** `/usr/lib/libffi.dylib` `dlopen`s by that path although the real file lives in the dyld shared cache, the same way `/usr/lib/libobjc.A.dylib` does. |
| DESIGN.md §2: BunKit "ships `native/build.sh` — it has a small compiled bridge over libffi, and so it violates crust's no-native-artifact rule." | **Correct about BunKit, but the violation is BunKit's choice, not a requirement of the technique.** libffi is reachable from `bun:ffi`, so that build step can go. |
| "Structs cannot cross `bun:ffi` in either direction on 1.4.4" (established by the `cc()` lane) | **True of typed `dlopen`/`cc` symbol declarations, and false for libffi.** `div(100,7)` returns an 8-byte struct through `ffi_call`, correct field values, on the same Bun. The limit is in bun:ffi's marshalling layer, not in the process. |
| "`cc()` is the proven artifact-free route for v1" | **Still the recommendation**, and nothing here contradicts it — see 14. |
| The brief's premise that a native artifact might be unavoidable | **Wrong for both routes.** libffi adds zero files to the bundle; `cc()` ships a `.c` that TinyCC compiles in 2–3 ms at launch. |

---

## 1. Resolution of the core symbols — PASS

`bun:ffi` throws at `dlopen` time for a missing symbol, so a one-symbol `dlopen` is itself the cleanest existence test.

| Symbol | Declared as (args → returns) | Result |
|---|---|---|
| `ffi_prep_cif` | `ptr, i32, u32, ptr, ptr` → `i32` | **PASS** resolvable; returns 0 (`FFI_OK`) on every prepared cif |
| `ffi_call` | `ptr, ptr, ptr, ptr` → `void` | **PASS** calls C and ObjC; see 5 and 6 |
| `ffi_prep_closure_loc` | `ptr, ptr, ptr, ptr, ptr, ptr` → `i32` | **PASS** returns 0; the closure fires (7) |
| `ffi_prep_cif_var` | `ptr, i32, u32, u32, ptr, ptr` → `i32` | resolvable; opened, not exercised |
| `ffi_closure_alloc` | `u64, ptr` → `ptr` | **PASS** returns executable memory, writes the code pointer through the second argument |
| `ffi_closure_free` | `ptr` → `void` | resolvable; not needed by the probes |

```
PASS  symbol ffi_prep_cif :: resolvable
PASS  symbol ffi_call :: resolvable
PASS  symbol ffi_prep_closure_loc :: resolvable
PASS  symbol ffi_closure_alloc :: resolvable
PASS  symbol ffi_closure_free :: resolvable
PASS  dlopen libffi (prep_cif + call + prep_cif_var) :: handle acquired, no artifact
```

`objc_msgSend` is a separate case, because it is a re-export of `/usr/lib/objc/libobjcMsgSend.dylib` and does **not** live in `/usr/lib/libobjc.A.dylib`'s own symbol table in every case:

```
FOUND  dlsym(RTLD_DEFAULT (-2) handle, "objc_msgSend") 0x18ad38800
NULL   dlsym(libffi handle, "objc_msgSend")           -
FOUND  dlsym(libobjc handle, "objc_msgSend")          0x18ad38800
FOUND  dlsym(Foundation handle, "objc_msgSend")       0x18ad38800
NULL   dlsym(libffi, "objc_getClass")                 -
FOUND  dlsym(libffi, "ffi_type_sint32")               0x198a6eee8
```

So one handle is enough for libffi, and `RTLD_DEFAULT` or the `libobjc` handle is where `objc_msgSend` comes from. `probe.ts` tries the libffi handle first and falls back — the first attempt is the null one on this machine.

## 2. `ffi_type_*` globals, by symbol name — PASS

These are **data**, not code. `bun:ffi` exposes every declared symbol as a callable, so `lib.symbols.ffi_type_sint32` is a function stub, and reading memory at that stub reads code. Every descriptor must come from `dlsym`, and `dlsym` needs a **real handle**: `RTLD_DEFAULT` (a null or `-2` handle) returns nothing for all of them, because libffi loads `RTLD_LOCAL`.

| Symbol | Address (one run) | Layout read back |
|---|---|---|
| `ffi_type_void` | `0x198a6ee58` | — |
| `ffi_type_pointer` | `0x198a6ef30` | `{size: 8n, alignment: 8, type: 14}` |
| `ffi_type_sint32` | `0x198a6eee8` | — (`type: 10`) |
| `ffi_type_sint64` | `0x198a6ef18` | `{size: 8n, alignment: 8, type: 12, elements: 0}` |
| `ffi_type_uint64` | `0x198a6ef00` | — (`type: 11`) |
| `ffi_type_double` | `0x198a6ef60` | — (`type: 3`) |
| `ffi_type_float` | `0x198a6ef48` | — (`type: 2`) |
| `ffi_type_struct` | **ABSENT** | not exported by this dylib |

Addresses move per run (ASLR moves the whole image); the relative offsets hold. `ffi_type` is 24 bytes here: `size_t size` (8) + `unsigned short alignment` (2) + `unsigned short type` (2) + `ffi_type **elements` (8).

`ffi_type_struct` being absent is a real gap: every struct shape needs a hand-built descriptor (`type: 13`, correct `size`/`alignment`, NULL-terminated `elements`), which is exactly the work `cc()` lets the C compiler do. Codes used: `VOID 0`, `FLOAT 2`, `DOUBLE 3`, `SINT32 10`, `UINT64 11`, `SINT64 12`, `STRUCT 13`, `POINTER 14`.

## 3. `malloc` / `free` through `bun:ffi` — PASS

Declared as `malloc: {args:["u64"], returns:"ptr"}` and `free: {args:["ptr"], returns:"void"}` from `/usr/lib/libSystem.B.dylib`.

```
PASS  malloc(8) returns a non-null pointer, free(ptr) returns void :: {"malloc":"0x10a61f5b0","free_returned":"undefined (void)"}
PASS  free() actually returns memory :: 100k x 8 KiB malloc+free, RSS 13792 KiB -> 17856 KiB (4.0 MiB)
INFO  control without free() :: 16k x 8 KiB, RSS 17872 KiB -> 147040 KiB (+126.1 MiB)  [16000 pointers held]
```

That is the load-bearing measurement: 800 MiB of allocate/free traffic moves RSS by 4 MiB, while the same loop without `free` moves it by 126 MiB. `free` is a real free, not a no-op that would have made every "no artifact" claim a leak.

`free` also accepts the `bigint` that `read.u64` returns — `free(4404247984n)` completed without complaint — so pointers can be carried as one type all the way through.

## 4. The write primitive: `memcpy(destPtr, srcTypedArray, len)` — PASS

Declared `memcpy: {args:["ptr","buffer","u64"], returns:"ptr"}`. It writes **to** the pointer; there is no read counterpart in `bun:ffi`, so reads go through `read.u8/u16/u32/u64/ptr/f32/f64`.

| Check | Evidence |
|---|---|
| 8-byte pattern, write then read back byte-exact | `[17,34,51,68,85,102,119,136]`, `read.u64 = 9833440827789222417n` |
| 1 KiB pattern, 1024 bytes verified individually | `byte_exact: "yes"` |
| selective overwrite at offset 512 | `e6 de ad ef 9f` — 4 bytes replaced, neighbours intact |
| return value | `memcpy` returns `dest`, `equals_dest: true` |
| zeroing | a fresh `Uint8Array` is already zero, so zeroing memory is the same call — no `memset` needed |
| the same primitive builds an `ffi_cif` and an `ffi_type` graph | `{size: 8n, alignment: 8, type: 12}`, identical to libffi's own descriptor |

Passing a pointer where a TypedArray is declared fails loudly (`bun:ffi 'buffer' argument must be a TypedArray or DataView`), so the write path has one honest failure mode. Everything else in this report is this primitive plus arithmetic.

## 5. End-to-end `ffi_call`, cif and `avalue` in native memory — PASS

The cif is 40 bytes of `malloc`'d memory; the argument array is `malloc`'d too, and every `avalue[i]` points at a slot that also lives in native memory. Nothing is passed as a JS object.

| Call | Signature (rtype ← args) | Result |
|---|---|---|
| `strlen("hello, crust")` | `sint64 ← pointer` | `12n` |
| `abs(-42)` | `sint32 ← sint32` | `42` |
| `strcmp("abc","abd")` / reversed | `sint32 ← pointer, pointer` | `-1` / `1` (argument order is real) |
| `div(100,7)` | **struct{int,int}** ← `sint32, sint32` | `{quot: 14, rem: 2}` |
| `sqrt(2.0)` | `double ← double` | `1.4142135623730951` (matches `Math.SQRT2`, diff < 1e-15) |
| `fabsf(-3.5)` | `float ← float` | `3.5` |

The struct return is the one worth pointing at: `ffi_type_struct` is not exported, so the descriptor is assembled by hand — a NULL-terminated `elements` array of two `ffi_type_sint32`, then `{size: 8, alignment: 4, type: 13}`. `div` then returns both fields at `ret+0` and `ret+4`.

Double and float need their **bit pattern** in the slot, not a number: `DataView.setFloat64(0, 2.0, true)` into the slot bytes, then `ffi_type_double` as both argument and return type. Reading the same 8 bytes as `read.u64` gives `4609047870845172700`, which converts back to `1.414…` only if you know it is a double — representation is entirely the caller's problem.

## 6. An Objective-C method through `ffi_call` — PASS

Foundation is `dlopen`ed first: `objc_getClass("NSObject")` and `NSProcessInfo` exist without it, `NSString`/`NSNumber`/`NSDate` do not, and a NULL class reads as a selector typo.

| Send | Result |
|---|---|
| `[NSObject description]` | id `0xa7f2858e36a57ee9` (a tagged `NSConstantString`) |
| `[NSProcessInfo processInfo]` then `.operatingSystemVersionString` then `.UTF8String` | `"Version 27.0.1 (Build 26A434)"` — a three-send chain, each through `ffi_call` |
| `[NSString stringWithUTF8String:"hi obc"]` then `length` | id `0xa78791898a900899`, length `6n` |

`send(receiver, selector)` is one cif: two `ffi_type_pointer` arguments, `ffi_type_pointer` return. Every AppKit call that takes `(id, SEL, …)` is a cached cif per arity and type list, not per selector — that is libffi's one structural advantage over a fixed prototype.

## 7. Closures: a JS IMP on a runtime-created class — PASS

`ffi_closure_alloc(64, &code)` returns executable memory; `ffi_prep_closure_loc(closure, cif, handler.ptr, 0, code)` installs a trampoline whose `code` address is a callable function pointer. A `JSCallback` is the handler — but it must be declared with **libffi's** signature, `void (ffi_cif*, void *ret, void **args, void *user_data)`:

| Check | Evidence |
|---|---|
| closure called with `(self, _cmd)` reaches JS and returns | returns `4200`, JS invoked once, `self = 0x16f588020` |
| runtime class `CrustProbeDelegate` + JS IMP | `class_addMethod(cls, sel("answer"), code, "i32@:")` → `[inst answer] == 4200` |

`user_data` is free for the bridge to use; the probes pass `0`. The return value is written by the JS body into `ret` with `memcpy` — libffi gives you the storage, not a return channel.

## 8. Pointer representation: `number` or `bigint`?

Both, depending on how the value is obtained. This table is the whole trap.

| Source | Type | Exact? |
|---|---|---|
| A `ptr`-returning symbol (`objc_getClass`) | `number` | yes while the value is < 2^53 — `8205007984` |
| `malloc` return | `number` | yes — `4403300016` |
| `memcpy` return | `number` | yes |
| `read.ptr` | `number` | **no for large values** — on `0xa78791898a900899` it gives `12071777346111146000` |
| `read.u64` | `bigint` | yes — `12071777346111146137` |
| `read.u32` | `number` | yes (32 bits) |

The `read.ptr` row is not a typo: the same word read both ways differs in the low digits, because `read.ptr` narrows to a JS number. An `NSString` literal is a tagged pointer above 2^53, so **`read.u64` is the only safe read for a pointer**, and the value must stay `bigint` until it is used as an argument, where `bun:ffi` converts it into the `ptr` slot.

Rules that follow:

- Keep pointers as `bigint` when they come from `read.u64`, and never `Number()` them.
- When a call needs a pointer *argument*, write its 8 bytes into a slot and point `avalue[i]` at the slot; do not rely on any implicit conversion.
- A `number` is fine for `malloc` results and for `dlopen`/`dlsym` outputs on this machine, but the moment one may exceed 2^53 (any ObjC object, any heap address on a future Mac), the discipline has to be `bigint` throughout.

## 9. Every failure, with the construct that caused it

Reproduced in child processes (`crashes.ts`), so the parent reports the signal instead of dying.

| Construct | Outcome |
|---|---|
| `malloc(32)` for `ffi_cif`, then `ffi_prep_cif` | **SIGSEGV** in `ffi_call`. `prep` returns 0 first, so the corruption is silent until the call. |
| `Number()` on a tagged `NSString` pointer, then `objc_msgSend` | **Silent wrong answer**, exit 0: `[Number(id) length]` returned `9` (and `3` on an earlier run) instead of `6`. An earlier compiled-binary run crashed at `0x10` from the same construct, so the failure is *not* deterministic — which is worse. |
| `avalue[0]` one indirection too deep | **Silent garbage**, exit 0: `abs(-42)` returned `100824496`. No crash, no diagnostic. |
| A `JSCallback` body written as `(self, cmd)` | **Silent wrong arguments**: the two bindings are `number`, `number` — they are `cif` and `ret`, not `self` and `_cmd`. |
| `dlsym(ffiHandle, "ffi_type_struct")` | NULL — not exported; must be built. |
| `dlopen()` of a data symbol (`ffi_type_sint32`) | Returns a callable stub; reading it reads code, not the descriptor. |
| `dlsym(RTLD_DEFAULT, "ffi_type_sint32")` | NULL — libffi is `RTLD_LOCAL`; a real handle is required. |

Two properties of these failures matter more than the list:

1. **They are not catchable.** A SIGSEGV in `ffi_call` kills the process; Bun prints its "file a GitHub issue" footer, which is how you can tell it was a native fault rather than a JS exception.
2. **The silent ones are worse than the crashes.** A wrong `avalue`, a truncated pointer and a mis-declared closure all produce plausible numbers.

## 10. Per-call latency, re-measured

`micro.ts`: same process, interleaved rounds, **median of five**, 500,000 calls per round. Two independent runs agree within ~15%; the host is shared with other agents, so medians are quoted, not maxima.

| Route | ns/call (run 1 / run 2) | Note |
|---|---|---|
| `dlopen` fixed prototype (`abs`) | **2.5 / 2.1** | what `cc()` presents after the shim resolves |
| `CFunction` over a `dlsym`'d address | **1.3 / 1.3** | fixed prototype, no `.c` file at all |
| `ffi_call`, cif prepared once | **28.8 / 26.8** | libffi marshalling only |
| `ffi_call`, cif built per call | **486.7 / 505.1** | never do this; cache the cif |
| one 4-byte argument write via `memcpy` | **88 / 83** | the dominant per-send cost |
| hand-built 8-byte struct type graph | **681 / 656** | only when a new struct shape appears |
| 3-pointer-arg `ffi_call`, cif cached (`objc_msgSend` shape) | **22 / 21** | same as the 1-arg case |

A complete libffi send is **≈110–130 ns** (marshal 83–107 + call 21–29); a shim-backed fixed-prototype send is **≈85–110 ns**. The 12x on the bare call is real and irrelevant: the `memcpy` marshal is what a send costs, and both routes pay it. At 10,000 messages/second the FFI bill is ~1.2 ms/s.

## 11. Why `ffi_cif` is 40 bytes on arm64, and where it bites

`ffi.h` declares the struct as:

```c
typedef struct {
  ffi_abi abi;              /* 4 */
  unsigned nargs;           /* 4 */
  ffi_type **arg_types;     /* 8 */
  ffi_type *rtype;          /* 8 */
  unsigned bytes;           /* 4 */
  unsigned flags;           /* 4 */
  FFI_EXTRA_CIF_FIELDS;     /* 4, Apple arm64 only */
} ffi_cif;
```

and `ffitarget_arm64.h:92` defines the extra field:

```c
#if defined (__APPLE__)
#define FFI_EXTRA_CIF_FIELDS unsigned aarch64_nfixedargs
```

`aarch64_nfixedargs` is the count of named arguments in a variadic call: Apple's arm64 ABI passes the fixed part in the normal registers and the variadic part on the stack, so `ffi_prep_cif_var` needs to record where the split is. Without it, `ffi_prep_cif_var` cannot build the right frame — which is why the field is compiled in unconditionally and is part of the struct's layout on every Apple arm64 build, not only for variadic use.

Layout measured on this machine, from a prepared 2×`int32` cif (`limits.ts`):

```
abi 1 · nargs 2 · arg_types 0x…1420 · rtype 0x…eee8 · bytes 16 · flags 30
aarch64_nfixedargs 0 · offset 36 unused (padding)
hex 01 00 00 00 02 00 00 00 | arg_types (8) | rtype (8) | 10 00 00 00 | 1e 00 00 00 | 00 00 00 00 00 00 00 00
```

`sizeof(ffi_cif) == 40` — 36 bytes of fields plus 4 bytes of tail padding to the 8-byte alignment of the pointers.

Proved without the header, by canary: a 0x5A pattern placed at offset 32 of a prepared cif comes back `00 00 00 00 5a 5a 5a 5a`. `ffi_prep_cif` zeroes the four bytes at 32..35 (the nfixedargs field) and leaves 36..39 alone. If the struct were 32 bytes, prep would have no reason to touch that canary.

Where it bites:

1. **A 32-byte allocation is a heap overrun**, measured as SIGSEGV in `ffi_call` (9).
2. **Porting from x86_64 reproduces it silently.** There `ffi_cif` has no extra field, so it is 32 bytes; a cached stride of 32 on arm64 corrupts every second cif.
3. **Serialising or pooling cifs** with a hardcoded 32-byte stride, or a `new Uint8Array(32)` buffer, has the same effect.
4. **Zeroing only 32 bytes** leaves `aarch64_nfixedargs` uninitialised; `ffi_prep_cif` writes it, `ffi_prep_cif_var` reads it, so a garbage fixed-arg count is a real failure mode if a *variadic* cif is ever prepared from non-zeroed memory.
5. **`FFI_EXTRA_CIF_FIELDS` is `unsigned is_variadic` on Windows arm64**, so the field at 32 exists there too but means something else — reading or writing it portably is not possible without per-target code.

## 12. The exact working incantation, step by step

Everything below is measured. Each step names what it costs and what it breaks.

### Step 1 — one `libSystem` handle for the primitives

```ts
import { dlopen, read, JSCallback } from "bun:ffi";

const sys = dlopen("/usr/lib/libSystem.B.dylib", {
  malloc: { args: ["u64"], returns: "ptr" },
  free:   { args: ["ptr"], returns: "void" },
  memcpy: { args: ["ptr", "buffer", "u64"], returns: "ptr" },
  dlopen: { args: ["cstring", "i32"], returns: "ptr" },
  dlsym:  { args: ["ptr", "cstring"], returns: "ptr" },
});
```

`dlopen(path, {})` throws `Expected at least one symbol`, so every open declares at least one use. `/usr/lib/libSystem.B.dylib` is genuinely on disk, unlike `libobjc`/`libffi` which resolve out of the dyld shared cache.

### Step 2 — a real libffi handle, and the type descriptors by `dlsym`

```ts
const ffiHandle = Number(sys.symbols.dlopen("/usr/lib/libffi.dylib", 1)); // 1 == RTLD_LAZY
const typeAddr = (n: string) => Number(sys.symbols.dlsym(ffiHandle, n));
const T = {
  pointer: typeAddr("ffi_type_pointer"),
  sint32:  typeAddr("ffi_type_sint32"),
  sint64:  typeAddr("ffi_type_sint64"),
  double:  typeAddr("ffi_type_double"),
};
```

`RTLD_DEFAULT` (`-2`) returns NULL for all of these; a real handle is mandatory. `ffi_type_struct` is not exported — build it (below).

### Step 3 — build the cif in native memory, then let `ffi_prep_cif` finish it

```ts
const FFI_DEFAULT_ABI = 1; // FFI_SYSV on darwin/arm64 — NOT FFI_UNIX64 (2)
const CIF_SIZE = 40;       // Apple arm64 adds `unsigned aarch64_nfixedargs`

const zero = (addr: number, n: number) => sys.symbols.memcpy(addr, new Uint8Array(n), n);
const put  = (addr: number, bytes: Uint8Array) => sys.symbols.memcpy(addr, bytes, bytes.length);
const u32le = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const u16le = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; };
const u64le = (v: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };

const argTypes = Number(sys.symbols.malloc(8n));
put(argTypes, u64le(T.pointer));

const cif = Number(sys.symbols.malloc(BigInt(CIF_SIZE)));
zero(cif, CIF_SIZE);                       // malloc does not zero; prep reads the whole struct
put(cif,      u32le(FFI_DEFAULT_ABI));     // abi
put(cif + 4,  u32le(1));                   // nargs
put(cif + 8,  u64le(argTypes));            // arg_types
put(cif + 16, u64le(T.sint64));            // rtype

const st = ffi.symbols.ffi_prep_cif(cif, FFI_DEFAULT_ABI, 1, T.sint64, argTypes);
if (st !== 0) throw new Error(`ffi_prep_cif ${st}`);   // FFI_OK is 0
```

`ffi_prep_cif(cif, abi, nargs, rtype, arg_types)` takes `rtype` and `arg_types` **twice** — once for you, once in the struct — and writing the wrong one of the two is caught by nothing. The header fields before prep are optional in practice because prep fills them, but writing them matches the struct and makes the zeroed-buffer requirement explicit.

### Step 4 — stage the arguments, then call

```ts
const aValue = Number(sys.symbols.malloc(8n * 1));  // void *avalue[n]
const slot   = Number(sys.symbols.malloc(16n));
put(slot, u64le(textPtr));                          // pointer argument: 8 bytes in the slot
put(aValue, u64le(slot));                           // avalue[0] POINTS AT the slot

const ret = Number(sys.symbols.malloc(64n));
zero(ret, 64);                                      // a struct return is written in full
ffi.symbols.ffi_call(cif, fnAddr, ret, aValue);
const n = read.u64(ret);                             // bigint
```

`ffi_call(ffi_cif*, void (*fn)(void), void *rvalue, void **avalue)` — the function pointer is untyped (`void (*)(void)`), so `bun:ffi` cannot check it either.

### Step 5 — a struct type, when one is needed

```ts
const elems = Number(sys.symbols.malloc(24n));
put(elems,     u64le(T.sint32));
put(elems + 8, u64le(T.sint32));
put(elems + 16, u64le(0n));            // NULL-terminated

const structType = Number(sys.symbols.malloc(24n));
put(structType,      u64le(8n));       // size  — 8 bytes
put(structType + 8,  u16le(4));        // alignment
put(structType + 10, u16le(13));       // FFI_TYPE_STRUCT
put(structType + 16, u64le(elems));
```

`ffi_type` layout: `size` at 0 (8 bytes), `alignment` at 8 (2), `type` at 10 (2), `elements` at 16 (8) — 24 bytes total. Sizes are `size_t` so a JS `number` is enough, but the element array is a pointer and wants `bigint` discipline.

### Step 6 — resolve `objc_msgSend` and send

```ts
const msgSend = Number(sys.symbols.dlsym(-2, "objc_msgSend"));  // RTLD_DEFAULT
const objc = dlopen("/usr/lib/libobjc.A.dylib", {
  objc_getClass:   { args: ["cstring"], returns: "ptr" },
  sel_registerName:{ args: ["cstring"], returns: "ptr" },
});
dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", {
  NSGetSizeAndAlignment: { args: ["cstring", "ptr", "ptr"], returns: "cstring" },
}); // NSString/NSNumber/NSDate do not exist until this
```

`(id, SEL)` is one cached cif with `pointer, pointer → pointer`; a one-argument message is `pointer, pointer, pointer → pointer`; the count is the only thing that changes, which is where the runtime signature idea comes from.

### Step 7 — a closure IMP

```ts
const closureLib = dlopen("/usr/lib/libffi.dylib", {
  ffi_closure_alloc:   { args: ["u64", "ptr"], returns: "ptr" },
  ffi_prep_closure_loc:{ args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
});

const handler = new JSCallback((_cif, ret, args, _ud) => {
  sys.symbols.memcpy(ret, i32le(4200), 4);          // write the return value yourself
}, { args: ["ptr", "ptr", "ptr", "ptr"], returns: "void" });

const codeSlot = Number(sys.symbols.malloc(8n));
put(codeSlot, u64le(0));
const closure = closureLib.symbols.ffi_closure_alloc(64, codeSlot);
const code    = read.u64(codeSlot);                  // the callable function pointer
if (closureLib.symbols.ffi_prep_closure_loc(closure, cif, handler.ptr, 0, code) !== 0) throw new Error("prep_closure_loc");
```

Then `class_addMethod(cls, sel, code, "i32@:")` installs it as an ObjC method; the encoding string is still hand-written, because libffi does not produce one.

## 13. What a caller must do differently versus the `cc()` route

| Concern | `cc()` with a `.c` shim | libffi through `bun:ffi` |
|---|---|---|
| Writing a call | normal function call, `lib.symbols.f(x, 2)` | build type list + cif (cached), write slots, point `avalue`, read `ret` |
| Argument conversion | bun converts per declared `args` | you write raw bytes with `memcpy`; floats need bit patterns |
| Return values | converted by bun (`cstring` → string, `u64` → bigint) | read `ret` with `read.*`; floats via a `DataView` on the bits |
| Signatures known at build time | C prototypes, checked by TinyCC | same prototypes live in TS as type pointers; nothing checks them |
| Signatures known only at runtime | impossible without regenerating the `.c` | possible: build the cif from `method_getTypeEncoding` |
| Struct arguments/returns | park in C, return a scalar or pointer | libffi marshals them; each shape needs a hand-built descriptor |
| Memory | none visible to JS | `malloc`/`free`, `avalue`, `ret`, closure code; leaks are yours |
| Pointer type discipline | bun's declarations convert for you | `bigint` end to end; `read.ptr` truncates above 2^53 |
| A wrong type | C compiler error, or a fixed prototype returning garbage | heap overrun, or a call that returns plausible garbage |
| Toolchain at runtime | TinyCC inside Bun; an SDK only for `#include` | none at all: no compiler, no headers, no SDK |
| Launch cost | 2–3.4 ms for an objc + Foundation file | zero; `dlopen` + `dlsym` is microseconds |
| Files shipped | one `.c` | none |
| Debuggability | `printf` in the `.c`, breakpoints in C | no C to inspect; failures are memory |
| `objc_msgSend` | fixed prototype in C per arity (mandatory — a variadic declaration returns garbage) | fixed cif per arity/type list; the variadic problem disappears |
| Portability | one `.c` per target | ABI constants and cif size per target |

The single sentence version: **`cc()` moves the signature work into C where the compiler checks it; libffi moves it into memory where nothing does.**

One caveat in the other direction, and it is a real one: `cc()` needs an SDK present for `#include`. libffi needs nothing — not even headers — so on a machine with no Command Line Tools, libffi is the only one of the two that still works, provided the shim would otherwise include anything.

## 14. What would break if crust chose this route for v1

1. **The bridge becomes per-shape code.** A cif cache keyed by `(rtype, nargs, arg_types…)` is mandatory; `micro.ts` measures 27 ns cached against 490–505 ns per call to build one, and a wrong cache key silently reuses the wrong ABI layout. `cc()` has no equivalent failure because there is no cache.
2. **The ABI constants are machine-specific.** `FFI_DEFAULT_ABI = 1` and `CIF_SIZE = 40` are arm64-darwin facts; x86_64 wants `2` and `32`, Windows arm64 puts a different field at 32. A port that forgets either overruns memory instead of raising.
3. **Every pointer needs `bigint` discipline**, and `read.ptr` is a trap that looks like the right API. One `Number()` on a tagged object turns into a wrong answer or a SIGSEGV at a low address.
4. **Silent wrongness is the default failure mode.** Three of the five constructs in 9 returned plausible values with exit 0: a wrong `avalue`, a truncated pointer, a mis-declared closure. The `cc()` route's equivalent mistakes are largely compile errors.
5. **`ffi_type_struct` is missing**, so every struct shape is hand-built and each descriptor is another chance to get `size`/`alignment` wrong. DESIGN's struct-free rule avoids this — the moment one `CGRect` is needed, the work appears.
6. **Debugging has no C surface.** A bad cif is a memory corruption; there is no `printf`, no breakpoint, no type checker. `probe.ts` lost a full build cycle to a heap overrun that presented as an unrelated crash.
7. **Closures are hand-written glue.** `JSCallback` + `ffi_closure_loc` + the encoding string + `class_addMethod` is four steps per delegate method, and the wrong signature is silent.
8. **ObjC exceptions are unchanged.** A bad selector still kills the process with `SIGABRT` and no JS error, so the startup verification layer (`respondsToSelector:` once per binding) is still mandatory. libffi does not help here at all.
9. **Nothing is typed, still.** The ladder does not disappear; it is replaced by a type-graph builder of comparable size (the probe's substrate is ~60 lines before any struct), which is a lateral move in effort.
10. **Per-send cost rises slightly** (≈110–130 vs ≈85–110 ns), irrelevant at any plausible message rate, and never the reason to choose one route.
11. **Runtime code provenance.** `ffi_closure_alloc` hands back writable-executable memory, which on macOS is fine for 64 bytes from libffi's own allocator, but it is a surface a `.c` shim does not have. Not a bake-in risk; a thing to know.
12. **The one genuine win remains unused under the struct-free rule:** deriving signatures from `method_getTypeEncoding`. That is the reason to revisit libffi in v2 — if the ladder becomes the bottleneck — not a reason to take it in v1.

So: **`cc()` stays the v1 recommendation.** The honest summary is that libffi is proven, costs roughly the same at runtime, and trades a compile-time check for a memory layout. It is the right tool for the moment crust wants signatures it cannot write by hand; it is the wrong tool for building a first window.

One measured wrinkle that reframes the whole comparison: `new CFunction({ ptr, args, returns })` over a `dlsym`'d address runs at **1.3 ns**, faster than a `dlopen`-declared symbol and 20x faster than `ffi_call`. For any call whose prototype is known, **neither a `.c` file nor libffi is needed** — a fixed prototype wrapped around a resolved address is the cheapest artifact-free route, and it is what `cc()` reduces to once the shim's function pointer is in hand. The shim's remaining value is the compile-time check, struct smuggling, and not writing prototypes in TypeScript.

## 15. Files

Every file ends in `process.exit(...)`, prints one line per check, and leaves nothing running.

- `probe.ts` — the 22-check verdict: resolution, type descriptors, write primitive, `ffi_call`, ObjC, closures, pointer representation. `-> ALL CHECKS PASSED`, exit 0, and the same inside `bun build --compile --minify --trim` (89 MB).
- `limits.ts` — 12 checks the verdict needs beyond "it works": `free` under an RSS measurement, a 1 KiB write/read, the cif canary, the full 40-byte dump, pointer types, double and float arguments.
- `crashes.ts` — five failure modes, each spawned as a child so the parent prints the signal: `cif32`, `tag`, `avalue`, `closure`, `struct`.
- `micro.ts` — per-call cost, median of five interleaved rounds.
- `symcheck.ts` — which handles carry `objc_msgSend` and `ffi_type_*`.
