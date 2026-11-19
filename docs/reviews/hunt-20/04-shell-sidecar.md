# Hunt 20 — shell & sidecar

All findings below are `read` (code review only). No runtime probe, GUI launch or e2e was run,
per the hunt contract. Nothing was verified on Windows or Linux.

## Medium — env opt-in denylist misses interpreter/path variables, so the documented "no execution primitive" guarantee is false
- where: src/plugins/shell-env.ts:9-31 (INJECTION list, `injection()`), src/plugins/shell-env.ts:61-68
- mechanism: `(read)` The denylist blocks `NODE_OPTIONS` but not `NODE_PATH`; `GIT_EXEC_PATH` but not `GIT_SSH_COMMAND`; `PYTHONSTARTUP` but not `PYTHONPATH`/`PYTHONHOME`/`PYTHONINSPECT`; no `PERL5LIB`, `RUBYLIB`/`GEM_PATH`, `PHPRC`, `SHELLOPTS`/`BASHOPTS`. Each omitted name still makes an allowlisted program load or run a file of the caller's choosing — exactly the harm the doc comment and the shell guide claim to prevent "even then" (site/app/docs/guides/shell/page.mdx:60).
- reachable by: a host builds its own plugin with `createShellPlugin({ env: true, allow: ["python3"] })` (or `git`, `node`, `perl`); a page supplies `env: { PYTHONPATH: "<writable dir>" }` and `args` that import a module it wrote. The variable passes `injection()` and reaches `Bun.spawn` at src/plugins/shell.ts:93. Note the shipping runtime never opts in (src/runtime-plugins.ts:68 passes only `allow`/`cwdRoot`), so this is confined to custom hosts that rely on the advertised guarantee.
- smallest fix: replace the denylist with an allowlist of env names the host explicitly permits, or at minimum add `NODE_PATH`, `PYTHONPATH`, `PYTHONHOME`, `PYTHONINSPECT`, `PERL5LIB`, `RUBYLIB`, `GEM_PATH`, `PHPRC`, `GIT_SSH_COMMAND`, `SHELLOPTS`, `BASHOPTS` to `INJECTION`.

