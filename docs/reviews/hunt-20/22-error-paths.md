## HIGH — Keychain `get` and `list` return truncated data after a second buffer overrun
- where: src/platform/darwin/keychain.ts:66-73 (get), :86-93 (list)
- mechanism: The shim reports the full byte length even when it had to truncate into the caller's buffer. If the value grows between the first and second `get`, the second call again returns a length larger than the buffer; instead of retrying or refusing, the code clamps with `Math.min(length, buffer.length - 1)` and returns those bytes as `{ ok: true, found: true, secret }`. `list` has the same clamp. A half secret or a half account list is reported as the complete value. All claims here are `read`, not measured.
- reachable by: Two commands race on the same service/account (two windows, or another process using the same keychain): `keychain.get` reads 8 KiB, the secret is extended past 8 KiB, the exact-size re-read lands on the old value, and the clamp returns a prefix of the new one. The caller then uses that prefix as a password or decryption key with no signal anything was cut.
- smallest fix: If the second call still reports `length > buffer.length - 1` (get) or `> buffer.length` (list), retry with a fresh size or return a typed refusal such as `handler-error: "value changed during read"`; never hand back clamped bytes as the full answer.

## MEDIUM — Corrupt-store quarantine reports `recovered` when the rename failed
- where: src/plugins/store-file.ts:49-51, src/plugins/store-scope.ts:47-52 and :56-63
- mechanism: `readStore` does `await rename(file, corrupt).catch(() => undefined)` and returns `{ entries: {}, corrupt }` unconditionally. `StoreScope.loaded()` stores that path and `answer()` emits `recovered: <path>` once. If the rename failed, the page is told the corrupt bytes were moved aside when they were not; the next `persist` renames a temp file over the original path and destroys them. `read`.
- reachable by: A store whose top-level JSON is invalid plus a rename that fails — for example `store.json.corrupt` already exists as a directory, or the data dir became read-only. The first answer says `recovered: …/store.json.corrupt`, and the first later `store.set` overwrites `store.json`, so the original bytes can no longer be recovered by hand.
- smallest fix: Set `corrupt` only on a successful rename; on failure either leave the file in place and surface a `handler-error` naming the path and the rename reason, or return no `recovered` field so the page is not told a move happened.

## MEDIUM — `shell.kill` answers `killed: true` on signal delivery, not on exit
- where: src/plugins/shell.ts:169-177
- mechanism: The handler calls `record.child.kill()` (SIGTERM) and returns `{ ok: true, killed: true }` without inspecting the return value or waiting for `exitCode`/`signalCode`. There is no escalation to SIGKILL. A process that traps or ignores SIGTERM stays in `processes`, so `shell.list` still lists it, but every `shell.kill` keeps reporting `killed: true`. The sidecar plugin does implement the escalation (`sidecar-commands.ts:104-114`), so the behaviour is inconsistent. `read`.
- reachable by: An allowlisted program that installs a SIGTERM handler (a shell wrapper with `trap '' TERM`, a runtime with a shutdown hook). `shell.spawn` succeeds, `shell.kill` answers `killed: true`, and a subsequent `shell.list` still contains the id; the page has no API path that actually stops the child.
- smallest fix: Wait a bounded grace for `finished(record.child)`, escalate to SIGKILL if still alive, and base `killed` on the observed exit — or rename the field to `signalled` and document that no exit was confirmed.

## MEDIUM — Updater rollback failure is swallowed; the error names only the first cause
- where: src/plugins/updater-node.ts:145-154
- mechanism: `replaceBundle` renames the live bundle to `backup`, then renames `source` into place. If the forward rename throws, the rollback `rename(backup, real).catch(() => undefined)` is discarded and the original error is thrown alone. The page is told only that a rename failed, with no mention that the installed app is now absent from `real` and present only at `backup`. `read`.
- reachable by: Any fault on the forward rename that does not also clear the rollback — a transient EXDEV, permission change, or the target path becoming occupied. The first failure must occur between the two renames; the rolled-back-to state then cannot be restored automatically and needs a manual rename the user was never told about.
- smallest fix: Await the rollback and, if it also fails, throw an error naming both failures and the backup path so recovery is possible; report success only when `real` exists again.

