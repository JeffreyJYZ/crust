# hunt-22 triage

25 read-only lanes, one area each, none allowed to fix. This file records what happens to each
finding: whether it is real, who fixes it, and the test that proves it. A finding without a reproduction
or a code path stays `hypothesis` and is not counted as fixed.

## Severity as reported

| report | high | med | low | lane |
| --- | --- | --- | --- | --- |
| 01 bridge/server | 0 | 0 | 3 | h22-surface |
| 02 bridge/client | 0 | 3 | 4 | h22-surface |
| 03 darwin | 1 | 4 | 2 | h22-shim |
| 04 linux | 0 | 4 | 4 | h22-linux |
| 05 windows | 0 | 5 | 4 | h22-polish |
| 06 ui plugins | 0 | 3 | 3 | h22-authority (token) · h22-polish (rest) |
| 07 data plugins | 1 | 5 | 2 | h22-scope |
| 08 system plugins | 1 | 3 | 4 | h22-runtime |
| 09 runtime | 0 | 4 | 2 | h22-runtime |
| 10 cli | 0 | 3 | 0 | h22-polish |
| 11 packaging | 2 | 3 | 3 | h22-sign |
| 12 logging | 0 | 2 | 3 | h22-polish |
| 13 testing plugin | 0 | 4 | 2 | h22-shim |
| 14 perf | 3 | 3 | 4 | h22-perf |
| 15 templates | 0 | 1 | 2 | h22-polish |
| 16 docs | 0 | 4 | 3 | h22-polish |
| 17 concurrency | 1 | 2 | 1 | h22-runtime |
| 18 errors | 0 | 1 | 2 | h22-surface |
| 19 security | 2 | 2 | 0 | h22-authority · h22-scope |
| 20 leaks | 0 | 2 | 5 | h22-polish |
| 21 types | 0 | 4 | 7 | h22-surface |
| 22 tests | 0 | 2 | 6 | h22-polish |
| 23 compiled | 0 | 1 | 3 | h22-polish |
| 24 events | 0 | 2 | 2 | h22-runtime |
| 25 accessibility | 0 | 2 | 2 | h22-surface |

Totals as reported: **9 high, 64 medium, 76 low.**

## The highs, and why each is real

1. **19** `window.create` with a bridge-owned URL drops `?window=`, so a caller granted only
   `window:create` reaches `main`'s grants — measured `200` on `test:echo` from a worker-only caller.
   Same path with `//host` sends that token to a foreign origin.
2. **19** (second) is the same primitive; counted separately because it exfiltrates rather than escalates.
3. **07** SQLite `ATTACH DATABASE ?` takes an absolute path as a bound parameter, escaping the root —
   measured reading a file outside it, and on a `readonly` handle.
4. **07/19** `fs` canonicalises a path and then opens the raw one — measured outside-file read after an
   in-scope check. Same class as the `i18n.load` bypass.
5. **03** a `WKContentWorld` is cached without retain and freed by the per-tick autorelease drain, so the
   cached pointer can dangle. This is the only use-after-free in the set.
6. **08** macOS autostart writes the `.app` directory as `ProgramArguments[0]`, so launchd fails to `exec`
   while `enable` answers `enabled: true`.
7. **11** sidecars stay ad-hoc signed because `codesign` will not re-sign already-signed nested code, so
   notarization rejects them.
8. **11** no `--timestamp` on the Developer ID path, which Apple names as a notarization failure.
9. **14** the sampler's 10 s window never applies, so p50/p95 are stale and the array grows unbounded —
   which means published frame numbers over ten seconds are wrong.
10. **17** the single-instance lock compares then unlinks in two syscalls; 1 double-acquire in 100 pairs.

## Outcomes

