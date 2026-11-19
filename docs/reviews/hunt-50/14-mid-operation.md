# hunt-50 · mid-operation state (14)

Scope: `src/plugins/shortcut*`, `src/plugins/updater*`. Read-only review. Every claim below was reproduced with a local bun script against the working tree; no source file was changed.

**Count: 4 findings** (2 high, 1 medium, 1 low). Worst is finding 1. One adjacent out-of-scope note follows the findings.

---

## 1 (worst) — `replaceBundle` is not atomic across its two renames, and it deletes the backup before the swap is known to work

- `src/plugins/updater-node.ts:145-155` — `replaceBundle(source, target, backup)`.
- `src/plugins/updater-node.ts:146` — `rm(backup, { recursive: true, force: true })` runs first, before anything proves the swap will succeed.
- `src/plugins/updater-node.ts:148` — `rename(real, backup)` moves the running bundle away.
- `src/plugins/updater-node.ts:150` — `rename(source, real)` moves the new bundle in.
- `src/plugins/updater-node.ts:151-154` — the only rollback covers a throw from line 150, and `rename(backup, real).catch(() => undefined)` swallows a failed rollback.

Three distinct mid-operation failures follow.

1. **Recovery point destroyed on a failed install.** Line 146 deletes the previous version's backup unconditionally. If line 150 then fails, the app is restored by line 152 but the backup is already gone — the user loses the last-known-good version even though nothing was replaced.
2. **App missing on interruption.** Between line 148 and line 150 there is no bundle at `target`; only `backup` holds it. If the process is quit or killed in that window (install is async and driven by a page), there is no rollback and no startup recovery — no marker, no check — so the app has no bundle at its own path until someone renames `.old` by hand.
3. **Masked rollback failure.** If line 152's restore also fails, the `.catch` drops that error and the original line-150 error is thrown. `install` reports `install-failed` while the app is actually absent from `target`.

`updater.ts:139-141` is explicit that "one rename on one volume is atomic"; the file never claims the *pair* is. `nodeUpdaterAdapter()` is the default adapter (`updater.ts:51`, `runtime-plugins.ts:64`), so this is the production path, not a test fake.

Reproduced: `target` with marker `current`, `backup` with marker `previous`, `source` pointing at a nonexistent path. `replaceBundle()` throws `ENOENT`; `target` is still `current`, but `backup` no longer exists. Finding 2 below shows the same backup loss on a normal double-call.

Reached: any failure of the second rename — source on another volume (EXDEV, despite the comment at 139-141 assuming a shared volume), source removed by an antivirus scan or a concurrent call, permission change on the bundle's parent — and any app quit/kill inside the two-rename window.

---

## 2 — The verification receipt is never consumed, so a reentrant/concurrent `install` can destroy the backup of a successful update

- `src/plugins/updater.ts:120` — `receipts.get(source)` is a pure read; the receipt is not removed, marked, or locked.
- `src/plugins/updater.ts:123-150` — every check (`isAppBundle`, `ownBundleFailure`, archive digest, tree digest) is async, so two calls can pass them all before either swaps.
- `src/plugins/updater.ts:152` — both calls then enter `replaceBundle`, itself multi-step (finding 1).
- `src/plugins/updater-receipt.ts:35-43` — `createReceipts()` is a plain `Map`; `record` overwrites by path and `get` only reads. There is no consume/invalidate operation.

Because the verified path stays usable as a receipt forever, a page can call `install` twice with the same artifact (double-click, retry, two windows). Both calls pass verification; their `replaceBundle` calls interleave. Dictating the order — first call completes, second call starts after the first has swapped — the second call re-runs line 146 and deletes the backup the first call just created, then fails at line 148 or line 150 and reports `install-failed`. The update itself is installed, but the rollback point is gone. Other interleavings make the second call roll a completed install back to the old bundle.

Reproduced: one verified download, two `install` calls with the same path, a gated `replaceBundle` that lets both through verification and runs them in sequence. Result: `A` and `B` answer `install-failed` / `ok:true`, app marker reads `new`, and `backup exists: false`.

