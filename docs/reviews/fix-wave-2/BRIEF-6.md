# The last two items the hunt left open

Same shared rules as `docs/reviews/fix-wave-2/BRIEF.md`. One tree, `rg`/`fd`, foreground builds,
200-line cap (split, never trim), never `bun fmt` without a path list, only your own files.

**Hand focus back when you finish.** If anything in your run launched or activated a GUI app, capture
the frontmost app *before* you start
(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`)
and restore that same app afterwards; fall back to `open -a Ghostty` only if the capture failed.

## Lane X1 — `fix-failure-status`

`docs/reviews/next-wave/api-design.md` item 5, and the last thing that lane was forbidden from doing:

> window/tray failures resolve `{ ok: false }` inside HTTP 200.

So a page cannot tell a refusal from a success without reading the body, and an `await` that only
checks the transport sees nothing wrong. The bridge already has real codes — `WindowErrorCode` in
`src/plugins/window-types.ts` is a typed union, and `errorResponse` in `src/bridge/server/http.ts`
already maps a `CrustError` to a status.

Decide and implement one answer, then document it:

- A returned `{ ok: false, code }` from a plugin command becomes a non-200 response with that code in
  the body, mapped the way `CrustError` already is; or
- the bridge keeps 200 and the client turns `{ ok: false }` into a throw, so `await window.close()`
  rejects instead of resolving a failure.

Read `src/bridge/client/invoke.ts` and `src/bridge/client/error.ts` first — L10 just added
`isCrustInvokeError`, and the answer must not fight it. Whichever you choose, it must not break a
caller that ignores the result today; say how you kept that true.

Own: `src/bridge/server/invoke.ts`, `src/bridge/client/invoke*.ts`, `src/bridge/client/error.ts`,
`src/plugins/window-*.ts` where a result shape changes, `src/plugins/tray*.ts` likewise, the tests
beside them, and a paragraph in `site/app/docs/guides/permissions/page.mdx` or
`site/app/docs/reference/api/page.mdx` (whichever already explains error handling).

Prove: a test that a refused window command is distinguishable from a successful one at the transport
level *or* rejects at the client; and the existing 1817-test suite still passes, which is the
compatibility proof.

## Lane X2 — `linux-keychain`

`docs/reviews/next-wave/platform-gaps.md` said libsecret needs a keyring daemon and a GLib main loop,
so it is a project rather than a binding. That is a claim, and it decides whether thousands of Linux
users have a keychain or a refusal. Verify it, then pick one:

1. **Implement it** if libsecret is reachable from a `dlopen` binding without a GLib main loop —
   `secret_password_store_sync` / `secret_password_lookup_sync` are the synchronous API and may not
   need a running loop, only a session bus. The existing Linux shim already `dlopen`s GTK and
   WebKitGTK, so the pattern is there. Read `src/platform/linux/backend.ts` and
   `src/platform/linux/shim/10_prelude.c` for how a library is opened and a symbol resolved.
2. **Keep the refusal** and make it a better one: name `libsecret` and the package
   (`gnome-keyring` / `libsecret-1-0`), and say in the limits page that Linux credentials are
   file-scope only. A refusal that tells a user what to install is worth more than a vague one.

Either answer is a result. Do not start a daemon, do not touch the user's keyring.

Own: `src/platform/linux/**`, `src/plugins/keychain*.ts` only if the plugin's platform branch needs
it, `site/app/docs/limits/page.mdx`, and tests beside them. Note `src/runtime-keychain.ts` decides
which adapter exists — read it, and if a third arm is needed it is yours.

Prove: if you implement, a test that the adapter resolves its symbols and refuses cleanly when the
library is absent (the absence path is testable here even though the success path is not). If you
keep the refusal, a test asserting the message names libsecret and the package.

## Final message

Under 12 lines. Bullets. What you chose and why, what proved it, what remains untestable here.
