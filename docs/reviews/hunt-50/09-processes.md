# hunt-50 · processes and files nobody closes (09)

Scope: `src/plugins/shell*`, `src/plugins/sidecar*`, `src/plugins/downloads*`. Read-only review.

**Count: 5 findings** (1 high, 2 medium, 2 low). Worst is finding 1.

---

## 1 (worst) — `shell.output` can hang forever when a descendant holds a pipe open

- `src/plugins/shell.ts:123` — `if (finished(record.child)) await record.drained;`
- `src/plugins/shell-stream.ts:67-81` — `drain()` loops on `reader.read()` and never `releaseLock()`/`cancel()`s the reader.

`drained` is `Promise.all` of two `drain()` calls on stdout and stderr (`shell.ts:108-111`). A stream read returns `done: true` only when every writer of the pipe closes. If the direct child exits but leaves a descendant process holding fd 1 or 2 open, `finished()` flips true while the pipes stay open, so neither drain settles and `drained` never resolves. `output()` awaits it unconditionally in that state, so the page's invoke never returns. The reader lock, decoder, line ring and `emit` closure stay retained; `prune` (`shell.ts:75-80`) can drop the map record after `MAX_RECORDS` spawns but does not cancel the drain, so the promise/reader leak outlives the record too.

Reached: page calls `shell.spawn` for an allowlisted program that forks/backgrounds a helper inheriting stdout (the normal shape of a daemon or a tool that spawns work), the parent exits, then the page calls `shell.output({ id })` — that call never settles.

---

## 2 — `shell.kill` has no SIGKILL escalation, so a SIGTERM-ignoring child is never closed

- `src/plugins/shell.ts:176` — `record.child.kill()` (Bun defaults to SIGTERM; no grace timer).
- Contrast `src/plugins/sidecar-commands.ts:106-114`, which escalates to SIGKILL.

A child that traps or ignores SIGTERM survives `shell.kill`. `finished()` keeps returning false, so it stays in `processes`, `shell.list` keeps listing it, and its stdout/stderr pipes plus `drained` promise stay open for the app's whole life. Because `finished()` is false, `output()` does not even await the drain — it silently returns partial output while the process is still alive, hiding the leak.

Reached: host allowlists a program that can ignore SIGTERM (an interpreter such as `python`/`node`, or a custom tool); page spawns it with args that ignore SIGTERM, then calls `shell.kill` — the process remains live and unkillable through this API.

---

## 3 — sidecar stdout/stderr readers are never released after exit

- `src/plugins/sidecar-process.ts:28` — `const reader = stream.getReader();` with no `releaseLock()` / `cancel()`.
- `src/plugins/sidecar-control.ts:82-83` — two fire-and-forget `void streamText(...).catch(...)` calls.

`streamText` holds a reader on each pipe until `done`. The exit handler (`sidecar-control.ts:88-101`) only deletes the registry record and clears the kill timer; it never cancels the two readers. If a sidecar leaves a descendant holding the pipes open (sidecars are daemons by design), both `streamText` promises stay blocked on `reader.read()` forever, each retaining a locked reader, a `TextDecoder`, the `ctx.emit` closure and a pending promise.

Reached: spawn a declared sidecar that backgrounds a helper inheriting stdout/stderr, then let it exit or call `sidecar.kill` — the `sidecar-exit` event fires and the record is removed, but the readers remain stuck.

---

## 4 — repeated `sidecar.kill` overwrites the kill timer without clearing it

- `src/plugins/sidecar-commands.ts:106` — `live.killTimer = setTimeout(...)`.
- Field declared at `sidecar-commands.ts:28`; cleared only in `sidecar-control.ts:85` (`finish()`).

Each `kill()` replaces `live.killTimer` without clearing the previous handle, and `finish()` clears only the last one. Earlier timers stay pending until the grace elapses (default `KILL_GRACE_MS = 2000`, `sidecar-process.ts:8`), then fire and no-op on `running.has(live.id) === false`. Functionally harmless once the child exits, but every extra kill leaks a timer that outlives the child for up to the grace period.

Reached: page calls `sidecar.kill({ id })` more than once on a child that ignores SIGTERM, before it finally dies.

---

## 5 — downloads entries are never pruned; settled downloads accumulate

- `src/plugins/downloads.ts:37` — `const entries = new Map<string, DownloadEntry>();`
- `src/plugins/downloads.ts:111` — `entries.set(id, entry);` with no `delete` anywhere in the file.
- `src/plugins/downloads.ts:72-84` — `list` returns every entry, regardless of status.

Every `start` permanently adds an entry. `finished`/`failed`/`cancelled` entries are never removed, so `list` returns the entire growing history and its payload grows with each download. Late native events for settled ids are ignored (`:56`), but the entry itself is still kept forever.

Reached: a long-lived app starts many downloads; `entries` and the `download:list` response grow without bound.

---

## Worst

Finding 1. It is the only one that turns a leaked resource into a command that never resolves: `shell.output` blocks on a `drained` promise that can never settle when a descendant keeps a pipe open. The reader lock and promise leak permanently, `prune` does not cancel them, and the page's invoke hangs with no timeout in the plugin.
