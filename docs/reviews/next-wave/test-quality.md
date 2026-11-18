# Lane 7 — test quality

Field: tests that pass for the wrong reason, and behaviour with no test.
Measured 2026-11-18 on this darwin Mac at `0e8d2c2`. Commands quoted, not just numbers.

## 1. The gate never runs 171 tests in 29 files (highest impact)

`package.json:31` builds the `test` script from an explicit prefix list:

```
bun test src/bridge src/plugins src/platform src/cli src/packaging scripts/release \
  scripts/docs-reference.test.ts scripts/e2e-detail.test.ts \
  scripts/e2e-parity-patterns.test.ts scripts/butter-sweep.test.ts
```

Absent from that list: `src/config/`, `src/extensions/`, every root-level `src/*.test.ts`, and
`examples/`.

- `bun run test` → `Ran 1558 tests across 245 files`. Zero output lines name any of those paths.
- `bun test <the 29 omitted files>` → `171 pass / 0 fail / 449 expect() calls`.
- `bun run verify` (`package.json:58`) is narrower still: `src/bridge src/plugins src/platform`.
- CI runs only `bun run test` (`.github/workflows/ci.yml:60`); the linux and windows jobs add just
  `src/platform/linux` and `src/platform/windows` (`:248`, `:305`).

Whole areas therefore have no gate coverage: config validation (`src/config/validate-*.ts`, 10 test
files), extension wiring (`src/extensions/*.test.ts`, 4), single-file mode (`src/single-*.test.ts`),
app lifecycle (`src/app-*.test.ts`), runtime plugin registration (`src/runtime-plugins.test.ts`),
crash guard (`src/runtime-crash-*.test.ts`), and `examples/notes/paths.test.ts`.

The omitted tests are green when run by hand. No automation runs them, so a green gate proves the
245 collected files and says nothing about the other 29. This is the reverse of a hollow assertion:
good assertions nobody executes.

What would prove it fixed: add the missing prefixes to the `test` script (or run `bun test src`),
then assert the collected file count equals the number of `*.test.ts` files outside the vendored
`research/` mirror. The related trap in `docs/agents/README.md` — `bun run test <path>` does not
scope, because bun appends to the script's existing prefixes — is the other half of this bug.

## 2. `scripts/release/targets.test.ts:18-22` — the win32 branch never runs here

The test is named "win32 is spelled windows, the way the table spells it", but it builds the
expected value with the same expression as the code under test:

```ts
const key = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
expect(hostTarget()).toBe(key as never);
```

`hostTarget()` (`scripts/release/targets.ts:34`) uses that identical conditional. On this Mac
`process.platform` is `"darwin"`: `bun -e 'console.log(`bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`)'`
prints `bun-darwin-arm64`. The win32 arm never evaluates, so the assertion collapses to
`hostTarget() === "bun-darwin-arm64"` — a duplicate of the first test in the file (`:12-16`).

The comment (`:4-6`) calls this "the whole bug" and cites a real 2026-11-17 release failure, but
nothing in the test would catch a regression of the win32 spelling on a darwin or linux runner.

What would prove it: make the mapping injectable (`hostTarget(platform, arch)`) or mock
`process.platform`, then assert `bun-windows-x64` for `win32/x64` and `bun-darwin-arm64` for
`darwin/arm64` as two literal expectations.

## 3. Two tests pass with zero assertions when a tool or device is missing

A bare `return` before any `expect` is a pass in bun, not a skip.

- `src/packaging/extension-bindings-abi.test.ts:84-85` — "a module with no abiVersion binds a dylib
  that exports no marker" opens with `if (CLANG === undefined) return;`. With no clang on PATH the
  test reports pass having run nothing. Its sibling at `:42-44` does the same guard correctly with
  `test.skip("skipped: clang is not on PATH")`, so the two disagree on what "absent" means.
- `src/platform/darwin/screen.test.ts:39-43` — "the primary flag is AppKit's, not index 0 by
  assumption" does `if (screens.length === 0) return; // headless` before its only assertion. A
  headless run passes without checking the primary flag at all.

Most other bare returns in the suite are preceded by an `expect` that narrows the type (for example
`src/cli/build.test.ts:44-45`), so they cannot pass hollow. These two have no preceding assertion.

What would prove it: replace both bare returns with `test.skipIf(...)`, and add a coverage guard
asserting the precondition was met on this run (clang found, at least one screen), so an
environment that skips everything cannot read as green.

## What is genuinely strong

Worth recording so the next wave does not re-litigate it: no unconditional `test.skip`, `todo`,
`.only` or `expect(x).toBe(x)` tautology exists in the collected suite. `src/platform/darwin/arity.test.ts:127-150`
and `src/cli/dev/entry.test.ts:93-105` add explicit guards against vacuous source-text assertions;
the generated-wrapper tests execute the generated entry (`src/cli/build/wrapper.test.ts:122-175`)
rather than only matching its text. The defect is collection and environment guards, not the
quality of individual assertions.
