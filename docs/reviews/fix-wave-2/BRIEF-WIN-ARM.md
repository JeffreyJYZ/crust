# Windows arm64 support

A new release target: `bun-windows-arm64`, built on a Windows arm runner, shipped as a sixth asset,
and proved by its own magic bytes.

Read `docs/reviews/fix-wave-2/BRIEF.md` for the shared rules. One tree, `rg`/`fd`, foreground builds,
200-line cap, never `bun fmt` without paths, quotes over numbers, only your own files.

## Why this is more than a table row

The release table is one `as const` in `scripts/release/targets.ts`, so adding a key is trivial. What
is not trivial is everything that assumed x64:

1. **Bun must ship a Windows arm64 binary.** Verify first, before any other work:
   `bun build --compile --target=bun-windows-arm64` on this machine. If Bun has no such target, the
   lane stops and reports that with the exact error — that is a complete answer, and nothing else
   in this brief should be attempted in that case.
2. **The C shim is compiled at runtime by TinyCC inside Bun**, on the machine that runs the app. So
   a Windows arm64 build compiles the shim on Windows arm64, with whatever TCC is bundled there. Read
   `src/platform/windows/shim/*.c` for anything that assumes x86-64: the 4096-byte `__chkstk` frame
   scanner is the known one, and `36_probe.c:131` already discusses TCC's scratch handling.
3. **`bun:ffi` declarations must match their C prototypes on a different ABI.** Windows arm64 follows
   the AAPCS64-ish Windows calling convention, not the x64 one. Every pointer-width assumption and
   every `int` vs `long` matters: this repo has already been bitten by a `shim_i64` return read from a
   32-bit `HRESULT`.

## Lane W1 — `win-arm-build`

Own: `scripts/release/targets.ts`, `scripts/release/assets.ts`, `scripts/build-standalone.ts`,
`.github/workflows/release.yml`, and the tests beside them.

1. **First: prove Bun can target it.** Run
   `bun build --compile --target=bun-windows-arm64 --outfile /tmp/probe.exe <a trivial entry>`.
   If that fails, write the finding into `docs/agents/win-arm.md` and report — do not add the target.
2. If it works: add `bun-windows-arm64` to `TARGETS` with the right `magic` (a PE image; arm64 PE
   still starts `4d5a`), extend `artifactName`, and make `hostTarget()` resolve on a Windows arm host
   (`process.platform === "win32"`, `process.arch === "arm64"`).
3. Add the release job: a `windows-11-arm` runner (or `windows-latest` with an arm toolchain, whichever
   the workflow can actually use — say which and why), building that one target.
4. Extend `scripts/release/assets.ts` so a missing sixth asset fails the release, and `verify-assets`
   reports it as "not executed (bun-windows-arm64 on <host>)".

Prove: the table test covers six targets including a win-arm case; `bun run test scripts/release` is
green; the workflow YAML parses (`ruby -ryaml -e 'YAML.load_file("<file>")'` — an unquoted colon in a
step name has broken this repo's release before).

Do **not** claim the asset builds until a real Windows arm runner did it. If you cannot run one,
say exactly that and leave the job marked as unproven.

## Lane W2 — `win-arm-shim`

Own: `src/platform/windows/shim/*.c`, `src/platform/windows/*-ffi.ts`, and tests beside them.

Audit the Windows shim and its ffi declarations for x86-64 assumptions, and fix the ones that would
break on arm64:

- the frame scanner in `10_prelude.c` / `36_probe.c` and every `__chkstk` assumption;
- every `pointer`-width cast, `long` vs `int`, and `size_t` vs `DWORD`;
- every `bun:ffi` declaration's return and argument widths against its C prototype, which
  `src/platform/darwin/arity.test.ts` does for darwin — do the equivalent for windows if it does not
  exist.

This machine is darwin arm64, so nothing here can be *executed* on Windows. That is fine: the work is
static. `clang -fsyntax-only` cannot check a Windows target without the SDK, so the proof is
(a) a written table of each declaration and its C prototype side by side, and (b) a test that fails
when a declaration's width disagrees with the prototype it names, if that test can be written without
the OS.

Report each finding as: file:line, what assumes x64, what arm64 does instead, and the smallest fix.
Do not restructure the shim.

## Final message

Under 12 lines. Bullets. Whether Bun can target win-arm at all, what you changed, what remains
unproven.
