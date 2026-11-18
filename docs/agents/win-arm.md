# win-arm-build — Windows arm64 release target

Bun can target Windows arm64 on this darwin arm64 machine (measured 2026-11-18, bun 1.4.4):

- `bun build --compile --target=bun-windows-arm64 --outfile <out> <trivial-entry>` exits 0,
  prints `compile ... bun-windows-aarch64-v1.4.4`. It downloads the cross runtime on first use.
- Magic is `4d5a` (MZ), prefix not equality — PE header is `MZ` plus a DOS stub (`4d5a7800`
  measured). `file` says `PE32+ executable (console) Aarch64, for MS Windows`.
- Full artifact cross-compiles too: `bun run scripts/build-standalone.ts --target bun-windows-arm64
  --expect-version v0.1.26` produced `dist/crust-0.1.26-windows-arm64.exe`, 103,950,848 bytes,
  `standalone: PASS`. `SKIP run-and-prove` because darwin cannot execute a PE — expected, not a gap.

Changes made (Lane W1):

- `scripts/release/targets.ts`: sixth key `bun-windows-arm64` (os windows, arch arm64, magic `4d5a`).
  `hostTarget()` already resolves it via the `win32`→`windows` remap once the key exists; no code change
  there, only comment + test.
- `.github/workflows/release.yml`: sixth matrix entry on `windows-11-arm`, a standard GA
  GitHub-hosted arm64 runner (docs: GitHub-hosted runners reference; GA for both public and private
  repos). Chosen over `windows-latest` (x64) because build-standalone executes its own binary on the
  host target and the app's TinyCC shim compiles at runtime on the machine running it — an x64 runner
  could only cross-compile and would print SKIP for the run-and-prove half.
- `scripts/release/assets.ts` needed no edit: both required behaviours were already generic over
  `TARGETS`. A missing sixth asset now fails via the names loop in `verify-assets.ts`, and
  `checkAsset` prints `not executed (bun-windows-arm64 on <host>)` in its non-host branch. Proved by
  a new `assets.test.ts` that writes a stand-in PE.
- Tests: `targets.test.ts` (six targets, win32+arm64 host, win-arm magic/.exe),
  `release-workflow.test.ts` (matrix entry), new `assets.test.ts`.

Proof commands: `bun test scripts/release` (57 pass), `bun check` (769 files clean),
`ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml")'` (OK),
`bun run check:lines` (PASS), focused `bun test {targets,assets,release-workflow}.test.ts` (14 pass).

Unproven: no real Windows arm runner was executed here — the `windows-11-arm` job is added but not
run. Cross-compilation on darwin proves the compile step, not that the runner built/executed the asset.
The runtime TinyCC shim on Windows arm64 is Lane W2's static audit; nothing here executes it.
