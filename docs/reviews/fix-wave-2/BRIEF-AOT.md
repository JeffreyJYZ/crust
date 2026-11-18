# F9, corrected: the AOT probe was wrong

Lane F9 concluded AOT was unreachable. That was the wrong probe: it tested the `bun compile`
subcommand, which stable Bun does not have, and never tried the flag that does exist.

## What is actually true, measured on this machine

```
bun build --compile --aot --outfile …   exit 0, binary produced, runs      (Bun 1.4.4+38afee6c8)
                                        `bun compile --help` → exit 1, "Script not found compile"
p1 (--aot) vs p2 (no flag) on a 1-module entry: both 89,159,906 B, so nothing to measure there
```

So the capability exists as a **flag**, and the branch in `src/packaging/build.ts:64` detects it the
wrong way — it spawns `bun compile --help`, which is a *subcommand* probe, so it always answers "no
AOT" on 1.4.4 and always takes the plain `bun build --compile` path.

## Read this first

`docs/reviews/fix-wave-2/BRIEF.md` has the shared rules. One tree, `rg`/`fd`, foreground builds,
200-line cap, never `bun fmt` without paths, only your own files.

## Lane F9b — `fix-aot`

Own: `src/packaging/build.ts`, `scripts/build-standalone.ts`, `.github/workflows/release.yml`, and
tests beside them.

1. **Fix the detection.** The branch must ask whether `--aot` is accepted, not whether a `bun compile`
   subcommand exists. The cheap honest test is to try the flag on a tiny scratch entry once and cache
   the boolean, or to parse `bun build --help` for `--aot`. Whatever you choose, it must answer
   correctly on stable 1.4.4 (it is accepted) and must not silently take an unsupported flag on an
   older Bun (then it must fall back).

2. **Measure the real win, on a real app.** Build `examples/hello` twice — with and without `--aot` —
   and report both byte counts from `stat -f '%z'`. The documented claim is 85.27 → 53.10 MiB on
   canary; verify whether stable 1.4.4 gets any of that. If stable gets nothing, say so with the two
   numbers and keep the flag anyway (it is free), or drop it — decide on the measurement.

3. **Pin the toolchain.** `release.yml` has no `bun-version` on any `setup-bun@v2` step, so the
   released binary's size depends on whatever setup-bun defaults to that week. Pin the version
   explicitly. If canary is needed for the size win, pin the canary revision and say so in a comment
   with the measurement that justifies it; do not pin a floating `canary`.

4. **Then confirm the release still works.** `bun run e2e:package` must stay 22/22, and
   `bun run test` must not regress.

Do not change `~/.bun/bin/bun` — swapping this machine's global toolchain is not yours to do. If you
need a canary to measure, download it into your own temp dir and run it by absolute path, then delete
it.

## Final message

Under 12 lines. Bullets. Both byte counts, whether stable wins anything, what you pinned, what broke.
