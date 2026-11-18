# native-surface lane memory

## What is already pinned (do not redo)

- `bun test src/platform/darwin/arity.test.ts` walks **all** C files and all
  `.ts` with `symbols: {` under `src/platform/darwin`, and pins arity, symbol
  existence, and "no symbol declared twice with different arity". It does not
  check return types or argument types. Windows coverage is
  `symbols.test.ts` (name map + unwrap) and `abi-width.test.ts` (HRESULT → i64).
- A one-off normaliser comparing C return types against ffi `returns:` per
  platform gave 32 hits, all typedef aliases:
  `obj_t`/`shim_h` = pointer, `shim_i64` ↔ `ptr` both 8 bytes, `u32` ↔
  `unsigned int`. Not bugs. An i64 return reaches JS as a bigint; every
  Windows caller wraps it in `Number(...)` (`platform.ts`, `window-open.ts`).

## Traps worth keeping

- **`alloc`/`init…` Objective-C objects in the C units are +1 and nobody
  releases them.** `net_nsstring` / `dl_nsstring` exist because a short ASCII
  NSString is a tagged pointer that cannot cross bun:ffi and a convenience
  constructor autoreleases too early. The fix is a release after the send,
  never a convenience constructor. `113_network_serve.c:54-85` leaks an NSData
  (up to 256 KB), NSHTTPURLResponse and two NSStrings per served request;
  `110_network.c:69` leaks one per failed task; `dl_start` and
  `dl_file_url` leak one per download. Check any new unit using that helper.
- **The Windows keychain C collapses real OS errors into the not-found
  sentinel.** `48_keychain.c:121` maps any `CredReadW` failure to -1;
  `:137-139` maps any `CredDeleteW` failure to 0 despite the comment
  promising -1. The adapter's "refused the delete" throw is therefore
  unreachable. The darwin twin distinguishes errSecItemNotFound from a
  refusal (`119_keychain_b.c:50-53,73-75`). Match the twin, not the comment.
- **Download tokens are assigned FIFO, not by identity.**
  `20_delegate.c:57-60` gives the first completion `dl_pending[0]`; WebKit
  promises no ordering. Concurrent starts can report finish/progress under
  the wrong id. Already recorded as a decision in `downloads-network.md:24`
  — treat it as a latent race, not a fixed behaviour.
- **`objc_allocateClassPair` failure is permanent.**
  `dl_install` / `net_install` cache the class but leave the instance null
  when `class_addMethod` fails; the next call reuses the cached name, gets 0,
  and never recovers. Dispose the class or clear the cache on that path.
- **Autorelease pools are not a substitute for a release in these C callbacks.**
  The network and download unit bodies run as C, not inside a JS callback,
  and no pool wraps the sends.

## Gate for this area

`bun check` && `bun run test` && `bun run check:lines`; arity alone is
`bun test src/platform/darwin/arity.test.ts`. No GUI launch needed for a C-only
probe — compiling a unit and calling its `*_abi()` is safe headlessly.
