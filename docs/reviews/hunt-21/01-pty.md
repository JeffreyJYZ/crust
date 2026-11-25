# Hunt 21 — pty

Field: `src/plugins/pty*.ts`, the pty parts of `src/platform/windows/*`, `scripts/e2e-pty.ts`,
`src/runtime-feature-plugins.ts`. All claims below are `read` except the one `bun -e` probe noted.
Nothing was run on Windows or Linux; no GUI, no e2e, no file edited except this report.

## Medium — Windows `pty.close` emits `pty-exit` with a fabricated exit code of 0
- where: `src/platform/windows/pty-conpty.ts:67-74,106-112`; `src/platform/windows/shim/66_pty_io.c:104-108`
- mechanism: `(read)` `close()` calls `finish()` **before** `shim_pty_close(index)`. `finish()` reads
  `shim_pty_exit_code(index)`, whose C implementation returns `slot->exit_code` — still 0 for a
  slot whose child is running (the C comment says "-1 while it runs", which the code never does).
  It resolves `exited` with 0, and only afterwards does `shim_pty_close` call
  `TerminateProcess(process, 1)`. The page therefore receives `pty-exit { exitCode: 0, signal: null }`
  for a shell that was killed. On POSIX the same path reports `signal: "SIGTERM"`, so the event is
  also cross-platform inconsistent.
- reachable by: a page with `pty:open` calls `pty.open`, then `pty.close` while the shell is still
  alive (the normal close case). Any consumer that logs or acts on the exit status is misled.
- smallest fix: have `finish()` consult `shim_pty_state(index)` (which sets `exit_code` from
  `GetExitCodeProcess`) before reading, or resolve `exited` only after `shim_pty_close` and use its
  result; make `shim_pty_exit_code` return -1 while the process is running so the adapter can map
  it to `null`.

## Medium — a naturally exited terminal is never closed or pruned; Windows keeps listing it as live
- where: `src/plugins/pty.ts:55-59,74-79,114-127,169-174`; `src/platform/windows/pty-conpty.ts:48-49,67-88`
- mechanism: `(read)` `record.closed` is set only by the `close` command (pty.ts:166). The
  `term.exited.then(...)` handler emits `pty-exit` but never marks the record, closes the terminal,
  or prunes it. `prune()` deletes only records with `record.closed === true`, so it can never
  reclaim a shell that exited on its own — the documented "64-record cap prunes it" only covers
  explicitly closed handles. On POSIX `term.closed` includes `Bun.Terminal.closed`, but on Windows
  the getter returns the local `closed` flag, which `finish()` does not set; `list()` therefore
  keeps reporting a dead Windows terminal as open, and `write`/`resize` hit a spent C slot.
- reachable by: page opens a terminal, types `exit`, never calls `pty.close`, repeats. The `terminals`
  map (and, on POSIX, the `Bun.Terminal` master fd) grows without bound, and Windows `list()` lies.
- smallest fix: in the `exited` handler set a dead flag and close the terminal, and filter/prune on
  `record.closed || record.term.closed || dead`; make the Windows `closed` getter reflect `finished`.

## Medium — no emit budget or backpressure on `pty-data`; Windows `drain()` can spin on the pump
- where: `src/plugins/pty-stream.ts:11,22-39`; `src/platform/windows/pty-conpty.ts:57-65`;
  `src/bridge/server/events.ts:82-90`
