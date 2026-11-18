# docs-guides-a (D2)

Owns guides alphabetically through `i18n` under `site/app/docs/guides/`, one writer, one tree.

- Verification: `bun run site:build`, `bun run check:links`, `bun run check:parity`, then every path from `rg -l truth src scripts`. `.test.ts` paths need `bun test <paths>`; `bun <file>` errors `Cannot use describe outside of the test runner`.
- `site:build` can fail `Another next build process is already running` when a sibling lane builds. Check with `ps -Ao pid,ppid,etime,command | rg 'next build'`; do not kill it, retry when gone.
- Clipboard images are implemented, not `not-implemented`: `src/plugins/clipboard-image.ts` + `darwinClipboardAdapter()` return `{ ok: true, png }` / `{ ok: true, written: true }`. The docs page claimed `not-implemented`; fixed.
- The build wrapper's extension block is `async function extensionPlugins()` with guarded dynamic imports, closed by `registry.register(...(await extensionPlugins()))` (`src/extensions/entry-source.ts`, `src/cli/build/wrapper.ts`). Static `import extension0` and `registry.register(extension0)` are stale; docs fixed. The crash-guard import is the only static one.
- Every i18n answer carries `dir` (`ltr`/`rtl`) from `textDirection`; the docs shape tables omitted it; fixed.
- Crash record `si_code` 2 is `SEGV_ACCERR`, not `SEGV_ACERR`; docs fixed.
- Proofs: 59 routes, `check:links` PASS, `check:parity` PASS (56 rows), truth files PASS (39 tests, 6 files).
- Frontmost app before and after: Brave Browser. No GUI launched, so no focus hand-back needed.
