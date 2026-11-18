# platform-gaps lane

Traps measured this lane. Report: `docs/reviews/next-wave/platform-gaps.md`.

- Parity page "same" = API contract, not per-platform behavior. It has no platform column; darwin-only adapters hide behind "same". Never read a "same" row as "Linux/Windows answer".
- Two failure shapes, never merge: registered-but-no-adapter → `not-implemented` (`src/plugins/registry.ts:82-84`); namespace never registered → `unknown-plugin` (`:71-72`) or startup throw from `src/runtime-shim.ts:42-45` when named in `config.plugins`.
- Non-darwin runtime branch `src/runtime-plugins.ts:78-93` registers a small subset. 17 darwin namespaces absent there → `unknown-plugin` on Linux/Windows.
- `linuxScreenAdapter` (`src/platform/linux/screen.ts:51`) and `windowsScreenAdapter` (`src/platform/windows/screen.ts:54`) are written, C shims complete, but no caller outside their own files. Cheapest fix in the tree.
- `unsupportedLifecycle().take()` throws, but `src/app-watch.ts:117-125` swallows it. Page sees no event AND no error. Docs claim "answers not-implemented naming it"; only true for direct callers.
- Windows keychain C unit already binds `CredFree` (`src/platform/windows/shim/48_keychain.c:67`). `keychain.list` needs only `CredEnumerateW`, same `advapi32`, same `GetProcAddress` pattern.
- Windows shim modules loaded today: kernel32, user32, ole32 (`src/platform/windows/shim/12_win32.c:30-61`). shell32 not loaded → tray needs new module. WebView2 Find is COM, not flat ABI.
- Linux shim loads `libgtk-3.so.0` and `libwebkit2gtk-4.1.so.0` (`src/platform/linux/shim/10_prelude.c:110,114`). WebKitGTK find controller reachable without a new library.
- Windows keychain shim is its own TinyCC translation unit (`shim/48_keychain.c`), compiled by `keychain-ffi.ts`, NOT in `shim-source.ts` — adding symbols there does not move the window unit's pointer count.
- GDK handles and `NSString` short forms are tagged/stack objects; keep C structs in C, cross `bun:ffi` as ints and byte buffers.