- mechanism: `(read)` `frameSink` emits one SSE frame per 8192-byte slice with no aggregate cap —
  unlike shell's 500-line ring, which is explicitly "the emit budget" (`shell-stream.ts:3,8`).
  `Events.emit` calls `controller.enqueue` on every subscriber with no desiredSize check, so a
  chatty child queues frames without bound. On Windows `drain()` loops `for(;;)` calling `shim_pty_read`
  until the ring is empty; each iteration base64s and emits synchronously on the JS thread, so a
  flood that keeps refilling the 64 KiB ring holds the event pump. The docs ("a program that floods
  the pty produces many frames rather than one unbounded event") only describe the per-frame size.
- reachable by: `pty.write({ id, data: "yes\n" })` (or any high-volume producer) with a slow or
  absent page reader, on either platform.
- smallest fix: add a per-handle credit/ring budget that drops or coalesces frames, and cap the
  number of drain iterations per tick.

## Low — Windows discards the plugin-built environment, so `TERM` is never set
- where: `src/plugins/pty-conpty.ts:31-41`; `src/platform/windows/shim/65_pty_open.c:140`
- mechanism: `(read)` `pty.ts:104` builds `{ ...process.env, TERM: "xterm-256color" }` and passes it
  as `request.env`, but `openTerminal` never forwards env to `shim_pty_open`, and `CreateProcessW`
  is called with `env = 0` (inherit). The pty guide promises the same commands and behaviour on all
  three platforms, including "with `TERM=xterm-256color`". On Windows the shell inherits the parent
  env unchanged and has no `TERM`.
- reachable by: any Windows `pty.open`; a page that checks `echo %TERM%` sees it unset.
- smallest fix: thread `request.env` through `shim_pty_open` into a UTF-16 environment block for
  `CreateProcessW`, or document the Windows divergence.

## Low — `pty.write` counts UTF-16 code units, not bytes, against the 64 KiB limit
- where: `src/plugins/pty-args.ts:89-94`; `src/plugins/pty.ts:136`
- mechanism: `measured` (`timeout 60 bun -e`, pure reader, no process spawned): `data.length` for
  40,000 CJK characters is 40000, so `readWrite` accepts it although its UTF-8 byte length is
  120000; the refusal text also says "bytes". The docs promise "data is UTF-8 text up to 64 KiB".
  A single accepted write can therefore be up to ~3x the documented byte budget (6x for astral
  pairs), and on Windows the larger `Buffer.from(data, "utf8")` is handed to `shim_pty_write`.
- reachable by: a page pasting a large multi-byte buffer in one `pty.write` call.
- smallest fix: compute `Buffer.byteLength(data, "utf8")` (or `new TextEncoder().encode(data).length`)
  and compare that to `PTY_MAX_WRITE`.

## Low — fractional terminal sizes are silently floored
- where: `src/plugins/pty-args.ts:26-41`
- mechanism: `(read)` `size()` rejects values `< 1` with "must be a positive integer" but accepts
  `80.7` and floors it to 80, while rejecting `0.9`. Both the error text and the docs ("positive
  integer") promise an integer-only input.
- reachable by: a page computing cols/rows from a fractional CSS measurement and passing it through.
- smallest fix: require `Number.isInteger(value)` before clamping.

## Checked and clean
- **Program allowlist**: `(read)` `pty.ts:88-94` compares a page's `program` with `hostShell` via
  `sameProgram`, which realpaths both forms (`pty-host.ts:15-45`); `runtime-feature-plugins.test.ts:41-45`
  and `runtime-plugins.test.ts:120,140` assert the refusal. The validated program is never used as
  the spawn command — `pty.ts:100` always passes `shell: host` — so there is no second-order
  injection through the page string. `(read)` `cstring()` appends the trailing NUL required by the
  C side (`cstring.ts:9-10`).
- **Arg readers never throw**: `(read)` `fields()` coerces non-objects to `{}` and every reader
  returns a typed `PtyFailure` with a `code` (`pty-args.ts:22-24`, `pty-types.ts:37-39`); `isPtyFailure`
  tests `code`, not `ok`, so the `{ ok: true, value }` shapes from `size()` are not misread.
- **POSIX pty mechanics**: `(read)` `pty-posix.ts:11-59` passes `Bun.Terminal` into `Bun.spawn`, so
  stdin/stdout/stderr are the pty; `exited` is the child's own promise, and the terminal's own
  `exit` callback (pty lifecycle 0/1) is deliberately not used. `close()` hangs up the master and
  then SIGTERMs a child that ignored the hangup. `(read)` the spawn-failure path closes the terminal
  before rethrowing (pty-posix.ts:26-29), so a failed open does not leak a master fd.
- **Reaping on quit**: `(read)` `pty.ts:72,125` calls `installReapOnExit()` and `trackChild(term)`;
  `child-reap.ts:20-77` removes a child when `exited` settles and SIGKILLs survivors on `exit` and
  on unowned SIGTERM/SIGINT. `scripts/e2e-pty.ts:93-104` asserts the pid is gone, the reap set is
  empty, and `list()` is empty after `close` (the natural-exit case is not asserted — see the
  lifecycle finding above; a test that opens, types `exit`, and then checks `list()` and map growth
  would have to be added).
- **Windows C slot mechanics**: `(read)` `pty-abi.test.ts:61-95` measures every `STARTUPINFOEXW`
  offset against a real compiler (host LP64, not Windows — labelled as such in the test).
  `pty-source.test.ts` checks that every `SHIM_BIND` symbol appears in `PTY_PREFLIGHT`. The ring
  drops the oldest byte when full (`66_pty_io.c:10-18`), so the C side itself is bounded. HRESULT-
  returning calls (`CreatePseudoConsole`, `ResizePseudoConsole`) test `< 0`, not falsiness
  (`65_pty_open.c:65,75`). `CreateThread` failure unwinds pipes, console and attribute list
  (`65_pty_open.c:160-171`). Note: none of this can be observed here; only the source was read.
- **FFI arity/width**: `(read)` `pty-ffi.ts:16-18,115-130` declares all 15 exports with `i32`/`ptr`/
  `cstring` and matches the C signatures in `63`/`65`/`66_pty_io.c`. `shim_pty_write` receives a
  `Uint8Array` for its `P` argument, consistent with every other buffer-passing call in this repo
  (`clipboard.ts:66`); `shim_pty_read` uses `ptr(buffer)`.
- **Registration gate**: `(read)` `runtime-feature-plugins.ts:39-45` registers the pty plugin only
  when the config has a `pty` section, selects the ConPTY backend only on `win32` via a dynamic
  import, and passes `os` into `createPtyPlugin`; `runtime-plugins.ts:42-43` threads the section
  through from `runtime.ts:86`. `runtime-feature-plugins.test.ts:14-29,41-51,72-76` covers absence,
  command names, the program refusal, and the Windows not-implemented answer. The browser branch of
  the same factory keys on `process.platform` rather than the `os` parameter — outside this field
  (a defect there belongs to the browser lane).
- **Cross-window events**: `(read)` `frameSink` emits `pty-data` through the one global `Events`
  subscriber set, so a page in another window can listen to a terminal's bytes. This is the same
  bridge class already filed in `docs/reviews/hunt-20/19-security.md` ("Every window's event stream
  receives every other window's events"); not re-reported here as a pty defect.
- **Env inheritance into the child**: `(read)` the shell inherits the whole parent environment on
  both platforms. For `pty` specifically this is not an escalation: a page holding `pty:open`
  already has an interactive shell and can read env/files itself. The separate `TERM` omission on
  Windows is reported above.
