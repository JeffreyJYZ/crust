# docs-guides-b

- `permissions` described the pre-F1 model: the body's `window` label as authority. Code now binds the label to the token when the document is served (`server.ts:50-55`, `server/handler.ts:64-93`, `server/invoke.ts:41-64`); the body label is routing only. Keep the guide on the bound-label model.
- `AppEvent` has six events (`src/app-types.ts:47-48`): `ready` and `window-all-closed` are emitted by `app.ts:157,167` on every platform; the other four come from a platform lifecycle source (`platform/darwin/lifecycle.ts:43-47`). "Four events" is stale.
- `navigation` registers `loadUrl` (`plugins/navigation.ts:63,183`) with `{ url, label? }` and `{ ok: true, loaded }`; no adapter with no native `-loadRequest:` answers `not-implemented` with `requires: "loadRequest:"` (`plugins/navigation-load.ts:31-37`).
- Linux keychain landed this wave: `runtime-keychain.ts:24-26` registers `linuxKeychainAdapter()` from `platform/linux/keychain.ts`, libsecret `*_sync` with a private main loop, no GLib loop from crust; `list` is unbound and names `secret_service_search_sync`. The guide's old "Linux not-implemented" line was wrong.
- Verification for this lane: `bun run site:build`, `bun run check:links`, `bun run check:parity`, `bun run check:lines`, plus the six test files from `rg -l truth src scripts`.
