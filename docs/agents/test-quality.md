# test-quality lane — next wave

Owned: `docs/reviews/next-wave/test-quality.md`, `docs/agents/test-quality.md`.
Measured 2026-11-18, darwin, `0e8d2c2`. Read code before trusting any line below.

## Gate collection

- `package.json:31` `test` script names explicit prefixes — `src/bridge src/plugins src/platform src/cli src/packaging scripts/release` plus four script files. It omits `src/config/`, `src/extensions/`, every root-level `src/*.test.ts`, and `examples/`.
- Counts: `bun run test` → 1558 tests / 245 files. Running the 29 omitted files directly → `171 pass / 0 fail / 449 expect() calls`. No automation runs them.
- `bun run verify` (`package.json:58`) is even narrower — only `src/bridge src/plugins src/platform`. CI (`.github/workflows/ci.yml:60`) runs `bun run test`; platform jobs add `src/platform/{linux,windows}`.
- A green gate proves 245 files, not the whole suite. Before claiming coverage, check the script's path list, not the file tree.
- `bun run test <path>` does not scope — the script's prefixes stay and bun appends; use bare `bun test <path>` (also in `docs/agents/README.md`).

## Hollow assertions found

- `scripts/release/targets.test.ts:18-22` — test named for the win32/pindows bug reconstructs the expected key with the same `process.platform === "win32"` conditional as `hostTarget()` (`scripts/release/targets.ts:34`). On darwin that arm never runs; assertion reduces to a duplicate of `:12-16`. Fix shape: inject platform/arch or mock, assert both spellings as literals.
- `src/packaging/extension-bindings-abi.test.ts:85` — `if (CLANG === undefined) return;` before any `expect`; clang missing means pass with zero assertions. Sibling at `:42-44` uses `test.skip` correctly. `src/platform/darwin/screen.test.ts:41` same shape for empty screen list.
- Most other bare returns are preceded by an `expect` that narrows the type (`src/cli/build.test.ts:44-45`), so they cannot pass hollow. Check for a preceding assertion before calling one a finding.

## Suite is otherwise strong

- No unconditional `test.skip`, `todo`, `.only`, or `expect(x).toBe(x)` self-comparison in the collected suite. Do not spend another wave hunting those.
- `src/platform/darwin/arity.test.ts:127-150` guards against a vacuous parser (`c.has(name)` checks, ≥8 binding files). `src/cli/dev/entry.test.ts:93-105` guards loader-line comparison with a length assertion. `src/cli/build/wrapper.test.ts:122-175` executes the generated entry. These are the model, not the defect.
- Windows/linux C tests read source text because the shim cannot run here; their headers say so. Not hollow — acknowledged weaker.

## Process

- One tree, no worktree. `rg`/`fd` scoped to a path. Never `bun fmt` without a path list. No file over 200 lines.
- Do not edit tests or source on this lane — report only. Own two docs paths.
