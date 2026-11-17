# release-probes lane — fix wave

## Fixed

- `.github/workflows/release.yml:28-31, 56-65` — release now starts as a **draft**. `gh release create`
  gained `--draft`; an existing release is forced back to draft on retry and its `— FAILED BUILD`
  title is reset. A failed leg can no longer leave a public "Latest" holding a subset of the assets.
- `.github/workflows/release.yml:126-131` — `verify` now has `needs: [create-release, build]` and
  `if: ${{ always() && needs.create-release.result == 'success' }}`, so it runs after a failed build
  leg and reports which assets are missing instead of being silently skipped.
- `.github/workflows/release.yml:146-158` — new `publish` job with `needs: [create-release, build,
  verify]` and no `if`. GitHub skips it unless all three succeeded; only it runs
  `gh release edit … --draft=false`. This is the sole publish point.
- `.github/workflows/release.yml:160-177` — new `flag-failed` job that retitles a draft
  `— FAILED BUILD` when build or verify failed. It does not mutate notes, so a retried tag keeps its
  generated notes. `gh release edit` has no `--generate-notes` flag (checked against local `gh`),
  which is why the flag is in the title only.
- `scripts/release/gate.ts:5, 36-37` — import `shAll` instead of `sh` and use it for every summary
  command. `bun test` writes its totals to stderr, so a stdout-only read always reported
  `totals not parsed`. The existing `shAll()` helper in `git.ts` was already there for this exact
  purpose; it just was not used.
- `scripts/e2e-parity-patterns.ts:4-6, 8, 12` — `MENU` no longer matches `read unavailable`,
  `SHORTCUT` no longer matches `seam unavailable`. Header comment now states a line proves its
  surface or proves nothing.
- `examples/parity-probe/proofs.ts:68-71` — the no-`read` branch marks `menu` **false** instead of
  marking it true on `setAppMenu` alone. Setting the bar is not reading it.
- `examples/parity-probe/proofs-window.ts:86-90` — the no-seam branch marks `shortcut` **false**
  instead of true. Registration alone never emitted a chord.
- `scripts/e2e-native.ts:97-111` — `direct ffi` now computes `directZig`/`directRust` once, uses them
  for both the assertion and the detail, and drops the false claim that both epochs were read "before
  the window opened" (nothing measures ordering; the runtime opens the window before page scripts).
- `scripts/e2e-notify.ts:165-172` — `no survivors` computes `survivors` once and branches the detail
  on its length. A leaked process is now reported as `pid … still running`, not "no process matches".

## Tests added

- `scripts/release/gate.test.ts` — mocks `./git.ts`; asserts `gate()` calls `shAll bun run test`, never
  `sh bun run test`, and that the `test` step detail is `6 passed, 0 failed` when totals arrive on
  stderr. Fails on the old `sh` call.
- `scripts/release/release-workflow.test.ts` — reads `release.yml` and checks the invariant: create
  emits `--draft`, only a `publish` job emits `--draft=false`, it has no `if` and needs
  `create-release, build, verify`, verify runs under `always()`, and `flag-failed` marks the draft.
- `scripts/e2e-parity-patterns.test.ts` — `MENU`/`SHORTCUT` accept the proved line and reject the
  unavailable/refused forms.
- `scripts/e2e-detail.test.ts` — asserts the native and notify details branch on their assertions
  and that unavailable menu/shortcut surfaces are marked false. Reads probe source because the
  probes need an Aqua session; the detail string is their unit-testable edge.

Verification run: `bun test` on the four files → 9 pass / 0 fail; `bun run check:lines` PASS;
`ruby -ryaml -e 'YAML.load_file(...)'` → `release.yml parses`; `bun fmt` applied to the changed TS
files only.

## Not fixed / for the coordinator

- **`scripts/e2e-native.ts` has two owners.** `LANES.md` lists it under `release-probes` via
  `scripts/e2e-*.ts` **and** explicitly under `extensions`. Finding 5 (11-probes.md) is in my task,
  so I made a single surgical edit at lines 97-111. The extensions lane has a different finding
  (17-extensions.md #6, the `pgrep -f` host path at line 35) in the same file. Check both edits
  survived; no other line in that file was touched.
- **`bun check` is red from other lanes' in-flight work**, not from my files: `src/cli/parse.ts:63,68`
  (cli), `src/packaging/extension-compile.ts:73,101` duplicate `compileExtension` (extensions),
  `src/platform/linux/platform.test.ts:13` (linux). My files produced no type errors.
- The four test files live in `scripts/` and `scripts/release/`. Only `scripts/release/` is in the
  `test` package script; the three `scripts/` root tests are discoverable with an explicit path but
  are not in the standard suite. Adding `scripts` to that path means editing `package.json`, which
  my brief forbids.
- The workflow was not executed. YAML was parsed locally; the publish/flag logic is reasoned from
  GitHub Actions' `needs` semantics, not from a live run.
