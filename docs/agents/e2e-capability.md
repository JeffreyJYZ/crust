# e2e-capability

Lane B2 of fix-wave-2. Proves the F1 capability binding end to end, in a real
browser against a real bridge, from the page's own script.

## Files owned

- `scripts/e2e-capability.ts` — harness, assertions, focus hand-back.
- `scripts/capability/fixture.ts` — bridge, two grants, the page probe source.
- `scripts/capability/browser.ts` — async agent-browser wrapper.
- `package.json` — one line, `e2e:capability`. Not in the default gate or `test`.
- This file.

## Why a browser, not a native window

On darwin the content world owns the token and scrubs `?token=` from the page
URL (`src/platform/darwin/content-world-source.ts`), so a native page cannot
put a chosen `window` in the invoke body — `window.crustInvoke` always sends
the bridge-served label. The spoof vector exists where the page holds its own
token: Linux/Windows/Vite and any plain browser loading a bridge-served
document. So the e2e starts a real `startBridge`, navigates agent-browser (real
Chrome) to `/?token=<process>&window=A|B`, follows the document route's 302 to
a fresh per-document token, and evaluates page JS that reads its own
`location.search` token and POSTs a body claiming `window: "B"`.

## What it asserts

A holds `test:echo`, B holds `test:secret`. Both pages send the same spoofed
body (`command: "secret"`, `window: "B"`); only the token differs.

- `A spoof refused`: 403 + `forbidden` — the load-bearing claim.
- `B spoof allowed`: 200 — the same body is legitimate for B's token.
- `A own allowed`, `B own allowed`: 200 — neither page is simply broken.
- `page A/B identity`, `distinct documents`: two real documents, two tokens.

## Prove command

`probe-run -c 'bun run e2e:capability'` — 8/8 PASS, ~4 s. `probe-run` hands
focus back; the script also captures/restores the frontmost app in a `finally`.

## Revert proof (the negative)

Temporarily change `src/bridge/server/invoke.ts:61` from
`capabilities.allows(authority, candidate)` to `capabilities.allows(routing,
candidate)` — i.e. authorise on the body-supplied label. The same e2e then
reports `FAIL A spoof refused  A claiming B:secret -> 200 undefined`, 1 of 8
assertions red. Restoring the exact bytes returns it to 8/8 PASS. The temporary
edit was done by a script that restores the original text in `finally`;
`git diff -- src/bridge/server/invoke.ts` is empty afterwards. Do not leave
that line changed.

## Traps

- agent-browser must be spawned **async**: the bridge shares the event loop, so
  `Bun.spawnSync` blocks the page's invoke and hangs the run.
- The CLI's first launch can answer EAGAIN ("Resource temporarily unavailable")
  — retry it; that is startup, not a failed proof.
- Use a private session (`capability-<pid>`) and close only that session; never
  `close --all` while other lanes run.
- `eval` returns JSON on stdout; a launch notice goes to stderr. Parse from the
  first `{` on stdout.
- Open the page with the process token in `?token=`; the bridge redirects to a
  document token. Navigating straight to the bare origin is a 401.
