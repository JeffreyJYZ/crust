# defects lane — measured traps

- Capability grants key on a **request-body** `window` label, but one bearer token serves every window. On Linux, Windows and Vite-dev a page can claim any label, so grants are bypassable; only the darwin content world fixes the label in an isolated world. Read `src/bridge/server/invoke.ts` + `src/bridge/server/capabilities.ts` together, never one at a time.
- `updater.check` takes a page-supplied `endpoint` and fetches it with no URL policy, while `download` applies `downloadUrlFailure`. Any new fetch entry point must pass the same scheme check.
- `shell-env` blocklists injection variables by exact spelling; Windows env names are case-insensitive, so lowercase `node_options` bypasses. Fold keys before comparing.
- The mac keychain `list` shim uses a fixed `char small[256]` per account, so names over 255 bytes are silently absent from `list` though `get` finds them. A caller-side buffer re-read cannot fix a per-entry limit in C.
- Probe tests placed under `docs/reviews/next-wave/probes/` are collected by neither `bun test` (its script names explicit source paths) nor `bun check` (tsconfig includes only `src` and `scripts`). A red probe can stay there without reddening the gate.
- Run probes directly: `bun test docs/reviews/next-wave/probes/`. The capability probe needs `handlers: [testPlugin]` — `startBridge` throws on an empty handler map.
