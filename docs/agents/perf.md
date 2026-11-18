# perf lane — measured facts and traps

Measured 2026-11-18, crust 0.1.26, Bun 1.4.4, M4 Air / macOS 27. Full report: `docs/reviews/next-wave/perf.md`.

## Measured facts

- Binary 90,365,282 B (86.18 MiB) via `bun run src/cli/index.ts build --dir <tmp>` + `stat -f '%z' <tmp>/dist/crust-app`; evidence page's 85.27 MiB row and README's "~85 MB" are stale by ~0.9 MiB.
- `bun compile --help` exits 1 on stable 1.4.4, so the AOT branch in `src/packaging/build.ts:64-102` is dead here; `--trim` strips nothing (`build.ts:2`).
- Warm launch: window 232–265 ms (median 244.1), first page invoke 415–622 ms (median 428.8), measured by timestamping stdout of `<bundle>/Contents/MacOS/crust-app`.
- Cold first launch 1,322 ms to window / 1,600 ms to invoke; evidence worst is 790 ms / 1.70 s.
- `bun -e 'await import("./src/runtime.ts"); process.exit(0)'` 16.6 ms vs bare bun 4.4 ms — app JS adds ~12 ms, rest is embedded Bun + AppKit/WKWebView.
- Idle group footprint 120.7 MiB (`footprint -p`), `ps` RSS 252.5 MiB; evidence claims 101–102 / 158–178. Main crust 52 MiB, WebKit helpers 68.5 MiB.
- 10k invokes: crust bridge 27,583/s p50 0.036 ms p99 0.062 ms; plain `Bun.serve` 29,000/s p50 0.034 p99 0.063 — token/origin/capability layers cost ~5%.
- Real shim: compile+load 21–22 ms, per call 26–54 ns over 10k. Direct `bun:ffi` call 2 ns (`research/libffi/micro.ts`). Per-call FFI is free next to a bridge hop.
- Warm crust build 361.5 ms mean, 482.6 MiB compiler peak (`hyperfine`); evidence says 0.52–0.55 s.
- `research/bridge/concurrency.ts`: three 200 ms sync handlers take 600.2 ms wall; one blocking handler stalls every invoke.

## Traps

- hyperfine here does not honour `> /dev/null 2>&1` inside the timed command — crust answers `unexpected argument 2>&1`; wrap the command in a shell script and time the script instead.
- Building a copied example outside the repo fails `Could not resolve: "crust"`; symlink `node_modules/crust -> <repo>` in the temp project first.
- `vmmap --summary` prints no `PHYSICAL FOOTPRINT` line on this macOS; use `footprint -p <pid>` and parse `Footprint: N KB`.
- WebKit helpers reparent to PID 1, so `pgrep -P` misses them; snapshot all PIDs before launch and diff after, then filter `crust-app|WebKit`.
- `ps` RSS for a WebView group overstates private cost by shared framework pages; quote `footprint` for physical cost.
- Launching a built crust app activates it (`-activateIgnoringOtherApps:`); hand focus back with `open -a Ghostty` in the same shell call.
- FFI `cstring` arguments are declared as pointer `P`; pass `cstr(s)` from `objc.ts`, never a JS string, else `TypeError: To convert a string to a pointer, encode it as a buffer`.
- Kill the launched probe by the exact PID returned from `Bun.spawn`; never guess a PID set, and verify no helpers survive.
- `examples/hello` has no `package.json`, so `missingInstall()` returns undefined and a temp build needs no `bun install`; a real scaffold with deps would need it.
