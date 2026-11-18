# dev-react-label

- `scripts/dev-react/phases/serve.ts` cross-origin invoke probe now sends `window: "main"`, the field `src/bridge/client/invoke.ts` puts on every call (`window: label ?? null`), matched from the `?window=` a real page is navigated with.
- Why it must: every template ships `security.capabilities` + `grants: { main: ["app"] }`, so a non-empty list makes the bridge deny-by-default; a body with no label holds no grant and answers `forbidden … a request with no window label`.
- The label is a routing hint, not a credential — the bearer token is still the only auth, so this probe change is not a gate weakening.
- Proof: `bun run e2e:dev:react` 14/14 PASS, `cross-origin invoke` green; `bun check` clean (758 files); `check:lines` PASS.
- Trap for the next lane: a curl probe against a scaffolded app must send the same body a page sends, or the capability gate refuses a request no real page would make.
