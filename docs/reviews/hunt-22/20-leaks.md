# Hunt 22 — resource leaks: processes, timers, handles, listeners

Read-only audit. No source files changed. Searches used `rg`, scoped to the repo. Three bounded probes ran from the session temp dir; none launched a GUI app or wrote into the checkout.

## Medium — `perf` overlay `destroy()` leaves its `keydown` listener on the document

- where: `src/perf/overlay/overlay.ts:154-166` (install) vs `src/perf/overlay/overlay.ts:183-187` (`destroy`)
- mechanism: `mountOverlay` calls `scope.document.addEventListener("keydown", …)` when `dev !== false`. The emitted `destroy()` stops the interval, stops the sampler and destroys the panel, but never calls `removeEventListener`. The handler closes over `setVisible`, `panel`, `perf` and `sampler`, so a destroyed overlay still toggles on Cmd+Shift+P and stays reachable from the document.
- reachable by: measured with a fake document (`addEventListener` / `removeEventListener` counters), `dev: true`, `interval` and `clearInterval` injected: mount + `destroy()` produced `addEventListener=1 removeEventListener=0`. `src/perf/overlay/overlay.test.ts:148-169` asserts the chord works but its fake document has no `removeEventListener`, so the gap is untested.
- smallest fix: keep the handler and document in locals, call `document.removeEventListener("keydown", handler)` in `destroy()`, and extend the chord test to assert removal.

## Medium — `runCommand` returns with grace/deadline timers still armed

- where: `src/cli/perf/command.ts:42-44` (`delay`), `src/cli/perf/command.ts:89-94` (deadline), `src/cli/perf/command.ts:100,103,107` (grace, post-kill wait, flush wait)
- mechanism: `delay(ms)` creates a `setTimeout`. Each `Promise.race([... , delay(ms)])` settles on the other promise, but nothing clears the losing timer. On the timeout path three timers (grace, 2 s, 500 ms) remain on the event loop after `runCommand` resolves, keeping the CLI process alive.
- reachable by: measured — `runCommand` on a child that sleeps 10 s with `timeoutMs: 100, graceMs: 500` returned in 102 ms with `ended=timeout`, but the probe process took 2.12 s to exit. Normal commands leave the 500 ms flush timer behind too.
- smallest fix: store each delay handle, clear it in a `finally` after its race, or `unref()` the timeout so it cannot hold the process open.

## Low — `crust.listen()` unsubscribe does not detach the event from the transport

- where: `src/bridge/client/install.ts:121-131` (`listen`), `src/bridge/client/invoke.ts:163-176` (`attach`/`bound`), `src/bridge/client/invoke-half.ts:9-15` (contract: only `attach` and `connect`)
- mechanism: `listen()`'s returned function deletes the page handler from `listeners` but never tells the invoke half. `half.attach(event)` adds one `EventSource` (or content-world DOM) listener per event name and marks it in `asked`; there is no `detach`. After the last page listener unsubscribes, the transport listener stays, still receives every frame for that event and closes over `onEvent`. Names come from page input, so a page that listens on many distinct names grows the listener set for the page's lifetime.
- reachable by: read — no `detach`/`removeEventListener` exists anywhere in `install.ts`, `invoke.ts` or `invoke-half.ts`. Not runtime-probed.
- smallest fix: add `detach(event)` to `InvokeHalf`, remove the bound listener from `stream` (or stop relaying that name in the content world), clear `asked[event]`, and call it when a listener set becomes empty.

## Low — database handles have no cap and no quit/dev-restart reaping

- where: `src/plugins/database.ts:68-75` (`handleOf`), `src/plugins/database.ts:108-114` (only `close` deletes), `src/runtime-data-plugins.ts:19`
- mechanism: every `database.open` creates a `bun:sqlite` `Database` and stores it in `open`; only an explicit `database.close` removes it. Unlike `shell`, `pty`, `sidecar` and the crash guard, the plugin does not use `child-reap` or an exit hook, and `MAX_RECORDS`-style pruning is absent. Handles left open by a page stay in the map and hold SQLite file descriptors until the process exits.
- reachable by: read — `rg` over `src` found no caller of `commands.close` outside the command itself and no bridge-stop cleanup.
- smallest fix: bound handles per database name (close or refuse the oldest) and register a process-exit/bridge-stop cleanup that calls `db.close()` for every remaining handle.

## Low — dev CLI signal handlers survive a normal return

- where: `src/cli/dev/runtime.ts:118-119` and `src/cli/dev/single.ts:97-98` (register), `src/cli/dev/runtime.ts:129-134` and `src/cli/dev/single.ts:100-103` (normal returns)
- mechanism: both runners install `process.once("SIGINT", stop)` / `SIGTERM` and never remove them. When the child exits cleanly and the function returns, the handlers remain registered for the life of the process, retaining `stop`, the watcher, the child handle and (in `runtime.ts`) the temp frame directory. A later signal runs `stop()` again against already-closed watchers and an exited child.
- reachable by: read — neither normal-return path calls `process.removeListener`; the only cleanup is inside `stop` itself. Impact is bounded (two handlers per run) and disappears when the CLI exits.
- smallest fix: capture the two handler functions and remove them in a shared `finish()` used by both the clean-exit path and the signal path.

## Low — repeated `sidecar.kill` overwrites the grace timer without clearing the old one

