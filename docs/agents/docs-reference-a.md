# docs-reference-a (D5)

Owns `site/app/docs/reference/api*.page.mdx` (8 pages: api, api-app, api-desktop, api-fs, api-ui, api-updater, api-web, api-window), one writer, one tree.

- Verification: `bun run site:build`, `bun run check:links`, `bun run check:parity`, then `bun test` on every `.test.ts` from `rg -l truth src scripts`. `check:lines` is red on `scripts/butter-sweep-commands.ts` (210 lines) — another lane's file, untouched.
- `app.invoke` now honours both refusal forms: `invokeCommand` (`src/plugins/define.ts:80`) turns a returned `notImplemented()` and a thrown `NotImplementedError` into a `not-implemented` rejection carrying `requires`; a plain thrown error becomes `handler-error`. `src/app-invoke.test.ts` is the proof. The old api-app claim "including its typed failures and not-implemented, passed through unchanged" was wrong; fixed.
- `POWER_COMMANDS` is 10, not 4: the four reads plus six push commands (`onSleep/onLock/onWake/onScreenSleep/onScreenWake/onUnlock`, answer `{ ok: true, event: "power:*" }`). api/page listed 4; fixed. Added the six to api-desktop.
- Missing page commands added from the plugin command maps: `app.info` (`{ id, name, version, execPath, packaged }`), `navigation.loadUrl` (`{ url, label? }` → `{ ok: true, loaded }`, `requires: "loadRequest:"`), `tray.setTooltip` (`requires: "setToolTip:"`), `fs.readBinary/writeBinary/mkdir`. Each verified against source, not guessed.
- updater: `install`/`relaunch` refuse off macOS with `unsupported-platform`; `check` obeys download's scheme policy; `invalid-archive` is a real failure code. api-updater corrected.
- Capability authority is the token-bound label, not the body label (`src/bridge/server/invoke.ts:41-43`, `actions.ts`). api-window's `window.label` claim already says a client label is routing only; left alone.
- Frontmost app before and after: Brave Browser. No GUI launched, no focus hand-back needed.
