# Fix wave 2 — Lane F2 (updater URL policy, shell env fold, gate list)

Measured on darwin at `0e8d2c2` with Bun 1.4.4. Commands quoted, not just numbers.

## What changed

- `src/plugins/updater-url.ts`: `downloadUrlFailure` → `fetchUrlFailure`, with a `command` argument
  so the refusal names `download` or `check`. `DownloadUrlPolicy` → `FetchUrlPolicy`.
- `src/plugins/updater.ts` `check`: runs the endpoint through `fetchUrlFailure` before `fetchJson`
  and converts the refusal with `checkFailure`. https only; `file:` only with `allowFileUrl`.
- `src/plugins/shell-env.ts`: fold the key (`toLowerCase`) before the blocklist comparison;
  `DYLD_PREFIX` is now lowercase and `INJECTION_FOLDED` is precomputed. Refusal messages keep the
  caller's original spelling.
- `package.json` `test`: `bun test ./src ./examples scripts/release …`.

## Traps

- **`bun test src` sweeps the vendored `research/electrobun` mirror.** The path filter is a substring
  match, so a research path containing `/src/` matches. Measured: `bun test src` → 389 files,
  47 fail, 35 errors; `bun test ./src` → 266 files, 0 fail. The `./` prefix makes bun treat the
  argument as a path. A quoted glob (`bun test 'src/*.test.ts'`) is a filter, not a path, and runs
  nothing; the unquoted shell-expanded glob works locally but is unsafe on Windows CI.
- Applying the URL policy to `check` changes behaviour for a relative endpoint: the old test used
  `endpoint: "e"` and expected an adapter `check-failed`. It now gets `invalid-arguments`
  ("needs an absolute url"). That test was updated to an absolute https endpoint; the change is
  intentional, not a regression the fix hides.
- Bare relative endpoints in config are refused by `check` now. Any app relying on one must make it
  absolute.

## Proof

- `bun test docs/reviews/next-wave/probes/updater-check-ssrf.test.ts docs/reviews/next-wave/probes/shell-env-case.test.ts`
  → 3 pass / 0 fail (was 0 pass / 3 fail before the fix).
- `bun run test` → 1746 pass, 0 fail, 279 files (report baseline was 1558 / 245 files).
- `bun check` → no type errors in 768 files; `bun run check:lines` → PASS;
  `bun fmt --check` on the six changed files → all formatted.

## Not fixed (outside this lane)

- Mid-verification `bun check` showed 8 errors in `src/plugins/i18n.ts` and `src/runtime-plugins.ts`
  from another lane's in-flight edits; a later run was green without any change from this lane.
- The other capability, native-leak, docs and dev/sidecar wave items belong to their own lanes.
