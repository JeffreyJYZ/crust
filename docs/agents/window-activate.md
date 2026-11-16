# `app.activate` — the activation policy

Measured and implemented 2026-11-16. The owner's call: configurable, default `always`, because the
accessibility fix made every window create able to steal the front from another app.

## Files

- `src/config/types.ts` — `ActivateMode` (`always | first | never`) and `AppConfig.activate`.
- `src/config/validate-activate.ts` — the enum check, wired through `validate-app.ts` (an `app` key,
  so it is `APP_KEYS`, not `ROOT_KEYS`).
- `src/platform/darwin/activation.ts` — the policy, `raiseApp`, `activateApp`, `activateAppOnce`.
- `src/platform/darwin/window-create.ts` — calls `activateForWindow(mode, once, sends)` where the
  selector used to be sent unconditionally.
- `src/platform/darwin/platform.ts` — holds the mode and passes it per window; `WindowOptions` is
  unchanged, the policy travels as a third `createNativeWindow` argument.

## The rule that `first` needs

**`-[NSApplication isActive]` is false whenever the human is in another app**, so it cannot tell "no
window yet" from "the human is elsewhere". A per-window `isActive` test therefore activates on every
window created from behind another app.

Measured on a built bundle, frontmost read with `lsappinfo info -only name $(lsappinfo front)`, one
driver window whose page creates windows on timers:

```
t1.5  front=Activation crust   first window: activation lands, as the AX fix intends
t3    front=Ghostty            focus handed away, app now inactive
t8    front=Activation crust   a window created by the page → FOCUS STOLEN
```

A control run with window creation disabled showed no transition between t3 and t13, so the create
was the cause and not a WebKit timer.

So `first` uses **one module-level flag per process** (`activatedOnce` in `activation.ts`), consumed
by the first window create of the launch — not a per-window test and not a per-platform-instance
counter, because a second `DarwinPlatform` in one process is still that launch. `always` keeps the
per-window `isActive` guard; `never` sends nothing at all.

## Cost, stated in the docs

With `first`, and with `never` always, a window created while the app is inactive stays off the
active Space and out of `AXWindows` until the user clicks the app: on screen, on every Space
(`setCollectionBehavior: 257`), invisible to VoiceOver. That is the symptom the activation fix
removed, now scoped to later windows. Documented in `site/app/docs/reference/config/page.mdx` and
`site/app/docs/guides/accessibility/page.mdx`.

## Two flags, not one

`activatedOnce` decides whether a create may activate. `appActivated` decides whether `-activate` has
been sent, and is shared with `window.focus` (`platform.activateOnce()`), so switching windows does
not make the Dock icon jump. `resetActivation()` clears both and exists only as a test seam.