- where: `src/plugins/sidecar-commands.ts:114-128`, `src/plugins/sidecar-control.ts:88-91` (`finish`)
- mechanism: `kill` assigns `live.killTimer = setTimeout(..., grace)` on every call. A second `kill` before the child exits replaces the recorded handle but leaves the first timer armed. `finish()` only clears the latest handle. Both timers fire; the first is orphaned until its grace period (default 2000 ms, `src/plugins/sidecar-process.ts:8`) expires.
- reachable by: read — no `clearTimeout(live.killTimer)` precedes the assignment; the existing clear is in the departed-child early return (`sidecar-commands.ts:101`). Tests cover a single kill and kill-after-exit, not two kills before exit.
- smallest fix: `clearTimeout(live.killTimer)` before arming the new grace timer.

## Low (unproven) — `network.onChange` re-schedules the reachability observer

- where: `src/plugins/network-status.ts:77-96`, `src/platform/darwin/shim/120_network_status.c:59-64`; contrast the idempotence bit in `src/platform/darwin/shim/116_power_events.c:139-143`
- mechanism: every `network.onChange` call replaces the JS `listener` and then calls `ns_watch()`, which calls `SCNetworkReachabilitySetCallback` and `SCNetworkReachabilityScheduleWithRunLoop` again. There is no unschedule and no "already watching" guard. If Core Foundation does not treat a repeat schedule as a no-op, repeated subscriptions leave duplicate run-loop registrations and duplicate callbacks.
- reachable by: static only. This runs against real SystemConfiguration; it needs a macOS probe that counts callbacks after several `network.onChange` calls. Do not report as a confirmed leak without that measurement.
- smallest fix: add a `watching` bit in the shim (as the power shim does) so `ns_watch` installs once.

## Risk (static) — `crust dev` kills the shell wrapper, not the dev server it started

- where: `src/cli/dev.ts:132-137` (`Bun.spawn(["sh", "-c", beforeDevCommand])`), `src/cli/dev.ts:162,194` (`frontend?.kill()`); contrast `src/cli/perf/command.ts:57-64,99-103` (detached process group)
- mechanism: `frontend` is the `sh` process. Killing it need not kill a child dev server started by the shell command, which can outlive `crust dev` and keep its port and process. Confidence is limited: a shell may `exec` a simple final command, so this is not a measured orphan.
- reachable by: read only; no process probe run.
- smallest fix: spawn the command as its own process group and signal the group on every exit path (or use the shared `runCommand` group killer).

## Checked and clean

- **SSE subscriber teardown** (`src/bridge/server/events.ts:104-157`): each stream's `detached()` removes itself from both `cleanups` and `subscribers` and closes the controller; `stop()` drains the rest. The stale-cleanup leak this file documents is fixed.
- **Child process reaping** (`src/child-reap.ts:20-77`, `src/plugins/shell.ts:73-75,117`, `src/plugins/pty.ts:77-78,142`, `src/plugins/sidecar-control.ts:81-83`, `src/runtime-crash-guard.ts:123-128`): spawned children are registered, removed on their own `exited`, and signalled on exit/SIGTERM/SIGINT.
- **Platform pump timers** (`src/platform/darwin/pump.ts:41-45`, `src/platform/linux/platform.ts:69-73`, `src/platform/windows/platform.ts:109-114`): each self-rearming chain is stopped and its pending timer cleared by `stopPump()`; each platform's `quit()` calls it.
- **Watch timers are unref'd** (`src/app-watch.ts:103,181`, `src/app-loop.ts:140`, `src/plugins/window-frame-memory.ts:120,162,174-179`, `src/platform/windows/pty-conpty.ts:109-111`): lifecycle/window/frame watches cannot keep an otherwise idle process alive, and the frame memory clears both of its handles in `stop()`.
- **One-shot waiters** (`src/bridge/client/install.ts:133-159`, `src/plugins/testing-eval-queue.ts:53-85`): `once()` and the eval queue clear their timers on delivery, remove the waiter on timeout and unref where the platform allows it.
- **Power assertion** (`src/plugins/power.ts:93-99,154-167`, `src/platform/darwin/power.ts:146-164`, `src/platform/darwin/shim/116_power_events.c:132-144`): a second `sleepPrevent` reuses the held id, the darwin adapter releases on exit, and native notification observers are registered once per kind.
- **Doctor stderr pipe** (`src/cli/doctor/check.ts:13-22`): suspected deadlock from an undrained stderr pipe did not reproduce — a bounded probe with 1 MB of child stderr exited in 12 ms. Bun drains the pipe; not a finding.
- **Packaging/CLI child streams** (`src/packaging/exec.ts:19-31`, `src/cli/perf/command.ts:71-81`): both stdout and stderr are read concurrently with the exit promise, so a chatty child cannot block on a full pipe.
- **FFI library handles** (`src/platform/linux/preflight.ts:115-124`, `src/platform/windows/backend-default.ts:44-55`): `dlopen` handles are closed in `finally` / immediately after the symbol check.
- **Singleton process hooks** (`src/runtime-single.ts:55-71`, `src/runtime-host.ts:103-110`, `src/child-reap.ts:67-70`): lock-release and handshake-cleanup maps are drained by one `exit` hook; re-installation is guarded.
