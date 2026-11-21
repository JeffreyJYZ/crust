# pty lane — measured notes

Facts this lane learned the hard way, so the next one does not re-derive them.

- **`Bun.Terminal` is the whole POSIX pty** (measured on 1.4.5): `new Bun.Terminal({ cols, rows, name, data, exit, drain })`, then `Bun.spawn({ cmd, terminal: term })`. `stty size`, `tty` and `test -t 0` all answer correctly inside it; no FFI and no `openpty`.
- **`term.close()` alone ends a cooperating shell.** Measured: pid gone within one poll after the master closed, and `child.exitCode` became 0. A program that traps `SIGHUP` is why `pty.close` also sends `SIGTERM`.
- **`Bun.Terminal`'s `exit` callback is the pty lifecycle (0 EOF, 1 error), never the child's status.** `pty-exit` comes from `child.exited` plus `child.signalCode`; reporting the terminal callback would label every clean `exit` wrong.
- **A success shape that carries `ok: true` cannot be discriminated with `"ok" in value`.** Three argument readers answer `{ ok: true, … }`, so that test handed a success back as a refusal and `close` silently never ran. Test on `code` instead (`isPtyFailure` in `pty-types.ts`).
- **`scripts/` has a focus classification gate** (`scripts/harness/focus.test.ts`): every top-level script is either a `LAUNCHERS` entry that arms `guardFocus()` or an `EXEMPT` entry with a reason, and `e2e-pty.ts` is exempt because it launches no app.
- **Windows is a named refusal, not a surface.** `Bun.Terminal` is POSIX-only and the ConPTY unit (`shim/63_pty.c`: `CreatePseudoConsole` + two `CreatePipe` pairs + `STARTUPINFOEXW` with `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`, every Win32 call resolved in C because TinyCC's PE import thunk is broken) could not be proven without a Windows host, so `pty.open` answers `not-implemented` with `requires: "CreatePseudoConsole"`.
- **The host's `pty.shell` is the allowlist.** `pty.open` accepts a page `program` only when it resolves to that same program, because an unconstrained login shell reachable from the webview is local command execution.
