# api-design lane memory

Traps found on the developer-facing surface, worth keeping across sessions. Evidence lives in
`docs/reviews/next-wave/api-design.md`; re-check line numbers before quoting them.

- **App commands are gated as `app:invoke`, never by their own name.** `app.command` and `typedHost`
  register commands that travel through the `app` namespace plugin; the bridge reads the action from
  that wire key, so `security.capabilities` actions like `notes:*` cover nothing. Granting
  `app:invoke` grants every app command at once. The permissions/typed-IPC/config docs omit this;
  only the templates teach it. A developer who opts into capabilities and adds a typed command gets
  an unexplained `forbidden`.
- **`App.invoke` is a different call path from the bridge.** It passes no `ctx`, does not convert
  thrown errors to `CrustError`, and does not turn a `notImplemented()` return value into a
  `not-implemented` failure — the handler's `{ ok: false }` object comes back as resolved data.
  The bridge path (`createRunner`) does all three. Error and not-implemented shapes therefore depend
  on whether the call came from the page or from `main.ts`.
- **`define.ts` has two "not implemented" channels.** `notImplemented()` returns a value;
  `NotImplementedError` throws. Plugins use both. `isNotImplemented` is the only thing that tells a
  caller which form a command used; over the bridge both become a 501 rejection, in-process neither
  does.
- **The config reference is not a complete key list.** `windows[].minHeight` and
  `windows[].material` are validated and typed but absent from the config page's windows table.
  `material` is platform-gated and refuses unsupported names, so a reader of the parity page has no
  default/allowed-set in the doc they start from.
- **Page errors have no public type or guard.** `CrustInvokeError` is declared in a page-side module
  and never re-exported from `crust`; the thrown class is named `InvokeFailure` locally, so
  `error.name` disagrees with the type. Runtime `error.code` works, but there is nothing to type a
  `catch` with.
- **Window/tray failures resolve inside HTTP 200** as `{ ok: false, code, message }`, so a
  `try/catch` around `invoke` does not see them.
- **What is already correct, do not re-raise:** CLI parse errors and config errors name the key;
  capability refusals name action, window and covering capability; the two-argument
  `invoke(name, args)` app form is a real runtime branch in `install.ts`.