Reached: any repeated or concurrent `install` on one `createUpdaterPlugin` instance; the runtime creates one updater plugin per app (`runtime-plugins.ts:64`), so all pages share the receipt map.

---

## 3 — A single mutable `sink` is written at the top of every shortcut command, so a failed or unrelated command reroutes another page's live hot key

- `src/plugins/shortcuts.ts:88-90` — one `sink` holds the emit channel, and every press calls `sink?.("shortcut", { accelerator })`.
- `src/plugins/shortcuts.ts:108` — `register` assigns `sink = ctx.emit` before `parse` (line 109) and before the adapter call (line 118). A bad accelerator (return at 110) or a native failure still flips the channel.
- `src/plugins/shortcuts.ts:124` — `unregister` assigns `sink = ctx.emit` before the `live.has` check (line 127) and adapter call (line 134). A `not-registered` or `native-failed` refusal still flips it.
- `src/plugins/shortcuts.ts:148` — `unregisterAll` does the same before calling the adapter.

There is no per-accelerator owner: all registered hot keys fire into whichever context called a command most recently. Two webviews can each register a key; the second registration, or merely a *failed* command from the second page, silently redirects the first page's hot key to the second page. Page A then never receives presses for a key it registered and still sees in `list()`/`isRegistered()`.

Reproduced: page A registers `Cmd+K`; page B calls `unregister("Cmd+Z")` (refused, not-registered); firing `command+k` delivers to B, not A. A malformed `register` from B does the same.

Reached: any multi-window app where two webviews use `crust:shortcut`, or any page that calls `register`/`unregister` with invalid input while another page owns a live hot key. The comment at `shortcuts.ts:85-88` treats the channel as uniquely determined by "the most recent command", which is exactly the assumption that breaks when more than one page is live.

---

## 4 — `dispose()` detaches the press channel but leaves OS hot keys and the registry intact, and permits further registrations into a dead channel

- `src/plugins/shortcuts.ts:163-171` — `dispose()` sets `disposed`, calls `detachTrigger?.()`, and nothing else.
- `src/plugins/shortcuts.ts:106-145` — `register`/`unregister` do not check `disposed`, so they still run after disposal.
- `src/plugins/shortcuts.ts:90` — once detached, the adapter callback no longer runs, so any key registered after `dispose()` fires at the OS with no JavaScript consumer.

After disposal the keys remain in `live` (`isRegistered()` true, `list()` non-empty), remain registered in the OS (no `unregisterAll()` call), and a post-dispose `register` adds a key that can never emit. The only guard `disposed` provides is making the detach idempotent.

Reached: a consumer that calls `dispose()` during teardown while hot keys are live. The default runtime never calls it (`runtime-plugins.ts:174` creates the plugin without retaining a disposer), so impact is limited to the exposed API.

---

## Adjacent, out of scope (not counted)

`src/plugins/shortcuts.ts:134-142` keeps a key in `live` after `adapter.unregister()` returns `false` so a retry reaches the OS again, with the comment "the OS still has the hot key". The real adapter violates that assumption: `src/platform/darwin/shortcuts.ts:149-159` deletes `ids`/`byId` at lines 152-153 *before* calling `shortcut_unregister` at 155. A native refusal therefore leaves the OS hot key registered but unmapped; every later `adapter.unregister` returns `false` at line 151, so the plugin retries forever and the key can never be removed. `shortcuts-native-failure.test.ts:46-59` passes only because its fake keeps the key on a false return.

---

## Worst

Finding 1. It breaks the updater's central promise — a failed or interrupted update must leave the app runnable and keep its rollback point — and it does so on ordinary failure paths (EXDEV, a source removed mid-install) as well as a narrow crash window. Finding 2 is the same backup loss triggered by an ordinary double-click and is proven with a deterministic repro, so it is a close second; findings 3 and 4 misroute or leak a single capability rather than endanger the installed app. Fix for 1: do not delete `backup` until the new bundle is in place (park the old bundle at a staging name, rename source to target, then move the old one to `backup`), and add a startup recovery check for the app-missing state.
