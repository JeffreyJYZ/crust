# Lane E — plain-HTML hot reload

## fixed
- `src/cli/dev/reload.ts` (new) — watch `public/` only with no `dev.url`; 120 ms debounce; `publicHealthy` reads a non-empty `index.html`, so a failed rebuild publishes no token; `publishReload` advances `.crust/dev-reload`.
- `src/cli/dev.ts:114-130` — set `CRUST_DEV_RELOAD_FILE` before spawning the runtime, seed the token, close the watcher and unset the env var in `finally`. No backend restart; `.crust/` is ignored by the backend watcher.
- `src/bridge/server/events.ts:16-75` — `dev:reload` event, env-driven signal-file watcher, 80 ms debounce; empty or unchanged token emits nothing; `stop()` closes it through cleanups.
- `src/bridge/client/install.ts:118` — one built-in listener in the injected client; `scope.location.reload()` only on `dev:reload`.
- `src/bridge/server/assets.ts:95` — plain dev re-reads `public/index.html` so the reload shows the edit; dev.url and built apps keep the startup snapshot. Fresh HTML is not re-run through `injectShim`; the client's own two-arg invoke covers that form.

## tests added
- `src/bridge/client/reload.test.ts` — injected source reloads once per event; unrelated event does nothing.
- `src/bridge/server/events-reload.test.ts` — changed token emits one frame; empty token emits none.
- `src/bridge/server/assets-reload.test.ts` — edited `index.html` served fresh, bootstrap still injected.
- `src/cli/dev/reload.test.ts` — gate, no watcher under dev.url, token advances on a healthy change, no advance after `index.html` is removed.

## verification
`bun check` clean; 10/10 Lane E tests; `bun test src/bridge src/cli` 242 pass; `bun run check:lines` pass; `bun fmt` on changed files only.

## not fixed
None. The runtime child owns the bridge, so the parent signals it through an env var plus file; no IPC change to `runtime.ts` was needed.
