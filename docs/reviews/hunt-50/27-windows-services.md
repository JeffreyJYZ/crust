# `src/platform/windows/` services (clipboard, keychain, power, network) — unchecked error codes — 27

Read-only source inspection. Scope: the Windows clipboard and keychain adapters, their C shims, and the Win32 resolver they share. Question asked: which native error codes are returned into code that never reads them, or are collapsed into a normal answer. No GUI app launched, no cursor moved, no files changed outside this report. All `file:line` from `read`/`rg`.

**Count: 4 findings** (1 high, 2 medium, 1 low).

**Worst: F1 — a keychain `get` on a machine where advapi32 or any one credential export fails to resolve returns `{ ok: true, found: false }` instead of a refusal. The "store unavailable" code and the "nothing stored" code are the same `-1`, and `available()` is never called.**

---

## F1 (high, worst) — keychain `get` collapses "credential store unavailable" into "no secret stored"

- `src/platform/windows/shim/48_keychain.c:133` — `if (!shim_keychain_available()) return -1;`. That `-1` is the same value `:141` returns for `ERROR_NOT_FOUND`.
- `src/platform/windows/shim/48_keychain.c:64-80` — availability requires *all* of `MultiByteToWideChar`, `GetLastError`, `CredWriteW`, `CredReadW`, `CredDeleteW`, `CredFree` and `CredEnumerateW` to resolve. One missing export disables the whole store.
- `src/platform/windows/shim/48_keychain.c:62-63` — `kc_state` is sticky at `-1`, so one failed resolution disables the store for the lifetime of the process; there is no retry.
- `src/platform/windows/keychain-ffi.ts:64-65` — `WINDOWS_KEYCHAIN_STATUS.refused = -1`, so the TypeScript half names the "not stored" sentinel "refused".
- `src/platform/windows/keychain-ffi.ts:157` — `?? -1` on the FFI result gives a second path to `-1` when the symbol does not answer.
- `src/platform/windows/keychain.ts:49` — `if (length === WINDOWS_KEYCHAIN_STATUS.refused) return null;` turns `-1` into the normal "absent" answer.
- `src/plugins/keychain.ts:145-148` — `null` becomes `{ ok: true, found: false }`, so the refusal never reaches the page as `handler-error`.
- `src/platform/windows/keychain-ffi.ts:105-112,128` — `WindowsKeychainShim.available()` exists and the real shim implements it, but no caller invokes it. `rg '\.available\('` over `src` finds no call in the adapter or the plugin.

**Reached:** `keychain.get({ service, account })` on Windows where `advapi32.dll` cannot be loaded, or where any one of the seven exports is missing (a downlevel or locked-down machine, or a partial `LoadLibraryA`). `shim_keychain_get` takes the early return at `:133`; the adapter takes `:49`; the plugin answers `found: false` for *every* secret. `set` and `delete` on the same machine take their own `-1` paths and throw `handler-error`, so the same unavailable store reports two different stories. A caller treats `found: false` as "first run" and can proceed unauthenticated or overwrite a credential it could not read. No existing test drives `available: false`: `keychain.test.ts:56-69` fixes `available: () => true` and only varies the `get` return value.

**Smallest fix:** give the unavailable state its own code (the unit already has `SHIM_KC_REFUSED = -3`; use it at `:133`), and make `get` throw on it while keeping `-1` as "not stored". Alternatively have the adapter call `native.available()` first and throw a named refusal; add a test with `available: () => false`.

---

## F2 (medium) — a failed `WideCharToMultiByte` is reported as an empty clipboard

