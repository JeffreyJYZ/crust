# Lane X2 — linux-keychain

## Verified 2026-11-18

The `platform-gaps.md` claim was half wrong. Verified with TinyFish fetches of libsecret's own source and docs:

- `secret-util.c` `_secret_sync_new` creates a private `g_main_context_new()` + `g_main_loop_new()`, and `_secret_sync_on_result` calls `g_main_loop_quit`. The `*_sync` API spins its **own** loop; the caller needs no running GLib main loop. `secret-item.c` shows `g_main_loop_run(sync->loop)` inside the sync path.
- Chromium (`components/os_crypt/sync/libsecret_util_linux.cc`) calls `secret_password_lookup_sync` from a headless utility process — real-world proof no main loop is required.
- The remaining true half: libsecret talks to the Secret Service over D-Bus, so it needs a session bus plus a provider (gnome-keyring / ksecretservice / KWallet) and an unlocked collection. That is a runtime dependency, not a binding project.

Decision: implemented, per the brief's implement condition.

## Implementation

- `src/platform/linux/shim/70_keyring.c` — 6th shim part; dlopens `libsecret-1.so.0`, resolves the `v` variants (`secret_password_storev_sync` / `lookupv_sync` / `clearv_sync`, plus GLib hash/error helpers), a static `SecretSchema`, and copies secrets into a static buffer so no GLib memory crosses bun:ffi. The `v` variants avoid the C varargs of the plain `_sync` functions, which FFI cannot declare.
- `src/platform/linux/keychain.ts` — adapter; opens libsecret on first command, maps C status to the `KeychainAdapter` contract, and refuses with `libsecret-1-0` + `gnome-keyring` install line when absent.
- `src/runtime-keychain.ts`, `src/plugins/keychain.ts`, `src/plugins/keychain-types.ts` — third platform arm, accurate refusal text, per-platform `list` refusal.
- `site/app/docs/limits/page.mdx` — Secret Service requirement and the file-scope `stronghold` alternative.

## Traps

- Never return GLib-owned memory across bun:ffi: Bun exports its own malloc/free (mimalloc) and freeing a GLib string through them faults (measured at 0xA6D0). Copy into a static C buffer, free the original with libsecret's `secret_password_free` inside C.
- Read the source value for the truncation check **before** freeing it — the copy's terminator is always 0.

## Untestable here

Success path needs Linux + libsecret + session bus + unlocked keyring. Tests pin the absence path and status mapping only.
