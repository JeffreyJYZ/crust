# Perf — Lane 5

Measured 2026-11-18, macOS 27 arm64 (M4 Air), Bun 1.4.4, crust 0.1.26. Every number names its command. Build under `/private/var/folders/mv/nj8xwzr10psf34t9m8dsxhwc0000gn/T/opencode/perf-lane-hello`, removed after. The evidence page (`site/app/docs/evidence/page.mdx:3`) says its numbers came from 0.1.12–0.1.20; drift to 0.1.26 is expected, but the page still presents them as current.

## 1. Bundle size — docs stale by ~0.9 MiB

- Command: `bun run src/cli/index.ts build --dir <tmp>` then `stat -f '%z' <tmp>/dist/crust-app`.
- Measured: **90,365,282 B (86.18 MiB)** compiled binary; 89,840,064 B (85.68 MiB) after codesign inside the bundle; assembled app 90,374,144 B (86.19 MiB).
- Claimed: `evidence/page.mdx:57` "89,407,586 B (85.27 MiB)", `:58` "84.77 MiB" signed, `README.md:57` "~85 MB", `limits/page.mdx:42` "~85 MiB floor". The binary is 957,696 B larger than the evidence row.
- Cause: `bun compile --help` exits 1 here, so `src/packaging/build.ts:64-102` always takes `bun build --compile --trim`; `--trim` strips nothing on stable 1.4.4 (`build.ts:2,58-60`). The AOT branch is dead code on this machine.
- Fixable without architecture? **Yes, via toolchain.** The AOT path already exists; docs report 52.79–53.10 MiB with a Bun carrying `bun compile`, about 33 MiB less. No framework redesign. Fix the docs number either way.

## 2. Cold startup — worst case worse than documented

- Command: `bun run <tmp>/perf-lane-launch.ts <bundle>/Contents/MacOS/crust-app 6` (spawn, timestamp each stdout line, kill by PID).
- Warm (5 runs): bridge line 120–134 ms, runloop active 150–168 ms, window ready 232–265 ms (median **244.1 ms**), first page invoke 414.6–621.7 ms (median **428.8 ms**). One run in full: 134 ms bridge, 168 ms active, 265 ms window, 622 ms invoke.
- Cold first launch: **1,322.5 ms to window, 1,600.1 ms to first invoke**. `evidence/page.mdx:10` worst is 790.1 ms window / 1.70 s invoke, so cold window is ~1.7x the published worst.
- `hyperfine --warmup 1 --runs 5 'bun -e "await import(\"./src/runtime.ts\"); process.exit(0)"'` = 16.6 ms vs bare `bun -e "process.exit(0)"` 4.4 ms. App JS adds ~12 ms; the rest is embedded Bun startup in an 86 MiB binary plus AppKit/WKWebView.
- Fixable without architecture? **No.** AOT is measured _not faster_ (`build.ts:61`, 215.2 vs 211.9 ms on a 300M loop) and no splash path exists. A sub-200 ms cold budget needs a different runtime or a preloaded helper.

## 3. Memory — floor grew, docs stale

- Command: `bun run <tmp>/perf-lane-mem.ts <bundle>/Contents/MacOS/crust-app` (2.5 s idle; PID snapshot before/after; `footprint -p` and `ps -p` on only the 5 new PIDs).
- **120.7 MiB physical footprint** total: main crust 52.0, second crust 8.7, WebContent 21.0, GPU 14.0, Networking 25.0. `ps` RSS 252.5 MiB, inflated by shared framework pages.
- Claimed: `evidence/page.mdx:11` "101–102 MiB physical footprint ... 158–178 MiB ps RSS". Measured +~19 MiB footprint and +~75 MiB RSS.
- Fixable without architecture? **Not materially.** 68.5 of 120.7 MiB is WebKit's three helpers, 52 MiB is Bun+AppKit in the main process. Only reachable lever is which C units compile at launch (the AppKit shim alone is 21–22 ms).

## Checked, ruled out

- Bridge throughput: `bun run <tmp>/perf-lane-bridge.ts` — 10,000 invokes, crust **27,583/s** (p50 0.036 ms, p99 0.062 ms) vs plain `Bun.serve` **29,000/s** (p50 0.034 ms, p99 0.063 ms). Token, origin and capability checks cost ~5%. `keepalive.ts` reproduces the docs (reused 0.061 ms median, p99 0.113 ms).
- C shim per call: `bun run <tmp>/perf-lane-shim.ts` — compile+load 21–22 ms, then over 10k calls `shim_cstr_len` 26 ns, `shim_sel` 27 ns, `shim_mode` 28 ns, `shim_cls` 42–52 ns, `shim_mode_ok` 42–54 ns. `research/libffi/micro.ts` gives 2 ns for a direct `bun:ffi` call. Per-call cost is free next to the 0.036 ms bridge hop.
- Build time: `hyperfine --warmup 1 --runs 5 <tmp>/perf-lane-do-build.sh` — 361.5 ms mean (353.8–372.5), already faster than `evidence/page.mdx:56`'s 0.52–0.55 s. Compiler peak RSS 482.6 MiB is build-time only.
- One real constraint: `bun run research/bridge/concurrency.ts` — three 200 ms synchronous handlers take **600.2 ms** wall (`600.2, 600.2, 600.2`). A single blocking handler stalls every other invoke. Fixable only with workers or process isolation, i.e. architectural.

## Ranking

1. Cold launch to first invoke, 1.6 s worst — not fixable without an architectural change.
2. 86.18 MiB binary / 120.7 MiB footprint — size fixable through the existing AOT branch, memory not.
3. Synchronous handler serialisation, 3x200 ms = 600 ms — not fixable without workers.
