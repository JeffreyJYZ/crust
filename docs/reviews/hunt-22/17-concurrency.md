# 17 — concurrency

Field: queues, locks, races and ordering across `src/**`. Read-only hunt: no source file was changed.
Every finding below is labelled **measured** (probe run against the real modules) or **read**.

## High — `dropIfUnchanged` is a check-then-unlink, so two waiters can both win a stale lock

- where: `src/plugins/single-instance-lock.ts:113-122` (`dropIfUnchanged`), `:136-145`
  (`acquire` loop), `:86-95` (`take`, the `O_EXCL` create).
- mechanism: `dropIfUnchanged` reads the lock bytes, compares them to `raw`, then calls
  `unlinkSync`. The compare and the unlink are two syscalls. Waiter A and waiter B both read the
  dead pid's bytes. A unlinks and `take()` writes a fresh live lock. B's `unlinkSync` then runs
  against the *new* file — it never re-reads — and removes A's live lock. B's `take()` succeeds.
  Both return `acquired: true`. The top-of-file claim ("a takeover never unlinks a lock whose
  bytes changed since they were read") is true for the read but not for the unlink.
- gap in coverage: `src/plugins/single-instance-stale.test.ts:29-49` injects `beforeTakeover`
  **before** `dropIfUnchanged` reads, so it proves only that a replacement already on disk is
  respected. The read→unlink window is untested.
- reachable by: two launches racing on a stale pid file — the normal crash-then-two-shortcuts case.
  The runtime claims this lock before the platform exists (`src/runtime-single.ts:146-152`), so the
  "one running copy" guarantee is exactly what breaks.
- measured: 100 pairs of concurrent processes against a fresh stale lock (`999999`) produced one
  pair where **both** printed `ACQUIRED` (processes held 400 ms so both acquired while live).
  Sequential pairs both acquiring are expected; the double here came from concurrent overlap.
- smallest fix: make takeover atomic. A hard link to a unique temp file plus `stat().nlink === 1`
  is the usual `O_EXCL`-equivalent compare-and-win; alternatively keep a separate `flock`/lockfile
  around the pid file. Comparing bytes and then unlinking cannot be made safe by reordering.

## Medium — concurrent `stronghold.set` calls in one instance both answer `ok`, but only the first is visible

- where: `src/plugins/stronghold.ts:102-133` (`set`), `:153-176` (`delete`); specifically
  `const active = session` at `:103`/`:154` and `if (session === active)` at `:127`/`:170`.
- mechanism: `withFileLock` serialises the file write, but `active` is captured **before** the
  lock. Suppose two `set` calls in the same plugin instance:
  1. Both capture the same `session` snapshot `S0` before either enters the queue.
  2. A's turn: `reloadFile`, write file with A's entry, `session === active` (`S0 === S0`) →
     `session = S1`.
  3. B's turn: `reloadFile` reads the file A just wrote, writes the file with **both** entries, but
     `session === active` is now `S1 !== S0` → B does **not** update `session`.
  Disk holds both secrets; the instance's cached snapshot stays at `S1`, which lacks B's entry.
  The `active` identity check was added to stop a concurrent `close` from being undone — it also
  drops any queued commit whose predecessor landed first.
- reachable by: a page doing `Promise.all([crust.invoke("stronghold", "set", …), …])` on the same
  instance, or two bridge requests that overlap while a PBKDF2/seal is in flight. The bridge does
  not serialise invokes (`src/bridge/server/invoke.ts:53-94`).
- measured: one instance, `open("pw")`, then `Promise.all([set alpha, set beta])`. Both sets
  answered `{ ok: true }`; disk had 2 entries; `get("beta")` answered `not-found`, `keys()`
  answered `["alpha"]`. The same shape applies to two concurrent `delete`s of different keys —
  the second file write lands but the second deletion is invisible to the instance.
- smallest fix: update the session whenever this call wrote a file derived from the file it just
  reloaded, not only when the identity is unchanged. Capture a generation counter (bump on
  `open`/`close`) and compare that, or always assign `session = { file, keys: active.keys }` when
  the header still matches; a `close` that landed mid-write is detectable by a separate flag.

## Medium — one lifecycle drain interleaves async listeners across different events

- where: `src/app-watch.ts:166-179` (`for (const event of events)` with `void emit(listeners, event)`
  at `:171`), `src/app-loop.ts:110-118` (`emit` awaits each listener in turn),
  `src/platform/darwin/lifecycle.ts:43-53` (a bitmask decode can return several events in one
  `take()`).
- mechanism: a single native drain can return `["before-quit", "will-quit", "reopen"]`. The loop
  calls `emit(...)` for each and discards the promise, so each `emit` runs synchronously only up to
  its first `await listener()`. The next event's first listener therefore starts before the
  previous event's later listeners (or even its first listener's async tail) finish. The comment at
  `app-watch.ts:58-60` promises a page and backend "never see different events, or different
  order"; the backend half of that promise fails when listeners are async. `finishQuit`
  (`src/app-quit.ts:21-22`) sequences the two quit events correctly, but a native drain bypasses it.
- reachable by: any app whose `app.on("before-quit")` listener is async (the shipped save-on-quit
  template) while a `will-quit` listener reads what it saved. Both bits are commonly recorded in
  one delegate callback.
- measured: fake source yielding `["before-quit", "will-quit"]` once, with a 10 ms delay in each
  listener, produced:
  `before-1-start | will-1-start | before-1-end | before-2-start | will-1-end | before-2-end`.
  The second `before-quit` listener ran after `will-quit` had already started.
- smallest fix: chain the drains, e.g. keep a module-local `tail = Promise.resolve()` and
  `tail = tail.then(() => emit(listeners, event)).catch(...)`, with the `settle` for
  `before-quit` in that same chain. Page publication can stay synchronous.

## Read-only observation (not reproduced)

- `src/plugins/store-scope.ts:47-53` — `loaded()` is an unsynchronised check-then-act on the shared
  `entries` cache (`if (this.entries !== undefined) return`, then `this.entries = read.entries`
  after `readStore`). `mutate()` writes the same field under `withFileLock` at `:77`. A `get`
  issued concurrently with a `set` in the same scope can have its slower disk read finish after
  the commit and overwrite the fresh cache with the old snapshot, so later `get`/`keys` keep
  answering stale values. **Not reproduced**: 90 concurrent rounds (60 with one reader, 30 with
  200 readers per write) all ended with cache matching disk. Reported as a code-level hazard only;
  the `mutate` path itself is correctly serialised by `src/plugins/store-file.ts:24-37`.