| PR | area | closed |
| --- | --- | --- |
| #67 | packaging | sidecars Developer-ID signed before the app, `--timestamp` on that path only, `codesign --verify --deep`, staple reason surfaced, NSIS `CreateDirectory` before nested `File /oname=` |
| #68 | authority | `window.create` binds the mint to the native label (escalation now `403`), bridge `Location` is absolute so a token cannot travel off-origin, `withToken` compares decoded keys so `%74oken=` cannot shadow the seed |
| #69 | perf | sampler window actually prunes, one clock per sample, recorder exits on a signal; published frame numbers re-checked and unaffected |
| #70 | linux | 0700 per-user native source dir with `lstat` refusals, preflight list derived from the shipped C, 33rd window refused, policy handlers before first load, GTK leak and slot release, dead ternary |
| #71 | scope | `ATTACH`/`VACUUM INTO`/`load_extension` refused outside the root, `fs` operates on the path it validated, `i18n.load` respects scope |
| #72 | bridge/types | inherited `Object.prototype` names are unknown commands and 4xx refusals, server faults are 5xx, `typedHost` ctx stops lying, crash records validated at the disk boundary |
| #73 | audit | retain/release audit build: `CRUST_SHIM_AUDIT=1` in dev/e2e only, per-unit balance, gate fails on imbalance |
| #74 | perf tail | overlay validates the sample shape and cannot throw unhandled, `longTasks` is `n/a` not `0` when unsupported, `perf diff` writes failures to stderr |
| #75 | runtime | autostart argv, quit events reach the page, single-instance lock is atomic, stronghold commits not dropped, deep-link throws cannot leave a half-started app |
| #76 | shim | `WKContentWorld` retained against the pump's drain (the only use-after-free), tray/menu/find/announce releases, AX focus checked, `menu.read` walks every level, `trusted` distinguishes no-grant from compile failure, testing eval slot cannot cross-talk |
| #77 | tail | multi-cookie redaction, compiled apps stop serving `cwd/public`, gate tests assert the abort, CLI `$` substitution, Windows tray newline, cursor idempotency, templates, docs |
| #78 | test | the eval budget is measured in pump progress, not wall clock — a stopped pump and a hung page stopped reading alike, which reddened four PRs |
| #79 | leaks/logging | `runCommand` cancels its deadlines (512 ms → 24 ms hold), mirror line forgery (2 lines → 1), `seed`/`sid`/`keychain` redacted, one 2000-char page cap with a visible `…`, `__proto__` preserved. Overlay listener **argued down**: `destroy()` already calls the remover; a test counting add=1/remove=1 passes on unchanged source |
| #80 | window | `invalid-title` gets its own code instead of overloading `invalid-label`, mapped to 400, documented in four places; the encoded-token item was already fixed by #68 and was not re-fixed |
| #81 | compiled | framework cache moved to a private 0700 XDG dir with a content-hash marker and a planted-`runtime.ts` refusal, asset symlinks refused rather than silently skipped, stale `dist/single` output cleaned |
| #82 | tests | six assertions that could not fail now fail when the bug is reintroduced — proven by disabling `reapChildren()` and finding 4 live children plus 4 leaked dirs, then zero |
| #83 | dev tokens | `19` F3 settled as a **documented non-fix**: the dev path has no server-side identity to bind a label to (navigation carries only `?window=`, Vite's transform context exposes no request, the handshake has `{url, token, tokens}` with no grant sets), so "Dev is not a boundary" is now stated in the dev and permissions guides |
| #84 | shim | the four `class_addMethod` units dispose their class pair on every failure path, naming the selector — 13 branches proven against a fake ObjC runtime that refuses a reallocation while a pair is live, so the wedge's own symptom is the assertion |
| #85 | test | the live-page test skips with a stated reason when `_setWindowOcclusionDetectionEnabled:` is absent, instead of asserting a private selector exists on every runner; the skip is allowlisted in `scripts/check-skips.ts` with the reason in `docs/agents/check-skips.md`, and a forced-absent run shows `<skipped />` rather than a pass |

## Final state

**19 PRs merged, 0 open.** Every high is closed. Of the mediums and lows: fixed with a red-then-green
test, argued down with a quoted reason, or — in one case — settled as a documented limit with its
consequence stated where a user reads it (`#83`). Two findings were refuted by a test that passes on
unchanged source (`20` overlay listener, part of `15`/`22`), which is the outcome a hunt wants and a
report rarely records.

Nothing in this set rests on "looks right": where runtime evidence was impossible — Linux GTK paths, the
signing argv without a certificate — the report says so instead of implying a run that did not happen.

**Not closed: `main` `ad64d56` is red.** The macOS gate fails `a live page > click, type and console work
in a real WKWebView` with `crust: the page did not answer within 4000 ms` (run 45558100308). The selector
was available, so `#85`'s skip did not fire, and `testing-darwin.ts:99` passes `pumpProgressMs`, so that
deadline counted pump progress — the loop was ticking and one evaluation's completion never arrived. That
is a defect in the testing plugin's id correlation, which `crust dev` testing commands share, and it is
being fixed rather than skipped. Until it is, this file describes the intended end state, not a green one.


Final counts: **10 of 10 highs closed**, every medium either fixed or argued down in a PR with a
reason, and the low tail closed by #77, #79, #81 and #82. Two findings were refuted by test rather than
fixed (`20` overlay listener, `15`/`22` partial), and `19`'s dev-Vite token selection was settled on
2026-11-25 as a documented non-fix: the dev navigation carries no server-side window identity, so
neither binding nor a subset rule can be built, and the only credential-free constraint would widen
grants or remove per-label dev testing. The consequence is written in
[Dev server](/docs/guides/dev#dev-tokens-and-window-labels) and
[Permissions](/docs/guides/permissions#dev-is-not-a-boundary); the evidence is in
`docs/reviews/hunt-22/19-security.md`.

## Counting rules

- `fixed` needs a test that failed before the change and passes after, named in the PR.
- `argued down` must quote the code or the measurement that refutes the report.
- `hypothesis` is a finding whose lane could not reproduce it; it is listed, not chased.
- A report's own `checked and clean` section is not re-audited here; the lane that wrote it had the files
  open and the absence of a finding is its claim.
