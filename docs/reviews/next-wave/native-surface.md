# Next wave, Lane 10 — native surface (the C shim itself)

Field: `src/platform/{darwin,linux,windows}/shim/**/*.c` and every `*-ffi.ts` /
binding declaration. Question: where does the boundary crash, leak, or silently lie?

## Method

- A read-only one-off script (temp, not left in the tree) extracted every
  column-0 C function signature and every `symbols: { args, returns }` entry,
  normalised return types, and compared within the same platform. Output: 32
  candidates, all typedef/ABI aliases (`obj_t`, `shim_h`, `shim_i64`↔`ptr`,
  `u32`↔`unsigned int`), not real mismatches.
- `bun test src/platform/darwin/arity.test.ts` — the existing guard **does** walk
  all of `src/platform/darwin`: every C file and every `.ts` with `symbols: {`.
  It pins arity, symbol existence, and "no symbol declared twice with different
  arity". It does **not** check return types or argument *types*.
  `src/platform/windows/symbols.test.ts` pins the cc() symbol map and unwrapping,
  not arity. `src/platform/windows/abi-width.test.ts` pins HRESULT widening to i64.
- Read the C bodies for allocation/release, error sentinels, and selector arity.

**Conclusion: arity and declared return types are clean.** Every real defect below is
a leak or a silent lie in a C body; none is a wrong `args:` count.

## Findings, ranked by crash / leak / silent lie

### 1. LEAK — every served `crust-net:` request leaks its NSData, response and strings

`src/platform/darwin/shim/113_network_serve.c:54-85` builds, with `alloc`/`init…`
so they are **owned (+1)** and deliberately not autoreleased:

- `data` at :54-57 — `[[NSData alloc] initWithBytes:length:]`, up to 256 KB
- `mime` at :59, `version` at :60 — `net_nsstring` (`alloc`+`initWithBytes:…`)
- `response` at :76-81 — `[[NSHTTPURLResponse alloc] init…]`

After `didReceiveResponse:` / `didReceiveData:` / `didFinish` at :82-85 the objects
are never released. No autorelease pool exists in this C callback; the comment at
:51-53 explains why convenience constructors were avoided, but nothing replaced
the release they would have supplied. WebKit retains what it needs, so a release
after `didFinish` is safe.

`src/platform/darwin/shim/110_network.c:69-77` — `net_fail` leaks `domain`
(`net_nsstring("NSURLErrorDomain", 16)`) on every refused or cancelled task.
`error` is an autoreleased convenience object and is fine.

Manifestation: memory grows by roughly the response size on every intercepted
request and every blocked one; a long-lived app serving many resources grows without
bound. Class: **leak**, fixable without architectural change (release after the sends).

### 2. LEAK — downloads leak the NSString they hand to WebKit

`src/platform/darwin/shim/downloads/00_prelude.c:58-64` — `dl_nsstring` is
`alloc` + `initWithBytes:length:encoding:` (+1). Two callers never release it:

- `30_api.c:59` — `text = dl_nsstring(bytes, len)` in `dl_start`, passed to
  `URLWithString:` at :61-62, then abandoned on every path (including the
  early returns at :63, :65, :67).
- `20_delegate.c:18` — `dl_file_url(dl_destination, …)` (`00_prelude.c:66-72`)
  builds a +1 `NSString` path that `fileURLWithPath:` retains, then drops it.
  This runs on every destination decision.

The `downloads` adapter does call `dl_forget` on finish/fail
(`src/platform/darwin/downloads.ts:114-116`), so the 32-slot table is reclaimed —
the leak is the Objective-C objects, not the slots. Class: **leak**, lower volume
than finding 1 but the same root cause (an `alloc`/`init` helper with no release).

### 3. SILENTLY LIES — Windows keychain collapses distinct OS errors into "not stored"

`src/platform/windows/shim/48_keychain.c:121`:
`if (!CredReadW(target, 1, 0, &found) || !found) return -1;`
Any failure — `ERROR_ACCESS_DENIED`, a malformed store, a locked credential —
is reported as -1.

