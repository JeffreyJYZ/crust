# 03 · A real terminal (pty)

## 1. Verdict

`crust feature` — but the app's premise is stale: **no FFI is needed**. Bun 1.4.5 ships a real
pty (`Bun.Terminal`, POSIX), measured working here, so the POSIX half is a thin adapter over an
API crust already links. What crust genuinely owes is the part the app cannot fix: **who kills the
child on quit**, and the Windows half, where `Bun.Terminal` does not exist.

## 2. Evidence

**Absence search.** `rg -n '\b(pty|openpty|forkpty|posix_openpt|grantpt|unlockpt|ConPTY|CreatePseudoConsole)\b' src`
→ no matches. Nothing terminal-shaped exists, and no crust code touches a pty today.

**What crust does instead.** `crust:shell` is the only process API and it is pipes-only:

- `src/plugins/shell.ts:90-97` — `stdin: plan.pipe ? "pipe" : "ignore"`, stdout/stderr `"pipe"`.
  A program that asks `isatty(0)` sees a pipe, so the app's "script exits on piped stdin (EPIPE)"
  is crust's pipe, not a macOS script bug.
- `src/plugins/shell.ts:4` — the allowlist is the security property: real paths, deny by default,
  no shell ever invoked, refused before a process exists.

**The pty Bun already ships** (`node_modules/bun-types/bun.d.ts`):

- `8102-8138` — `terminal?: TerminalOptions | Terminal` on `Bun.spawn`; `8111` says POSIX only;
  `8108-8109` the terminal replaces stdin/stdout/stderr.
- `8879-8915` — `TerminalOptions`: `cols`, `rows`, `name`, `data(term, bytes)`, `exit(term, code, signal)`,
  `drain(term)`.
- `8942-8995` — `Bun.Terminal`: `write`, `resize(cols, rows)`, `setRawMode`, `ref`/`unref`, `close`,
  `[Symbol.asyncDispose]`.
- `8902-8904` — `exit`'s code is the **PTY lifecycle** status (0 EOF, 1 error), not the child's exit.

**Measured on this machine** (bun 1.4.5, macOS 27):

```
Bun.spawn(["/bin/sh","-c","tty; stty size; echo $TERM; test -t 0 && echo stdin-is-tty"],
  { terminal: { cols: 100, rows: 30, data: (t,d) => … } })
→ /dev/ttys002 · 30 100 · xterm-256color · stdin-is-tty · exit 0
```

A real device, a real size, `TERM` set, stdin a tty. `posix_openpt`/`grantpt`/`unlockpt`/`forkpty`
buy nothing here.

**No darwin file binds libc, and none could sanely `forkpty`.** Every macOS native half compiles a
C unit through `cc()` and declares its exports (`src/platform/darwin/crash.ts:14-18,61-69`;
`src/platform/darwin/single.ts:6,41`); `src/platform/darwin/arity.test.ts` enforces that each
declaration matches its C prototype. A `forkpty` from JS would fork a Bun runtime holding threads
and an event loop; the only safe shape is `forkpty + execvp` inside C, i.e. a shim unit — strictly
more work than `new Bun.Terminal(...)`.

## 3. What it would take

**Where it lives.** A native-backed plugin, built like shell (a factory that takes config):

- `src/plugins/pty.ts` — the commands and the live map; `pty-types.ts`, `pty-args.ts`,
  `pty-stream.ts` split off as needed to stay under the 200-line cap.
- `src/plugins/barrel-platform.ts` — re-export, beside `createScreenPlugin`.
- `src/runtime-plugins.ts:191` — registered next to `shellPlugin`, constructed at `:60-63` from its
  own config section. Gate it the way `updater` is gated (`:31,68`): a `pty` section registers it,
  no section means no name. Do **not** rely on `config.plugins` — `selectedPlugins`
  (`src/runtime-shim.ts:35-48`) only filters core plugins and throws `unknown plugin` for anything
  else.
- `src/config/types.ts:159` — a `pty?: PtyConfig` beside `shell`, with `allow?: string[]` and
  `cwdRoot?` copied from `ShellConfig` (`:99-102`), for the reason in §4.

**Page-facing API** (same shape as shell, so one mental model):

```ts
pty.open({ cols, rows, program, args })   // -> { ok, id }
pty.write({ id, data })                   // -> { ok, bytes }
pty.resize({ id, cols, rows })            // -> { ok }
pty.close({ id })                         // -> { ok, closed }
pty.list()                                // -> { ok, ids }
```

`onData` is not a command call — it is an event, `pty-data { id, chunk }`, pushed with `ctx.emit`
and consumed by `api.listen("pty-data", …)` (`src/bridge/client/types.ts:74`), exactly as shell
does at `src/plugins/shell-stream.ts:45-51`. `pty-exit { id, exitCode, signal }` carries the real
child status from `proc.exited`; the `Terminal` exit callback must not be reported as it.

**Chunks are raw bytes, not lines.** Shell's `LineRing` (`shell-stream.ts:18`) splits on `\n`; an
ANSI escape sequence is routinely split across two reads, so a pty must emit the bytes as they
arrive (base64 or a latin1 string) or the page renders garbage.

**Per OS.**

- **macOS** — no native half. `Bun.Terminal` is the pty; the plugin is ~120 lines of adapter.
- **Linux** — identical, same `Bun.Terminal`. If a fallback is ever needed it belongs in
  `src/platform/linux/shim/` and links libc the way the shim already does, with the `libc.so`
  linker-script trap already handled at `src/platform/linux/preflight.ts:62-89`.
