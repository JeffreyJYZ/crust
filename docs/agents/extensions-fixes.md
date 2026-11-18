# extensions — fix wave report

Lane: `extensions` (`17-extensions.md` findings 2, 3, 4, 5, 6). Branch `main`; the coordinator landed
this lane in `987f0bf` on top of `5d7502d`.

## Fixed

### 2. Dylib name and compile flags were hardcoded for macOS — HIGH

- `src/packaging/extension-tools.ts:17-26` — new `dylibSuffix(platform)`: `.dylib` on darwin, `.so`
  everywhere else unix-like, `.dll` on win32. It lives here so the compiler, the bindings generator and
  the native e2e name the same file instead of three copies of `.dylib`.
- `src/packaging/extension-compile.ts:41-100` — `dylibName` and `extensionCommand` take an injected
  `platform` (default `process.platform`); `compileExtension` accepts `platform` in its options and
  uses it for both the argv and the reported `output`, so a Linux build reports the file it really
  wrote. `rustc` only prefixes `lib` off Windows (`rustc -o math.dll` is what a Windows cdylib is named).
  clang gets `-dynamiclib` on darwin and `-shared` elsewhere — `-dynamiclib` is Apple-only and a Linux
  clang rejects it outright.
- `src/packaging/extension-bindings.ts:67` — the default dylib name is `${name}${dylibSuffix()}`, not
  `${name}.dylib`, so the generated module dlopens the name the compiler emitted on that platform.
- `scripts/e2e-native.ts:75` — the post-compile `stat` asserts `clock${dylibSuffix()}` and
  `libclock${dylibSuffix()}` rather than the two macOS names.

### 3. `findTool` could not find Windows executables — MEDIUM

- `src/packaging/extension-tools.ts:41-48` — new `toolFileNames(name, platform)` returns
  `[zig.exe, zig.cmd, zig.bat]` on win32 and `[zig]` elsewhere.
- `src/packaging/extension-tools.ts:50-70` — `findTool(name, path, platform)` scans PATH and probes each
  of those names in each directory, returning the file it actually found. Windows installs `zig.exe`
  and `accessSync` does not apply PATHEXT, which is why every toolchain read as missing there.

### 4. Dylib loaded with no ABI check, symbols cached once — MEDIUM

- `src/packaging/extension-bindings.ts:66-108` — the generated module now builds its handle inside
  `open()` and every export calls `ffi.symbols.<name>()` through the current handle instead of a
  `const` bound at module evaluation.
- `src/packaging/extension-bindings.ts:24-50,88-93` — new `ABI_SYMBOL` (`crust_extension_abi`) and the
  optional `abiVersion` option. With `abiVersion` set, the module declares the marker in its `dlopen`
  table and refuses to open a dylib that answers another number (or does not export it at all). With no
  `abiVersion` the marker is not declared, so every existing C source still binds — the check is opt-in
  and versioned per generated module.
- `src/packaging/extension-bindings.ts:96-109` — new exported `reload()`: closes the handle and
  re-opens it, so a rebuilt dylib answers without restarting the runtime. This is the dev-loop half of
  the finding: the runtime's watcher only restarts on `.ts` edits
  (`src/cli/dev/runtime.ts:132-137`), and a `.ts` edit that does restart now goes through a module whose
  symbols are re-read at call time, while a build that replaces the artifact without a restart has
  `reload()` available.
- Measured while fixing: a second `dlopen` of a replaced path returns the already-loaded image, and an
  already-open handle keeps answering from the build it opened, so `close()` + `dlopen` is the only
  sequence that picks up a rebuilt dylib (probe in the session temp dir, `probe4.ts`: `a 112` then
  `b -988` after `close()`). That is why `reload()` closes first.

### 5. Duplicate-name contract: only the second was refused — LOW

- `src/extensions/load.ts:1-6` — the module doc now states what the code does (a name is a namespace and
  every claimant is refused), so the contract and the behaviour say the same thing.
- `src/extensions/load.ts:60-85` — the loader counts claimants per name first and then refuses *every*
  file that claims a duplicated name, each with an error naming the other claimants. Distinct names
  beside them still load, in filename order. Previously the first was served and only the second got an
  error, which is the silent shadowing the module doc claimed to prevent.

### 6. `pgrep -f` got an unescaped host path — LOW

- `src/packaging/extension-pattern.ts` (new) — `pgrepLiteral(text)` escapes every extended-regex
  metacharacter, so a repo path with `.`, `(`, `[` or `+` matches only itself.
- `scripts/e2e-native.ts:38-42` — `SURVIVOR_PATTERNS` is built from `pgrepLiteral(CONFIG)` and
  `pgrepLiteral("dev --dir examples/native")`, covering `clearSurvivors`, `survivorsOf` and the
  catch-block cleanup, which all take the same array.

