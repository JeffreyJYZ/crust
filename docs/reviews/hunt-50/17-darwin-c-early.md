# Early darwin C shim (`10_*.c`–`49_*.c`) — C that assumes its caller

Read-only hunt. Scope: the four numbered shim files in range — `10_prelude.c`, `20_sends.c`,
`30_webview.c`, `40_window.c` — plus the JS that calls their symbols. "Assumes its caller" here means
C that supplies no guard of its own and relies on the JS side to have already checked the receiver,
the argument, the selector or the lifetime. No code was changed.

Files searched: `fd '[1-4][0-9]_*.c' src/platform/darwin/shim` → 4 files, 405 lines total. Callers
traced with `rg` over `src/**/*.ts`.

**Count: 4 findings (1 high, 2 medium, 1 low).**

**Worst: F1 — `shim_constraint` states in its own comment that `item` must never be nil because
AppKit raises, then never checks `item`. It is called directly, bypassing the `S`/`must()` guard
that every other AppKit send goes through. A nil item is an uncaught Objective-C exception, which
terminates the process with SIGABRT and no JS error.**

---

## F1 (high, worst) — Auto Layout constraints assume non-nil `item`, and are the unguarded send

- `src/platform/darwin/shim/30_webview.c:106-114` — `shim_constraint`: the comment literally says
  "`item` must never be nil (AppKit raises)", but there is no `if (!item) return 0;`. The
  `objc_msgSend` at `:109-114` hands `item` straight to
  `constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:`.
- `src/platform/darwin/shim/30_webview.c:119-123` — `shim_constraint_simple` has the same hole: no
  check on `item` before `constraintWithItem:attribute:relatedBy:constant:`.
- `src/platform/darwin/index.ts:97-98` — both are public FFI symbols (`args: [P, …]`), so any TS
  caller can pass `0`.
- `src/platform/darwin/objc.ts:95-97,100-151` — every other AppKit send goes through an `S.*`
  wrapper, which calls `must()` (receiver guard) first. These two are the sends that skip it.

**Reached:** `src/platform/darwin/window-create.ts:111-114` calls `shim_constraint(web, …)` four
times directly; `web` is the item and `content` the `toItem`. Today `web` is checked non-zero at
`:83` and `content` at `:93`, so the happy path holds — but those checks live entirely in the
caller; the C assumes them and has no defence. Any caller that passes a failed/never-created view
as `web` (a new call site, a test, an alternate window path) reaches `+[NSLayoutConstraint
constraintWithItem:nil …]`, which raises `NSInvalidArgumentException`. Because the send is made
from `bun:ffi`, the exception cannot be caught by JS: the process aborts with no diagnostic. This
is the only function in the four files that documents a fatal precondition and neither enforces it
nor routes through `must()`. (`toItem` nil is *not* a defect for the four-argument variant — that
is exactly what `shim_constraint_simple` exists for.)

---

## F2 (medium) — `shim_webview_load` assumes a live webview and a terminated URL, then reports success on nil

- `src/platform/darwin/shim/30_webview.c:46-63` — no `if (!web) return 0;` at entry. The four
  intermediate ObjC objects are each null-checked (`:49,54,57,60`), but the receiver is not.
  `:61` sends `loadRequest:` to whatever `web` was, and `:62` returns `1` regardless of whether
  anything loaded. Sending a message to `nil` is a no-op, so a null webview returns "success".
- `src/platform/darwin/shim/30_webview.c:52` — `shim_cstr_len(url)` walks `url` with no null check,
  so a null pointer is a hard fault before any of the guards.

**Reached:** `src/platform/darwin/window-create.ts:183-184` treats a `1` as proof the page loaded;
`src/plugins/testing-live.test.ts:97` asserts `1` the same way. Both currently pass a webview
checked at `window-create.ts:83` / `testing-live.test.ts:79`, so the assumption holds there — but
the guarantee is the caller's, not the C's. Any path that has a webview that failed to initialise
but continues (or passes a null URL pointer) gets either a blank window reported as loaded or a
segfault, with the error check at `:184` unable to detect either.

---

## F3 (medium) — raw send ladder does no validation; it assumes every caller used the guarded `S` wrapper and picked the right ABI prototype

- `src/platform/darwin/shim/20_sends.c:3-58` — all 17 `shim_send_*` helpers cast `objc_msgSend` to a
  caller-selected prototype and send immediately. None checks the receiver, the selector, or that
  the prototype matches the selector's real signature.
- `src/platform/darwin/shim/10_prelude.c:1-2` — the file's own header names this hazard: the
  plain-varargs form "compiles and delivers wrong values with no diagnostic (41 arrived as
  1806466472)"; the fixed prototype is the only protection, and it is chosen by the caller.
- `src/platform/darwin/objc.ts:66-68,95-97,99-151` — `S.*` is where `must()` (receiver/selector
  existence) and `SEL()` live. The comment "every send is checked against the receiver first" is
  true only for calls that go through `S`.

**Reached:** a direct caller bypasses both layers. `src/platform/darwin/content-world.ts:38` calls
`shim_send_q0(scripts, SEL("count"))` without `must()`. `scripts` comes from the guarded
`S.p0(...)` chain at `:35-37`, but `S.p0` uses `ptrValue`, which returns `0` for a nil `objc_msgSend`
result rather than throwing (see `objc.ts:28-32`). The `try/catch` at `:34-39` catches JS errors but
not an Objective-C `doesNotRecognizeSelector:` exception. A nil receiver merely yields count `0`
(benign), but any non-array object returned at `userScripts` produces a SIGABRT. Separately, any
caller that selects `p0` for a scalar/BOL return, or `pb1` where a pointer is required, silently
misreads the result — the C cannot detect the mismatch, so correctness rests entirely on the JS
call site.

---

## F4 (low) — `shim_window_title_utf8` returns a borrowed pointer and assumes the caller reads it before the lifetime ends

- `src/platform/darwin/shim/40_window.c:39-44` — returns the raw `-UTF8String` pointer of the
  window's title NSString, with no copy into a caller-owned buffer. The pointer is valid only while
  that string is alive and its title unchanged.
- `src/platform/darwin/index.ts:103` — declared as returning a C string (`CS`), so JS can hold the
  number past the point where the backing object is released.

**Reached:** `src/platform/darwin/window-adapter.ts:107` and
`src/platform/darwin/window-create.ts:136` both wrap the result in `String(...)` immediately, so
the current paths are safe. The assumption is undocumented at the C boundary, though: a caller
that stores the returned pointer, or reads it after the window's title changes or its autorelease
pool drains, dereferences freed memory. Latent, not currently triggered.