`:137-139`: `if (CredDeleteW(...)) return 1; return 0;`
The comment at :132 promises `-1 refused`, and the C file at :88 promises
`0 stored, -1 the store refused`. The C never returns -1 for a real refusal.

The typed contract and adapter are built around that missing value:
`src/platform/windows/keychain-ffi.ts:55-58` defines `refused: -1` as "the store
refused, or nothing is stored"; `src/platform/windows/keychain.ts:63-67` throws
"refused the delete" only when status `< 0`; `src/platform/windows/keychain.test.ts:79-80`
asserts that throw. The darwin twin makes the distinction properly
(`119_keychain_b.c:50-53`, `:73-75`: `errSecItemNotFound` → 0, any other → -1).

Manifestation: a genuine refusal reads as "no credential stored" or "nothing to
delete"; the documented throw path is unreachable from the real Windows shim.
Class: **silently lies** (error-code mismatch), not a crash and not a leak.

### 4. SILENTLY LIES — download completion tokens assume FIFO ordering

`src/platform/darwin/shim/downloads/20_delegate.c:57-60`: whichever
`startDownloadUsingRequest:completionHandler:` block fires first is assigned
`dl_pending[0]`, on the assumption that starts complete in the order sent
(the comment at :57 states the assumption; `docs/agents/downloads-network.md:24`
records it as a decision). WebKit promises no ordering for these handlers.

`dl_slot(token)` (`00_prelude.c:75-80`) keys the download table by that token,
and `downloads.ts:93-94,114-119` maps token→id for the page. If two starts
complete out of order, progress and finish events are delivered to the wrong id;
with more than one concurrent download the wrong file can be reported as done.
Class: **silently lies** under concurrency; deterministic single-download flows
are unaffected.

### 5. LEAK (small, one-time) — a failed runtime class registration wedges the unit

`30_api.c:33-45` (`dl_install`) and `110_network.c:134-148` (`net_install`) call
`objc_allocateClassPair`, then return 0 if any `class_addMethod` fails, without
`objc_disposeClassPair`. The cached class pointer stays set (`:33` /
`:134`) and the instance pointer stays null, so the next call re-enters
allocation with the same name, gets 0, and returns 0 forever. One leaked class
and a permanently unavailable download/network surface after a single failed
build. Class: **leak + silent permanent failure**; edge case (Selector absent
on an older macOS), low likelihood.

## What is genuinely clean

- **Arity**: `arity.test.ts` covers darwin exhaustively; manual check of the
  Linux and Windows maps against their C prototypes (`shim-ffi.ts:77-103`,
  `windows/ffi.ts:81-155`) found no count mismatch.
- **Return types**: all 32 candidates from the one-off normaliser are typedef aliases.
  The wide HRESULTs and `shim_last_error` are declared `I64` and every JS
  caller wraps them in `Number(...)` (`platform.ts:87,95-96`,
  `window-open.ts:81,113-116`) — the i64/RAX trap documented in AGENTS.md is
  closed.
- **objc_msgSend prototypes**: `20_sends.c:3-58` has one fixed cast per
  arity/shape; BOOL returns read one byte via `char` (:25-31).
- **Linux ownership**: `30_webview.c:96-120` releases the GLib string with
  `g_free` (not Bun's `free`) and unrefs the JSC value on both success and
  error paths; `10_prelude.c:94-124` `dlclose`s both handles on a failed
  resolve.
- **Darwin keychain**: `118_keychain_a.c:83-153` and `119_keychain_b.c:15-123`
  release every CF object on success and on every early return; the
  single-dictionary-with-five-keys fix and the `kCFBooleanTrue` fix are present.

## Report scope

Only `docs/reviews/next-wave/native-surface.md` and `docs/agents/native-surface.md`
were written. No source was edited, no bug fixed, no third path left behind.
