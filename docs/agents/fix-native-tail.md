# L9 `fix-native-tail` — measured 2026-11-18

## What changed

- `20_delegate.c` no longer FIFO-pops `dl_pending`. Each start now gets a stack block from
  `dl_start_block_for(token)` in `10_block.c`; the token is a field of that block, and `_Block_copy`
  carries it into the heap block WebKit invokes. `dl_started_count` bounds outstanding starts.
- `dl_install` and `net_install` build into a local class, dispose on every `class_addMethod`
  failure, and cache the class only after `objc_registerClassPair`. A later instance-init failure
  reuses the registered class instead of re-allocating under a name that now returns 0.
- `native-surface.md` §4 and §5 are closed. The F3 ownership harness was split into
  `ownership-harness.ts` (stubs + `probeWith`), `network-ownership.test.ts`,
  `downloads-ownership.test.ts`, and `native-ownership.test.ts` to satisfy the 200-line cap.

## Traps

- A stub that reads `va_arg` from `objc_msgSend` segfaulted TinyCC at `0x11` on this Mac. The
  ordering test calls the in-TU static `dl_start_done` directly with a block-shaped struct instead;
  no variadic stub needed.
- The C test stub must define `_NSConcreteStackBlock` as well as `_NSConcreteGlobalBlock`, and
  `objc_disposeClassPair`, once the shim references them; `ownership-harness.ts` strips both externs
  from the assembled source.
- The old `docs/agents/downloads-network.md` line 24 still records FIFO as the token mechanism; it
  is stale after this fix and belongs to that lane's memory, so it was not edited here.

## Gates

- `bun test src/platform/darwin` — 210 pass, 0 fail.
- `bun check` — no type errors in 793 files.
- `bun run test` — 1817 pass, 0 fail.
- `bun run check:lines` — PASS.
- Red before the fix: ordering returned `-5` (wrong token), both class tests returned `-2` (no
  dispose call).
