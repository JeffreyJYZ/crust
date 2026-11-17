# Lane S — sidecar write/list/kill (BRIEF-5)

Fixed F5. `src/plugins/sidecar-process.ts:17` — `bunSpawn` now opens `stdin: "pipe"`; the handle
keeps it on `SidecarChild.stdin`. `sidecar-commands.ts:38` `write(id,{data|text})` encodes string or
Uint8Array to the stdin pipe; unknown id → `sidecar-unknown-id` naming it, never a no-op.
`sidecar-commands.ts:82` `list()` returns live `{id,name,pid,startedAt}` plus declared `names`.
`sidecar-commands.ts:89` `kill(id)` sends SIGTERM then SIGKILL after a bounded grace
(`killGraceMs`, default 2000); the exit handler clears the timer so `sidecar-exit` fires once.
Split for the 200-line cap: control (spawn+registry), commands (write/list/kill), process, types.

Tests: `src/plugins/sidecar-control.test.ts` (8 cases) — text/bytes/text-alias write, unknown-id
write & kill, list shape + removal on exit, SIGTERM single exit, SIGTERM→SIGKILL escalation.
Gates: `bun check` clean (720 files), 15 tests pass, `bun fmt` on changed files, `check:lines` PASS.

Not mine (coordinator): flip parity row `Sidecar binaries` and butter-coverage F5 `partial`→`same`;
shared files, six lanes write them. Butter's `list` is declared names, ours is live children + names.
