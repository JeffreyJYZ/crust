# fix-bridge-limits lane memory

## What changed (2026-11-18)

- `src/bridge/server/invoke.ts`: added `readCappedBody(request)` — reads the body stream with a running raw-byte counter, cancels and throws `too-large` the moment it crosses `MAX_BODY_BYTES`; both the binary and JSON paths now use it. Header `content-length` fast path kept; capability logic untouched (F1/L4 own it).
- `src/platform/darwin/shim/119_keychain_b.c`: `shim_keychain_list` sizes each account from `CFStringGetMaximumSizeForEncoding(CFStringGetLength(name))` and writes into the caller buffer, instead of a fixed 256-byte stack buffer that made long names fail `CFStringGetCString` and get `continue`d out of the list. A name that will not fit reports its needed room (`total += room`) so the adapter re-reads at an exact size, as `get` already does.

## Reusable traps

- A chunked POST omits `content-length`, so a header-only cap is decorative. `content-length` is a client claim, never a measurement.
- The old code did buffer the whole body then return 413 — status alone cannot prove the fix. Prove early refusal by gating the rest of the stream: the response must arrive before the gate opens. Red on HEAD: `answered_before_rest_of_stream=false`; after fix `true` (`bun /private/var/folders/.../chunk-red-probe.ts`).
- A comment containing the banned literal trips a source-inspection test that asserts `not.toContain(...)`; phrase the reason without repeating the exact string.
- `CFStringGetMaximumSizeForEncoding` is an upper bound on UTF-8 bytes including the NUL; writing straight into `dst + total` with `room` bytes free is safe, and the NUL it writes is the NUL separator `splitAccounts` expects.
- Reproducing the >255-byte name needs a real Keychain write, which a probe must not do. Prove the C half with a source-inspection test plus `clang -fsyntax-only`, and the adapter half with a fake shim that reports a full needed length larger than the first buffer.

## Gate state at handoff

- `bun test src/bridge src/platform/darwin/keychain.test.ts` — 159 pass; the two edited test files alone — 20 pass.
- Red proofs: chunked old/new logic probe; keychain source probe against `git show HEAD:...` (all three checks false before, true after).
- `bun check` clean (793 files); `bun fmt --check` clean on the three TS files; `bun run check:lines` PASS; `clang -fsyntax-only -std=c99 -Wall` clean on the assembled keychain unit (4 pre-existing pointer-bool warnings in `118_keychain_a.c`).
- Repo-wide `bun run test` green at handoff: 1817 pass, 0 fail. An earlier run was red on `scripts/butter-sweep.test.ts` and a `net_install` native test — other lanes' in-flight edits, green once they landed.
- No GUI app launched, so no focus handback needed.
