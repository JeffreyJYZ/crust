# docs-linux-keychain

Measured 2026-11-18 against the tree, not memory.

- Linux keychain is real: `src/runtime-keychain.ts:24-27` wires `linuxKeychainAdapter()` for `process.platform === "linux"`; the bare `createKeychainPlugin()` fallback at `:28` is for unrecognised platforms only.
- `set`/`get`/`delete` work: `70_keyring.c:95-107` (`secret_password_storev_sync`), `:113-146` (`secret_password_lookupv_sync`), `:149-165` (`secret_password_clearv_sync`); adapter maps them at `src/platform/linux/keychain.ts:62-85`.
- `list` refuses: `src/plugins/keychain.ts:174-181` returns `not-implemented` when `adapter.list` is absent; `REQUIRES_LIST.linux` at `:51` names `secret_service_search_sync in libsecret`; pinned by `src/plugins/keychain-list.test.ts:65-73`.
- Missing provider/library answers `handler-error` naming libsecret + install line: `keychain.ts:47-60` throws, plugin catches at `:131-133`/`:145-147`/`:158-160`; `KEYRING_INSTALL_LINE` at `src/platform/linux/keychain.ts:19-21`.
- No GLib memory crosses FFI: `70_keyring.c:3-5` and `:135-145` copy into `static char shim_keyring_value[65536]` and free through `secret_password_free`; `GError` freed via `g_error_free` at `:86-92`. Bun's mimalloc owns malloc/free, so a GLib string passed through faults at 0xA6D0.
- Over-long secret is refused, never truncated: `70_keyring.c:141-145` sets status -2, adapter `keychain.ts:75` calls `refused("secret is larger than the 64 KiB buffer")`. The "caller-sized buffer re-read" shape is macOS-only (`119_keychain_b.c:14-15,41-49`), so the guide now scopes it to macOS.
- Corrected `site/app/docs/guides/keychain/page.mdx`: added the Windows/Linux `list` refusal under the command table, the no-GLib-crosses-FFI sentence in the Linux bullet, and scoped the buffer-re-read claim to macOS.
- Corrected `site/app/docs/limits/page.mdx:17`: the code binds the `v` variants (`storev`/`lookupv`/`clearv` sync), not the non-`v` names that were written; added the FFI-ownership sentence.
- Conflict left for B5 (owner of the parity page, `docs-linux-keychain` does not touch it): `site/app/docs/reference/parity/page.mdx:69,130` still says "Linux is **not-implemented**" and "no Linux half" — false now. B5's brief names `keychain on Linux` as its row to fix.
- Truth test will break when B5 lands the parity fix: `src/plugins/keychain-registry.test.ts:41-53` asserts the Secure storage row contains `not-implemented`; its `:29` comment "fallback ... on Linux" is stale because the Linux branch is now explicit at `runtime-keychain.ts:24-27`. B5 must update that test with the row.
- Prove: `bun run site:build` PASS (static export), `bun run check:links` PASS (59 routes), `bun test src/plugins/keychain*.test.ts scripts/docs-reference.test.ts` 24 pass/0 fail, `rg -l truth src scripts --glob '*.test.ts' | xargs bun test` 39 pass/0 fail.
