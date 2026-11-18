# Lane A2: windows-keychain-frame

## Measured defect (before)

- Probe: `bun /private/var/folders/mv/.../kc-frame-before.ts` (standalone, computed from `48_keychain.c`, apply TinyCC's `v = locals + func_scratch(32)`, `v >= 4096 -> call __chkstk`).
- `SHIM_KC_TARGET_MAX=2048`, `sizeof(kc_wchar)=2` (`typedef unsigned short`).
- `shim_keychain_set/get/delete`: `target[2048]` = 4096-byte local; `shim_keychain_list`: `prefix[2048]` = 4096-byte local.
- All four: `loc=4096 v=4128 v>=4096? true -> call __chkstk (UNRESOLVED -> crash)`. Real defect, not theoretical.
- Documented evidence: `CHANGELOG.md:204`, `docs/agents/windows-platform.md:156,174` — the same 4096-byte local in the window unit crashed on `windows-latest` at `0xFFFFFFFFFFFFFFFF`.

## Fix

- Made all four buffers `static` (`48_keychain.c:111,135,157,171` -> now `:111,135,157,171` after removing the transient comment). Image storage, zero frame.
- Unit is not reentrant per call: FFI calls are synchronous from one isolate; each isolate compiles its own copy via `keychain-ffi.ts:unitOnce`. Static is safe.
- Chose static over shrinking `SHIM_KC_TARGET_MAX`: shrinking would cut target-name capacity while `ACCOUNT_BYTES=4096` (2048 UTF-16 units) is the advertised account size.
- After probe: all six functions `v=32 -> inline sub rsp`.

## Scanner extension

- Chose the dedicated-assertion route (BRIEF-7 option 2), inside `frame.test.ts`; `frames.ts` left byte-identical.
- Why not add to `SHIM_PART_NAMES`: `48_keychain.c` is compiled alone by `keychain-ffi.ts` and is deliberately absent from the window unit; joining it would misrepresent that unit's pointer count and module list.
- The test reads the file with `readShimPart`, normalises `kc_wchar` -> `shim_wchar` (both 2-byte), and resolves `#define SHIM_KC_TARGET_MAX` to a number so the shared `localArrays` measures it.
- Guard proof: strip `static` from the four declarations in a copy of the source -> scan reports 4 offences, each 4096 bytes. Injected `kc_wchar buf[2048]` -> offence; `buf[2047]` -> clean.

## Traps hit

- `frames.ts` and `48_keychain.c` were each exactly 200 lines. Adding a 7-line C comment and a `keychainArrays()` helper pushed both over `check:lines`. Fix: split by responsibility — keep the rationale in `frame.test.ts`, do the type-normalisation there, and revert `frames.ts` fully. Never trim a measured reason to reach the cap.
- `bun fmt` re-expands a compacted `STATEMENTS` set to one string per line, so formatting a file OVER the cap just puts it back. Get the line count right before formatting.
- The shared `localArrays` only measures numeric bounds; `SHIM_KC_TARGET_MAX` reads as `undefined` (an offence for the wrong reason). Resolve the macro before scanning when asserting exact bytes.

## Verification

- `bun test src/platform/windows/frame.test.ts`: 10 pass, 0 fail.
- `bun run test`: 1845 pass, 0 fail (302 files).
- `bun run check:lines`: PASS.
- `clang -fsyntax-only -std=c11 -Wall src/platform/windows/shim/48_keychain.c`: clean.
- `bun check src/platform/windows/frame.test.ts src/platform/windows/frames.ts`: clean. Repo-wide `bun check` was red at 13 errors in A1's in-flight `src/bridge/client/*` files; not this lane's work, not touched.
