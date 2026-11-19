# CI red: the dev page lost `window.__CRUST__`

`gate (macOS)` failed on `c34514c` while ubuntu and windows passed:

```
PASS  dev serve       http://localhost:5173/ served the Vite client and the /src/main.tsx module
FAIL  crust client    the page has no window.__CRUST__ — crust/vite injected nothing
PASS  window greet    greet  hello react (page call answered)
e2e-dev-react: FAIL  1 of 14 assertions
```

## Why

`src/vite.ts` used to inject the token it read from the environment — no I/O in `transformIndexHtml`.
`44c9417` replaced that with a mint:

```ts
async function mintPageToken(bridgeUrl, seed) {
	const response = await fetch(document, { redirect: "manual" });
	if (response.status !== 302) return undefined;   ← any miss means no client at all
}
```

The security reasoning is right and must stay: a dev page must not hold the **seeding** token, because
that token may mint a document for any label. But paying for it with a per-document network round trip
inside HTML transformation makes the page's client depend on a race with the bridge binding, and when it
loses the page gets nothing — silently, because the only signal is a `console.warn`.

## What to do

1. **Mint once, where the bridge is definitely bound.** The runtime writes `.crust/dev.json` (and
   exports `CRUST_BRIDGE_URL`/`CRUST_BRIDGE_TOKEN`) on first `run()`. Mint the document token there, at
   the point the bridge handle exists, and write **that** token where the dev server reads it. Then
   `crust/vite` goes back to a pure injection: no `fetch`, no round trip, no race.
2. **Keep the security property** — the page still receives a non-seeding document token, and the
   seeding token never reaches the page or the dev server's environment.
3. **A miss must not be silent.** If the mint cannot happen at startup, say so once, loudly, and make the
   dev run fail rather than serve a page whose `window.crust` is missing. A page that loads and cannot
   invoke is the failure this whole hunt was about.
4. **Tests:** the transform injects from the environment with no `fetch` in the path; a runtime that
   cannot mint reports it instead of proceeding; and `window.__CRUST__` still carries a token the bridge
   accepts but that cannot seed.

## Acceptance

`bun run e2e:dev:react` must pass 14/14. **Run it under `probe-run -c '…'`** — it starts a dev server and
opens a window, so it takes the screen and must give it back. That is the suite that caught this, and it
is the one to trust.

## Own

`src/vite.ts`, `src/cli/dev/**`, `src/runtime-host.ts`, `src/bridge/**` only if the mint entry needs it,
and the tests beside them. Nothing else — the rest of the fix wave is committed.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Red first**: `e2e:dev:react` failing on the current tree is the red. Paste it, then the green.
- Never `agent-desktop`, never move the cursor. Every GUI-touching command goes through `probe-run`.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

Final message under 10 lines: where the token is minted now, why the page cannot seed with it, and the
e2e result.