## Medium — every spawned child inherits the whole parent environment, including the bridge bearer token and host secrets
- where: src/plugins/shell.ts:93 (`env: { ...process.env, ...plan.env }`), src/plugins/sidecar-control.ts:69 (`env: process.env`), src/runtime.ts:139-140
- mechanism: `(read)` Both plugins hand the entire parent environment to the child. In dev the runtime writes `CRUST_BRIDGE_TOKEN` / `CRUST_BRIDGE_URL` into `process.env` (src/vite.ts:11,13); any other secret in the host's environment is inherited too. `shell.output` returns the child's stdout to the page.
- reachable by: host allowlists an env-printing program (the project's own fixture allowlist includes `printenv` — src/plugins/shell-fixture.ts:21). A page calls `shell.spawn({ program: "printenv" })`, then `shell.output`, and reads every inherited variable. No page `env` opt-in is needed — the leak is the default path.
- smallest fix: build a minimal child environment (an explicit allowlist such as `PATH`, `HOME`, `TMPDIR`, locale) and always strip `CRUST_BRIDGE_*` before spawn.

## Medium — no child cleanup at app quit or window-close; spawned processes are left to outlive the app
- where: src/plugins/shell.ts:70-71 (processes map, no shutdown hook), src/plugins/sidecar-control.ts:29 (running map, no shutdown hook), src/runtime-process.ts:16, src/platform/darwin/platform.ts:185, src/app.ts:177-181
- mechanism: `(read)` Neither plugin exposes a stop/dispose hook, and the registries are only pruned when a child exits on its own. Quit goes through `platform.quit()` → `process.exit(0)` (macOS platform.ts:185) and SIGINT/SIGTERM → `process.exit(0)` (runtime-process.ts:16); window-all-closed calls `app.quit()`. There is no code that iterates either map to kill or wait for children. `Bun.spawn` children are not kill-on-parent-exit objects, so a long-lived child is reparented and keeps running.
- reachable by: a page spawns `sleep 600` via `shell.spawn` (or a long-lived declared sidecar), then the user closes the last window / quits; the child keeps running with no bridge and no owner. (Whether Bun itself reaps children on `process.exit()` is not measured here — the framework provides no explicit guarantee either way; a test that spawns a long-lived child, calls the app's quit path, and polls the PID would settle it.)
- smallest fix: give both plugins a `shutdown()`/dispose hook that kills every live child (with the sidecar SIGTERM→SIGKILL grace) and await it from `app.quit()`/signal handlers before `process.exit`.

## Low — sidecar stderr is emitted as `sidecar-stdout`; consumers cannot distinguish it from stdout
- where: src/plugins/sidecar-control.ts:80-83, src/plugins/sidecar-types.ts:93-97
- mechanism: `(read)` The same `stdout` callback is passed to `streamText(child.stdout, ...)` and `streamText(child.stderr, ...)`, and it always emits `"sidecar-stdout"`. `SidecarStdout` carries no `stream` field. Shell does this correctly with `lineSink(emit, id, "stdout"|"stderr")` (src/plugins/shell-stream.ts:48-55), so a page that handles both namespaces gets a stream tag from `shell-output` but not from sidecar output.
- reachable by: any declared sidecar writes a warning/error to stderr (e.g. the fixture's `fake.err("warn\n")`, src/plugins/sidecar.test.ts:73); the page receives it as `sidecar-stdout` and treats an error as normal output.
- smallest fix: add a `stream: "stdout" | "stderr"` field to `SidecarStdout` and pass a stream-tagged callback to each `streamText`, mirroring `lineSink`.

## Low — sidecar output has no emit/ring bound and emits per decoded chunk, unlike shell's 500-line budget
- where: src/plugins/sidecar-process.ts:23-37, src/plugins/sidecar-control.ts:80-83
- mechanism: `(read)` `streamText` calls `onText` for every `reader.read()` chunk with no cap, line framing or backpressure. Every chunk fans out as a `sidecar-stdout` event and nothing throttles it. Shell's `drain`/`LineRing` deliberately caps this at 500 lines × 8192 chars and uses the ring as the emit budget (src/plugins/shell-stream.ts:8,57-84; "A ring is also the emit budget").
- reachable by: a declared sidecar writes continuously to stdout; every chunk becomes an event, flooding the page and the bridge event queue with no bound.
- smallest fix: route sidecar output through the same line-ring/sink used by shell, or add an equivalent per-stream cap before `emit`.

## Low — sidecar children run with the process cwd (`/` in a built app), never the binary's directory
- where: src/plugins/sidecar-process.ts:13-20 (`bunSpawn` honours `options.cwd`), src/plugins/sidecar-control.ts:69 (spawn passes only `env`)
- mechanism: `(read)` `SidecarSpawner` accepts an optional `cwd`, and `bunSpawn` forwards it, but `spawn` never supplies one, so `Bun.spawn` uses `process.cwd()`. The runtime documents that a built app runs from `/` (src/runtime.ts:124). A sidecar whose binary sits in `Contents/Resources` but resolves resources relative to its cwd therefore looks under `/` in production.
- reachable by: an app declares a sidecar that opens `./config.json` beside its binary; it works under `crust dev` (project cwd) and fails only after `crust build`.
- smallest fix: pass `cwd: dirname(target)` (or the bundle resource dir) to `spawnChild`.

## Low — sidecar argv is not checked for NUL bytes, and a swapped symlink is not realpath-checked (unlike shell)
- where: src/plugins/sidecar-control.ts:59-66 (argv check), src/plugins/sidecar-locate.ts:44-52 (`resolveSidecar` uses lexical `resolve`/`startsWith`, no `realpath`), src/plugins/shell-args.ts:59 (shell rejects `\0`), src/plugins/shell-resolve.ts:8,37 (shell uses `realpathSync`)
- mechanism: `(read)` A NUL in `args` is only caught when `Bun.spawn` throws, which the catch reports as the misleading `sidecar-missing`. `resolveSidecar` stops `..`/absolute names lexically but never realpaths, so a declared name that is a symlink to a file outside the bundle passes `existsSync` and `Bun.spawn` follows it. Shell defends against both.
- reachable by: (NUL) a page supplies `args: ["a\u0000b"]` and gets `sidecar-missing` instead of `invalid-args`; (symlink) in a writable `dir` — dev cwd, or a bundle dir the `fs` plugin can write — a declared sidecar path is replaced with a symlink to `/bin/sh`, and `sidecar.spawn({ name })` runs it with page-supplied args, escaping the declaration. Both need a writable path or an injected spawner; a signed, shipped `.app` blocks the symlink swap.
- smallest fix: reject `\0` in sidecar args in the `invalid-args` branch, and realpath `resolveSidecar`'s result and re-check bundle containment before `existsSync`.

## Checked and clean
- Page string → command: `(read)` Both plugins pass argv arrays to `Bun.spawn` (`cmd: [realPath, ...args]` at src/plugins/shell.ts:90-97, `[target, ...argv]` at src/plugins/sidecar-process.ts:13-20). No shell is invoked and no string is re-parsed; `shell-attacks.test.ts` measures the argv-verbatim and symlink refusals. A page string cannot become a command here.
- shell program/cwd allowlist: `(read)` Names and paths canonicalised once via `Bun.which`/`realpathSync` (shell-resolve.ts:53-61,66-77), compared against real paths at spawn (shell-resolve.ts:133-175). Basename, symlink and cwd-escape refusals are covered by shell-attacks.test.ts; no path reaches `Bun.spawn` that did not pass the list.
- sidecar name allowlist: `(read)` `names` is frozen at construction (sidecar.ts:27) and `resolveSidecar` rejects absolute/`..`/`.` names and out-of-root targets (sidecar-locate.ts:44-52); undeclared/missing/escape names are typed failures before spawn (sidecar-control.ts:33-58).
- shell stdin semantics: `(read)` `stdin: "pipe"|"ignore"` validated at parse (shell-args.ts:102-107); `write`/`close` return typed `no-stdin`/`closed:false` when there is no pipe or it is closed (shell.ts:132-168), with `Buffer.byteLength` giving UTF-8 byte counts. shell-stream.test.ts measures these paths.
- shell output/exit accounting: `(read)` 500-line ring with 8192-char truncation (shell-stream.ts:8,17-32), drained before `output` reports (shell.ts:123, shell-stream.ts:58-84), 256-record prune cap (shell.ts:25,75-80), and `finished()` covering both exitCode and signalCode (shell-stream.ts:87-89). No unbounded growth in the shell path.
- note (doc drift, not a runtime defect): `(read)` site/app/docs/guides/shell/page.mdx:86 and the Commands table at :33-38 say "No stdin, no pty", but the plugin implements `write`/`close` and `stdin: "pipe"` (src/plugins/shell.ts:43-47,94,132-168). The docs understate the shipped capability; another lane may own the doc fix.
