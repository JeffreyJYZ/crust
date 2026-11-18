# fix-failure-status (wave 2, lane X1)

Chose the transport option from `docs/reviews/fix-wave-2/BRIEF-6.md`: a command result shaped `{ ok: false, code }` now answers a non-200 status, while the body and the page client stay byte-identical.

- Why not the client-throw option: `rg -n 'await window\.crust\.invoke\("(window|tray)"' site` shows many fire-and-forget callers. Throwing would give them a new unhandled rejection, violating the brief's "must not break a caller that ignores the result today".
- `isCrustInvokeError` (`src/bridge/client/error.ts`) stays the guard for real rejections only. These values are results, so nothing new is thrown and the guard is untouched.
- `src/bridge/server/failure-status.ts` maps plugin codes through `statusForCode` from `src/bridge/errors.ts`: invalid-* → 400, unknown-window/destroyed → 404, unknown-adapter → 501, handler-error → 500, unmapped → 400.
- `src/bridge/server/invoke.ts` calls `resultStatus(result)` on both the binary and JSON success paths. The `{ ok: true, result }` envelope is unchanged.
- `notImplemented` is converted to a 501 rejection in `createRunner` before this runs (`src/plugins/define.ts:64-71`), so it never double-maps.
- Proof: `bun test src/bridge/server/failure-status.test.ts` 3 pass; a refused `window.close` is 404 at the transport while the client still resolves `{ ok: false, code: "unknown-window" }`.
- Gates: `bun check` clean, `bun run check:lines` PASS, `bun run test` 1821 pass / 0 fail (sibling lanes added tests during the run), `bun run site:build` and `bun run check:links` PASS.
- Left alone, reported not fixed: `site/app/docs/reference/errors/page.mdx:52` still says window/tray failures answer inside a 200; it is outside this lane's file list.
