# Skip allowlist audit — B7

Audit of `bun run test:no-skips` and the `ALLOWLIST` in `scripts/check-skips.ts`.

## Finding: the premise is wrong — the allowlist is empty

`BRIEF-8.md` says `test:no-skips` "allows a small list of skips". It does not.

- `scripts/check-skips.ts:15`: `const ALLOWLIST = new Set<string>([]);`
- Zero entries. Any skip, on any platform, is an offender.
- `docs/agents/check-skips.md:29-34` confirms the empty start and the exact-match rule.

No change made. An empty allowlist is the safe state: nothing can be hidden.

## Real run

Command: `bun run test:no-skips`

- Suite: `1830 pass`, `0 fail`, `0 skip`, `6790 expect() calls`, 300 files, 19.63 s.
- Checker: `check-skips: no unapproved skips`, exit `0`.
- Actual `<skipped>` testcases in the JUnit report: **0**.
- Allowlist entries: **0**. Diff (actual minus allowed): **0**.

## The check is not vacuous

Forced skip in a temp test, run through the same reporter and checker:

- XML: `<testcase name="a skipped one" ...><skipped /></testcase>`
- Checker: `skipped test: a skipped one` then
  `check-skips: 1 skipped test(s) not in allowlist`, exit `1`.

The `skipped="1"` suite attribute is ignored; the checker reads `<testcase>` children, so a real
skip is caught. The green above is a real green, not a broken detector.

## Allowed skips whose reason went stale

None. With no entries there is no entry to re-verify.

The four dynamic `test.skip()` sites are environment gates, not stale skips:

- `src/platform/darwin/screen.test.ts:43-53` — skips only when `SCREENS.length === 0`, and a
  `coverage guard` test at `:52` fails on that host, so a headless run cannot read green.
- `src/packaging/extension-compile-real.test.ts:18` — skips when the tool is not on `PATH`.
- `src/packaging/extension-bindings-abi.test.ts:42,86` — skips when `CLANG === undefined`.

All four were inactive on this host: clang is on `PATH` and a display is present.

## Platform skips on CI

CI has all three platforms (`.github/workflows/ci.yml`). Of the 17 `skipIf` call sites:

- 15 fire on Linux and Windows (`notDarwin`, `process.platform !== "darwin"`, `skip`, `darwinOnly`).
- 2 fire on Linux only (`process.platform === "linux"`).

Wiring `test:no-skips` into CI would therefore report 15-17 legitimate platform skips as
unapproved on the Linux/Windows jobs and fail them. That has not happened:

- `ci.yml:60` runs `bun run test`; `:248` runs `bun test src/platform/linux`; `:305` runs
  `bun test src/platform/windows`. None calls `test:no-skips`.
- `docs/agents/check-skips.md:36-37` records the wiring as a separate, unmade decision.

So no allowed skip can hide a darwin-only regression on CI: the allowlist has no entries and the
check is not on CI. This stays a recommendation — if CI adopts the check, each platform skip needs
an allowlist entry with its own justification, not a blanket wildcard.

## Bottom line

Nothing to fix in `scripts/check-skips.ts`. Leave `ALLOWLIST` empty. The audit found no stale
reason, no hidden platform regression, and no vacuous pass.
