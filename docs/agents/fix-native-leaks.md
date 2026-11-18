# fix-native-leaks lane memory

## What changed (2026-11-18)

- `110_network.c`: added `net_release` (+1 from `net_nsstring` is balanced by one `-release`, never `free`); `net_fail` releases its domain on both paths; `net_install` releases the scheme after `setURLSchemeHandler:`.
- `113_network_serve.c`: one `done:` cleanup releases response, version, mime, data on success and every failure after `data` exists; the five header temporaries release right after `setObject:forKey:`.
- `downloads/00_prelude.c`: added `dl_release`; `dl_file_url` releases the path NSURL copied.
- `downloads/30_api.c`: `dl_start` releases `text` right after `URLWithString:` (touched outside the named owner list only because the brief explicitly asks to fix that leak; no other lane owns that file).
- `windows/48_keychain.c`: runtime-resolved `GetLastError` (never an `extern` import — the existing import test pins that), `shim_keychain_status(error, notFound, refused)` exported for testing, ERROR_NOT_FOUND mapped to each caller's not-stored sentinel and every other code to a refusal (`-3` for get, `-1` for delete).

## Reusable traps

- A Cocoa object is never handed to `free()`: Bun owns the C allocator (the Linux shim's GLib trap) and Cocoa needs its own `-release`.
- An autoreleased convenience object (`NSDictionary dictionary`, `NSError errorWithDomain:`) is +0 and must NOT be released; `alloc`/`init…` helpers are +1 and must be.
- NSDictionary copies keys and values, NSHTTPURLResponse/NSError retain their arguments, so releasing our local +1 after the send is safe.
- Live C proof without the OS: concatenate a stub Objective-C runtime (selectors as integer ids, `release` counted) with the real shim source, expose one probe with `cc()`, and assert the release count. Red on HEAD: served request 0 releases vs 9 after the fix.
- TinyCC rejects `void object;` definitions. For `_NSConcreteGlobalBlock` in a test harness define a `char` and strip the shim's `extern void` line from the in-memory source.
- Windows `GetLastError` must come from `GetProcAddress(kernel32, "GetLastError")`; an `extern` import breaks `keychain.test.ts`, which pins the only two imports as `LoadLibraryA` and `GetProcAddress`.

## Gate state at handoff

- `bun test src/platform/darwin/native-ownership.test.ts src/platform/windows/keychain-access-denied.test.ts` — 9 pass.
- With existing arity and keychain suites — 23 pass. Scoped `bun check` clean; `bun fmt --check` clean; `bun run check:lines` pass; `clang -fsyntax-only -std=c99 -Wall` clean on all three assembled units.
- Repo-wide `bun check` red on `src/plugins/i18n-locale.test.ts` (another lane). `bun run test` sweeps vendored `research/electrobun` and is red there (not this lane).
