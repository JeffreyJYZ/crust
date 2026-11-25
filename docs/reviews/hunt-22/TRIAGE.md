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

## Counting rules

- `fixed` needs a test that failed before the change and passes after, named in the PR.
- `argued down` must quote the code or the measurement that refutes the report.
- `hypothesis` is a finding whose lane could not reproduce it; it is listed, not chased.
- A report's own `checked and clean` section is not re-audited here; the lane that wrote it had the files
  open and the absence of a finding is its claim.
