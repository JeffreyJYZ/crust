# Outside input — `src/plugins/os*`, `opener*`, `deep-link*`, `single-instance*`

Read-only hunt. Scope: the four plugin families plus the seams that feed them untrusted input —
the page's `invoke` path, argv/OS-delivered URLs, and the on-disk lock file.

**Count: 3 findings** (1 high, 2 medium). Trust model: a page in the webview is untrusted input;
with no `security.capabilities` config every registered plugin is callable and every action is
granted (`src/runtime-shim.ts:39`, `src/bridge/server/capabilities.ts:81`).

**Worst: F1 — the page can raise any running GUI app by pid through `single-instance.activate`.**

---

## F1 (high, worst) — `activate` takes a page-supplied pid with no binding to the lock holder

- `src/plugins/single-instance.ts:96` — the command is `activate: (args) => activate(options.adapter, args?.pid)`. `args` is the raw invoke body from the bridge.
- `src/plugins/single-instance.ts:56-73` — `activate()` calls `checkPid(rawPid)`, then passes that pid straight to `adapter.activate(pid)` at line 67. No check that the pid is the process holding this app's lock.
- `src/plugins/single-instance-lock.ts:53-58` — `checkPid` validates only shape and range (`integer in 1..MAX_PID`); it is not an authorization check.
- `src/platform/darwin/single.ts:67-75` — the adapter forwards the pid to `shim_single_activate(pid)` over `bun:ffi` (line 71), which calls `NSRunningApplication -activateWithOptions:`.
- `src/runtime.ts:78` — `single.plugin` is in the page-facing handler list; `src/runtime-shim.ts:39` selects all plugins when config names none, and `src/bridge/server/capabilities.ts:81` leaves all actions granted.

**Reached:** a page calls `window.crust.invoke("single-instance", "activate", { pid: <any live pid> })`. The bridge resolves `single-instance.activate`, checks the open capabilities, and runs the handler; the pid reaches AppKit and foregrounds/raises that application. No local process, prompt, or lock-holder check stands between the page and the native call. The only legitimate caller is `src/runtime-single.ts:132`, which passes the pid from `acquire` — the page-callable form removes that boundary. Impact: a page (or any local process holding the loopback token) can bring arbitrary apps to the front — an attention/Phishing surface and a way to disrupt another app's UI. It also returns the adapter's `status`/`reason` to the page, giving a live/dead oracle for arbitrary pids.

---

## F2 (medium) — the registered-scheme check on deep links is dead code in the real app

- `src/plugins/deep-link.ts:72-73` — `scheme` is only set when `createDeepLink({ scheme })` is passed one; `validateScheme` runs only in that branch.
- `src/plugins/deep-link.ts:112` — the exported default is `createDeepLink()` with **no options**, so `scheme === undefined` in production.
- `src/plugins/deep-link.ts:78-82` — the refusal `target.scheme !== scheme` is guarded by `scheme !== undefined`, so it never fires for the default instance.
- `src/config/types.ts:65` and `src/packaging/plist.ts:92-94` — `build.urlScheme` is written into `Info.plist` at build time but never passed to the runtime plugin; `rg` finds `createDeepLink(` called with a scheme only in tests.
- `src/plugins/deep-link.test.ts:109` — the intended behaviour ("a URL for another scheme is refused and leaves the held URL alone") is asserted on a hand-built `createDeepLink({ scheme: "crust" })`, an instance the app never constructs.

**Reached:** `src/app.ts:151-154` takes the launch URL from `takeLaunchUrl()` — which scans `process.argv` for the first RFC-3986-scheme argument (`src/platform/darwin/deep-link.ts:105-108`, `src/platform/darwin/shim/95_deeplink.c:139-147`) — and calls `deepLink.launch(launched)`. With no scheme configured, `accept()` stores the raw URL as `current` (`src/plugins/deep-link.ts:84`) and emits `deep-link` with `{ url }` to every page (line 85). Any external app or launch argument that routes/masquerades as a URL therefore injects an arbitrary deep-link payload into the page; a page trusting the `deep-link` event cannot tell it from the app's own scheme. `parseDeepLink`'s `query` is a plain object (`src/plugins/deep-link.ts:62-63`), so a `__proto__` key in the injected URL is silently swallowed by the setter rather than kept — a separate parsing wart, not the main risk.

---

## F3 (medium) — `acquire`/`release` are page-callable with an untrusted id, so the app's own lock can be tampered with

- `src/plugins/single-instance.ts:94-95` — `acquire: (args) => acquire(dir, args?.id, ...)` and `release: (args) => release(dir, args?.id)` pass the raw invoke body to the lock-file layer.
- `src/plugins/single-instance-lock.ts:43-51` — `lockPath` only rejects empty ids, `.`/`..`, and `/`/`\`; no check that the id is the app's own. It also does not reject an embedded NUL: `join(dir, `${id}.lock`)` yields a path that makes `writeFileSync`/`unlinkSync` throw `ERR_INVALID_ARG_VALUE` (a handler error, not a root escape).
- `src/plugins/single-instance-lock.ts:149-158` — `release` deletes any lock whose holder is dead or is this process; a page can drop the app's own lock while it is running.
- `src/runtime.ts:78`, `src/runtime-shim.ts:39`, `src/bridge/server/capabilities.ts:81` — same reachability as F1.

**Reached:** a page calls `invoke("single-instance", "release", { id: "<this app id>" })` and the live owner's lock is removed, so a later launch can start a second copy; `acquire` with a chosen id plants arbitrary lock files in the app-support dir. The id is "outside" input with no authorization tying it to the app identity. Lower impact than F1 (local integrity/availability of single-instance, not a cross-app action).

---

## Boundary notes (not counted)

- `src/plugins/opener.ts:150` + `src/platform/darwin/opener.ts:148-149` — `openUrl` checks only that a scheme prefix exists and the darwin adapter explicitly lets "any scheme" through. That is the plugin's documented purpose (`opener.test.ts:144` asserts it), so it is a capability grant decision, not a defect in this code.
- `os.ts` commands take no page input; `paths()` derives from trusted adapter/`homedir()` values (`src/plugins/logging.ts:100-105`).
- `takePendingUrl()` (`src/platform/darwin/deep-link.ts:109-113`) is never called by the runtime, so later OS-delivered URLs are recorded but never emitted; a functional gap, outside the trust focus.