## Tests added

- `src/packaging/extension-tools.test.ts` — `zig.exe` is found with `platform === "win32"` and is
  *not* found by the bare-name probe (the pre-fix behaviour); PATH scanning across several entries; an
  empty PATH entry is skipped; `dylibSuffix` per platform.
- `src/packaging/extension-compile-platform.test.ts` — the clang flag is `-shared` on Linux/Windows and
  `-dynamiclib` on darwin, with the emitted `.so`/`.dll`/`.dylib`; zig and rustc follow the same suffix
  and `rustc` drops the `lib` prefix on Windows; the default platform is the host's contract, not a
  silent macOS.
- `src/packaging/extension-compile-real.test.ts` — the real-toolchain block moved out of
  `extension-compile.test.ts` (which had grown to 265 lines) into its own file, sharing the temp-dir
  helper and the toolchain table through `src/packaging/extension-test-kit.ts`. It now includes
  **clang**, so the C command line is compiled and `dlopen`ed for real instead of only asserted against
  a recorder. That is the block that would have caught the `-dynamiclib` defect in CI.
- `src/packaging/extension-bindings.test.ts` — the generated text: exports call through the handle, no
  `ffi.symbols.x as` capture, `reload()` exists; with no `abiVersion` the marker is absent, with one it
  is declared and the mismatch message is emitted; every variant still parses.
- `src/packaging/extension-bindings-abi.test.ts` — compiles a real dylib and imports the generated
  module: answers 7, then after a rebuild still answers 7 (the stale-symbol defect) until `reload()`,
  which answers 42; a module generated for ABI 9 rejects the ABI 2 dylib with
  `is ABI 2, this module was generated for 9`; and a module with no `abiVersion` binds a dylib that
  exports no marker.
- `src/extensions/load.test.ts` — "two files claiming one name are refused together": both files are
  refused, `extensions` and `loaded` are empty, and each error names the other file. Plus a third
  claimant and a distinct name beside them still loading.
- `src/packaging/extension-pattern.test.ts` — the escaped path no longer matches `crustXconfig-ts` while
  still matching `crust.config.ts`; a metacharacter-free string is unchanged; and the native e2e's
  `SURVIVOR_PATTERNS` really calls `pgrepLiteral` (a helper nobody calls would fix nothing).

## Closed since this report

- **`site/app/docs/guides/native-extensions/page.mdx`** — the argv table now names `<ext>` as the
  host's suffix with all three spelled out (`.dylib`, `.so`, `.dll`), the `clang` row says
  `-dynamiclib on macOS, -shared elsewhere`, and `:29` documents `abiVersion`,
  `crust_extension_abi` and `reload()`. Re-read against `src/packaging/extension-bindings.ts:55-63`
  before writing this line.
- **`scripts/native-extensions.ts`** — no longer names a `.dylib`: the suffix is left to
  `writeBindings`, which uses the host's (`rg -n 'dylib:' scripts/native-extensions.ts` is empty).

## Not fixed / needs another lane

- **`examples/native/README.md:36-41`** says a native extension's dylib is never in a standalone bundle
  (finding 1's evidence path) — unchanged and correct, finding 1 was not mine.
- **`src/cli/dev/runtime.ts`** — the dev-watch half is now closed by the `runtime`/`cli` lane: the
  watch's directory set includes `native/` when it exists, so a rebuilt dylib restarts the runtime.
  The generated module's `reload()` is still available. `extensions/generated/` is not watched.
- **Finding 7** (the C path is never exercised by a real compiler) was not in my list, but the clang
  entry added to `extension-compile-real.test.ts` closes it, so CI now compiles the C command line.

## Durable notes

- `dylibSuffix` has exactly one home (`src/packaging/extension-tools.ts`); the barrel exports it via
  `export *` from there. Do not re-export it from `extension-compile.ts` — two export paths for one
  name is how the three call sites drift apart again.
- bun's `dlopen` resolves every declared symbol when it opens the file, so declaring the ABI marker is
  what turns a missing/renamed one into a load-time error rather than a null call. Measured.
- A second `dlopen` on a path whose file was replaced returns the already-loaded image (macOS keeps the
  inode); `close()` then `dlopen` is the only way to pick up a rebuild. Measured with two clang builds
  in one process.
- `check:lines` counts test files, so a suite that outgrows 200 lines is split by responsibility —
  `extension-compile{,-platform,-real}.test.ts` and `extension-bindings{,-abi}.test.ts` are that split,
  not a trim. The shared temp-dir helper and toolchain table for the first three live in
  `src/packaging/extension-test-kit.ts`, which is a fixture, not a test (no `.test.ts`, so the runner
  skips it).