- `src/platform/windows/shim/50_clipboard.c:23` — the sizing call `WideCharToMultiByte(65001, 0, src, srclen, 0, 0, 0, 0)`; a failure returns `0`.
- `src/platform/windows/shim/50_clipboard.c:24` — `if (need <= 0) return 0;` collapses failure into the empty-text sentinel. `GetLastError` is never read.
- `src/platform/windows/shim/50_clipboard.c:51` — that `0` becomes the result of `shim_clipboard_read`, whose contract at `:34-35` reserves `0` for "no text".
- `src/platform/windows/clipboard.ts:47-58` — `length = 0` is not negative, so no throw; `bytes = Math.min(0, buffer.length - 1) = 0`; `readText` returns `""`.
- `src/plugins/clipboard.ts:41,48` — `""` reaches the page as `{ ok: true, text: "" }`.

**Reached:** another application places `CF_UNICODETEXT` holding an unpaired surrogate or other text `WideCharToMultiByte(CP_UTF8, ...)` cannot translate (`ERROR_NO_UNICODE_TRANSLATION`), or the sizing call fails for any other reason. The page sees an empty clipboard, indistinguishable from "nothing was copied", and has no error to branch on. The same collapse would hide a genuine conversion failure from `GetClipboardData` text.

**Smallest fix:** distinguish `need == 0` from `need < 0`; return a distinct negative for a failed conversion and have `clipboard.ts:48` throw a named error, as it already does for `OpenClipboard`.

---

## F3 (medium) — a failed `GlobalLock` on the clipboard handle is reported as an empty clipboard

- `src/platform/windows/shim/50_clipboard.c:45-47` — `text = GlobalLock(block); if (!text) { result = 0; }`. `GetLastError` is never read, and `0` is the documented "no text" answer at `:34-35`.
- `src/platform/windows/clipboard.ts:47-58` and `src/plugins/clipboard.ts:41,48` — identical downstream to F2: `""` reaches the page as a successful read.

**Reached:** `GetClipboardData(CF_UNICODETEXT)` returns a handle that `GlobalLock` refuses — an invalid or discarded `HGLOBAL`, which is possible when another process frees or changes the clipboard object between the two calls. The failure is silently reported as an empty pasteboard, so the page cannot tell a broken clipboard from a copy of nothing. The `OpenClipboard` refusal at `:38` is handled with `-1`; the `GlobalLock` refusal on the next line is not.

**Smallest fix:** return a distinct negative from the `!text` branch and name `GlobalLock` in the adapter error, mirroring the `UNOPENED` path.

---

## F4 (low) — the buffer-filling `WideCharToMultiByte` in `shim_utf8` has its return value discarded

- `src/platform/windows/shim/50_clipboard.c:28` — `if (take > 0) WideCharToMultiByte(65001u, 0u, src, srclen, dst, take, 0, 0);` is called for its side effect and the result is never tested.
- `src/platform/windows/shim/50_clipboard.c:31` — the function returns `need` from the *sizing* call regardless, so the caller believes all `need` bytes were written.

**Reached:** narrow window — a sizing call that succeeds followed by a fill call that fails (bad destination buffer or a changed source). The adapter then decodes `subarray(0, need)` from a buffer where only `dst[take]` was set, handing the page stale or zero-filled bytes as if they were clipboard text. This is the same "fake success" class as F2 but requires the second conversion to fail after the first succeeded.

**Smallest fix:** check the second call's return; if it fails, return a negative so the adapter throws rather than decoding an unwritten buffer.

---

## Scope note — power and network

There is no Windows power or network error-code surface to hunt in this directory. `rg` for `CallNtPowerInformation`, `SetSystemPowerState`, `RegisterPowerSettingNotification`, `PowerCreateRequest`, `WinHttp`, `Winsock`, `WS2_32`, `InternetGetConnectedState`, `shim_power` and `shim_net` over `src/platform/windows/` returns no matches; no `src/platform/windows/**/*power*` or `*network*` file exists. `src/runtime-plugins.ts:73-87` passes the bare `powerPlugin` for non-darwin, and `src/runtime-non-darwin.ts:58` registers the bare `networkPlugin`; both answer `not-implemented` by name. Native power/network adapters live only under `src/platform/darwin/` (`runtime-plugins.ts:99,107`). So these two services have no unchecked Windows codes; a hunt for them belongs in the darwin lane.
