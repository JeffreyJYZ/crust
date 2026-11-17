# Lane B — sidecar binaries

**Built.** `build.sidecars: string[]` config (types, validate-build: relative only, no `..`/`.`/absolute, config error names index). `crust build` copies each to `<binary dir>/<name>` at 0755 and writes `crust-sidecars.json` manifest beside the binary. `sidecar` plugin registered in both nativePlugins arms; reads manifest for declared names, `spawn(name, args)` → `{id,name,pid}`, `sidecar-stdout`/`sidecar-exit` events. Typed refusals: not-declared, path-escape, missing, invalid-args.

**Butter cases matched:** undeclared name refused; missing file refused before spawn; exit event fires even mid-stream, signal → `code:null`. stdout/stderr both arrive as `sidecar-stdout` (no stream field — deliberate).

**Manifest wire:** packaging can't be reached from `src/cli/build.ts` (not my file), so plugin reads names from the manifest `crust build` writes. No manifest → no names → every spawn refused (deny-by-default). Split files (sidecar.ts 145, -types 72, -locate 42) to hold 200-line cap.

**Tests:** 15 pass across `sidecar.test.ts` (7, fake child, no real process), `validate-sidecars.test.ts` (5), `sidecar-copy.test.ts` (3). `bun check` clean for my files; only error is Lane C's `fake-shim.ts` (`shim_window_set_material`). `check:lines` PASS. Guide at `site/app/docs/guides/sidecar`.