## LOW — `ready` never settles when the event stream cannot be opened and no invoke is made
- where: src/bridge/client/install.ts:42-52, src/bridge/client/invoke.ts:176-194
- mechanism: `ready` is a Promise whose only resolvers are `markHandshake()` on a completed invoke response or a `crust:ready` event frame. `connect()` returns silently when `EventSource` is absent or its constructor throws (`catch { return; }`), and `stream.onerror = () => {}` discards later transport failures. Nothing rejects or times out `ready`. `read`.
- reachable by: A page that only does `await crust.ready()` in a WebView or older browser with no `EventSource`, and never calls `crust.invoke`; the promise stays pending for the life of the page with no error anywhere. The comment at invoke.ts:177-178 assumes something always wants the handshake frame, but `ready()` itself does not arrange that.
- smallest fix: When `EventSource` is unavailable or the constructor throws, settle `ready` with a typed failure (or resolve it with a "no stream" status the page can branch on), and surface stream errors instead of assigning an empty `onerror`.

## LOW — Token-scrub failure in the content world is swallowed
- where: src/platform/darwin/content-world-source.ts:24-30
- mechanism: The isolated world reads the bridge token from `location.search`, then tries `history.replaceState` so page script cannot read it. The whole scrub is inside `try { … } catch (error) {}` with no report. If `replaceState` throws, the credential stays in the shared URL and the page-world client's stated security boundary no longer holds. `read`.
- reachable by: Any throw from `replaceState` at document start (for example a WebKit SecurityError). I could not prove a concrete trigger on the bridge's own loopback origin, so this is a low-confidence finding rather than a demonstrated exploit — but the empty catch also guarantees the failure is unobservable, so a field report could not diagnose it.
- smallest fix: On failure, keep the token out of page reach by refusing to hand control to the page (navigate away or report the fault); at minimum emit a diagnostic event so the failure is not silent.

## Checked and clean
- Bridge error mapping (`src/bridge/errors.ts`, `server/invoke.ts`, `server/http.ts`): handler throws keep their `code`, `status` and `requires`; non-CrustError throws become `handler-error`/500 with the original message. No error is relabelled as success. `read`.
- Typed failure HTTP status (`server/failure-status.ts`): `{ ok: false, code }` results get a non-200 while the body keeps the typed value; the `ok: true` outer envelope is intentional and documented, and both page transports check the nested result. `read`.
- `resolveAssets` (`src/cli/build/resolve-assets.ts`): non-zero `beforeBuildCommand`, an assets directory equal to the output directory, and a missing `index.html` each return `ok: false` with the specific cause; nothing packages stale bytes. `read`.
- Lifecycle listener failures (`src/app-watch.ts:59-68`, `:117-158`, `src/app.ts:162-174`): throwing page/backend listeners are named on the console and do not block quit or stop other listeners; `before-quit` `settle` is in `finally`. `read`.
- Crash guard (`src/runtime-crash-guard.ts`, `runtime-crash-store.ts`): `alive()` distinguishes EPERM from ESRCH, torn crash lines are skipped, and `clearCrashes` deliberately leaves the record the guard may still read. `read`.
- Single-instance cleanup (`src/runtime-single.ts:49-65`, `runtime.ts:172-178`): the lock is registered with a `process.once("exit")` release and an entry-import failure stops the bridge, so startup errors do not strand the lock on a normal exit. `read`.
- Cautious empties (`check-skips.ts`, `verify-cellar.ts`, `harness/*`, `runtime-crash-write.ts`, plugins' page-handler catches): these swallow only cleanup or already-reported faults, with a comment naming the reason; none converts a failed operation into a success answer. `read`.
- Not run: no build, test or e2e was executed for this hunt, so none of the above is a measured runtime observation.