- **Windows** — `Bun.Terminal` does not exist (`bun.d.ts:8111`). ConPTY: `CreatePseudoConsole(COORD,
  hInputRead, hOutputWrite, flags, HPCON*)`, `ResizePseudoConsole`, `ClosePseudoConsole` from
  kernel32, plus two `CreatePipe` pairs; `InitializeProcThreadAttributeList` +
  `UpdateProcThreadAttribute` with `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`, then `CreateProcessW`
  with `EXTENDED_STARTUPINFO_PRESENT` and a `STARTUPINFOEXW`. New files:
  `src/platform/windows/shim/63_pty.c` and `src/platform/windows/pty-ffi.ts`, with three
  `preflight.ts` entries (`:1-6` pattern: an unresolvable export is a crash with no JS error).
  **Hardest part:** those Win32 entry points cannot be declared on the `bun:ffi` side at all —
  `src/platform/windows/ffi.ts:9-14` records that TinyCC's PE import thunk jumped to
  `0xFFFFFFFFFFFFFFFF`, so every call is resolved by `LoadLibraryA`/`GetProcAddress` in C; and
  `STARTUPINFOEXW`/`PROC_THREAD_ATTRIBUTE_LIST` are structs-by-pointer, so each field is laid out
  by hand into allocated memory with LLP64 widths (`src/platform/windows/c-abi.ts:1-14`) and the
  handles must stay open for the console's whole life.

## 4. What breaks

**Security is the whole argument.** `shell` is defensible only because nothing runs unless a real
path is in the host's list (`shell.ts:4`). A terminal's purpose is an unconstrained login shell, so
a page-reachable `pty.open` hands any script in the webview local command execution — one XSS or
one compromised renderer becomes `sh`. The bridge token (`src/bridge/client/types.ts:33`) is the
only credential. So `pty.open` must validate `program` against `pty.allow` and a `cwdRoot`, and
"it opens a shell" has to be the host's config decision, never a default; that is why the config
section exists rather than a bare plugin.

**Backpressure.** `emit` is the SSE channel: `yes` floods it and freezes the window. Shell bounds
by a 500-line ring (`shell-stream.ts:9-10`); a pty needs a bounded byte budget per frame plus the
`Terminal` `drain` callback, or the bridge becomes the leak.

**Child ownership is crust's existing defect, and it is why this is not app-side.**
`PluginDefinition` has no teardown member (`src/plugins/define.ts:32-38`) and **no plugin under
`src/plugins` registers `process.on("exit")`** (`rg -n 'process\.on\(' src/plugins` → no matches).
`app.quit()` (`src/app.ts:177-184`) reaches `platform.quit()`, which ends in `process.exit(0)`
(`src/platform/darwin/platform.ts:186`), and SIGINT/SIGTERM does the same
(`src/runtime-process.ts:15-17`). Nothing walks live children, so **`crust:shell` already leaks a
running child on quit today**; a pty would leak the same, and a pty child that ignores SIGHUP keeps
the terminal row alive too.

**Does a SIGTERM restart leak it?** `crust dev` restarts by SIGTERM (`src/cli/dev/runtime.ts:108-109`),
which runs the handler and then `process.exit(0)` — so a `process.on("exit")` hook does run on a
dev restart, the same pattern `src/platform/darwin/power.ts:99-108` already uses to release its
power assertion. Two paths do **not** run it: a crash exits through the C handler's `_exit(70)`
(`src/platform/darwin/crash.ts:105-108`), and SIGKILL cannot. The honest design is therefore a
supervisor that owns every pty child, reaps on the exit hook, and sweeps survivors at startup by
parent pid — the liveness-polling shape `src/runtime-crash-guard.ts:3` already describes.

**Lifecycle code that must learn about it:** `src/app.ts:186-191` (`#stopWatching` is where a
teardown pass belongs), `src/platform/darwin/platform.ts:168-187` (reap before `process.exit(0)`),
`src/runtime-process.ts:12-18` (signal handler reaps first), and — only if teardown becomes a
plugin member — `src/plugins/define.ts:32-38`, which touches every plugin. The cheaper seam is an
app-level supervisor registered beside `startCrashPart` (`src/runtime-plugins.ts:140-146`), which
would also close the shell leak in the same change.

**Gate shape.** New tests assert `tty` output and the reported size from a real `Bun.Terminal`; a
new `scripts/e2e-pty.ts` mounts the plugin, opens, writes `stty size`, asserts the size came back
and that quit leaves no surviving pid (`scripts/e2e-harness.ts` already has `survivorsOf`).

## 5. Estimate

**M for POSIX, which is what the app needs** — the native cost is zero (measured above); the work
is one adapter, one permission rule, the byte-bounded stream, and the reap seam that shell needs
anyway. **L if Windows ships in the same change** — a C ConPTY unit, hand-laid structs, preflight
entries and a Windows-only e2e. The `openpty` FFI the app priced in is not part of either.

## 6. What stays the app's job

xterm.js (or any emulator) — crust ships bytes and a size, never a screen model; keyboard and
clipboard chords, including the choice to call `setRawMode`; scrollback and its budget; theme,
font, hyperlinks, and search in the buffer; and which program a terminal opens, which is the
host's config, not a crust default.
