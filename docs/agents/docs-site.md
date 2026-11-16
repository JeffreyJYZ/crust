# docs-site lane

Lane memory for work under `site/`. Measured 2026-11-16 at `5ddbf86` plus the in-flight tree.

## What this lane added

- Fifteen pages: `guides/{theme,dock,power,accessibility,navigation,find-in-page,downloads,network,crash-reports,i18n,package-formats,notarize,extensions,native-extensions}` and `reference/platforms`.
- `site/lib/nav.ts` carries every one of them, so `check:links` is what proves registration rather than a count.
- `reference/parity` went 32 rows to 42; the ten new names are Tauri-less surfaces, so `check:parity` prints them as `unlisted 10` and still exits 0.
- `design/page.mdx` gained "How a page loads": bridge URL, no page-serving scheme, `urlScheme` optional with no default, five-method `Platform`.

## Measured facts the docs now state

- Registered by the runtime on darwin: `theme`, `dock`, `power`, `accessibility` (`src/runtime-plugins.ts:134-137`).
- Module only — not registered and not re-exported by `crust/plugin`: `navigation`, `findinpage`, `downloads`, `network`, `crash-reporter`, `i18n`.
- `findinpage.matches` is 0 or 1 because `WKFindResult` carries only `-matchFound`; `clear` refuses naming `-_clearFindIndicator`.
- `network` intercepts only the `crust-net` scheme, first rule wins, no match allows, log capped at 100.
- `crash-reporter` needs `startCrashGuard()` first and answers `not-implemented` without it; the guard refuses inside a compiled binary because `import.meta.path` is unreadable there.
- `i18n.setLocale` is in-memory because macOS owns the language list; plurals use `Intl.PluralRules` and collapse to `_other`.
- `downloads` default root is `<app data>/downloads`; `setDirectory` refuses a relative path or one outside the root, sibling prefix included.
- `loadPlatform` throws `crust: no platform for <platform> — macOS only for v1`, so Linux and Windows are reachable only from a test.
- Packaging and native-extension builders are CLI-reachable: `crust package --format dmg|appimage|nsis` and `crust notarize` both exist (`src/cli/package.ts`, `src/cli/notarize.ts`); the earlier "library only" reading was a mid-write tree.
- `crust package` prints one line per format, sets exit 1 for a missing tool **without throwing** so the rest still build, and refuses an AppImage without `app.icon` verbatim: `appimage  unavailable  app.icon is not set — it needs a 512×512 PNG`.
- `crust notarize` decides its preflight before any bundle lookup, so a missing certificate prints `notarize refused   ad-hoc identity cannot be notarized — requires a Developer ID Application certificate` and exits 1 with no command run.
- `defineExtension` is exported at `crust/extension` and `loadExtensions` at `crust/extensions` (`package.json` exports); only the `crust/plugin` barrel re-export is pending.
- `crust build` now embeds extensions: `src/cli/build/wrapper.ts` writes `extensionEntrySource` imports plus `registry.register(…)` before `startApp`.
- Registration of all six newer plugins has landed (`src/runtime-plugins.ts:182-190`): navigation, findinpage, downloads, network, crash-reporter, i18n, each exported from a split barrel — so parity now reads 31 same · 8 via Bun · 3 partial · 0 module only · 42 rows, and `module only` survives in the legend as a definition only.
- The three partial rows are the durable limitations, not registration gaps: find's `matches` is 0 or 1 with `clear` on a private selector, network intercepts only its own scheme, the crash reporter needs its guard and refuses in a compiled binary.

## Traps

- `sed` is blocked in this repo's agent shell; use `read` with offset/limit for line ranges.
- `rg -rn 'a|b' src` is a replace, not recursive-plus-lines — it printed every match mangled and cost a turn.
- `ls -1t` is eza's `--time <field>`; it errors and prints nothing, which reads as "no files".
- `next build` takes a project-wide lock: a sibling lane's build makes it answer `Another next build process is already running` and exit 1, which is not a defect in the docs. Check `ps -Ao pid,command | rg "next build"` before retrying.
- A page must not invent an import path it cannot resolve; when a symbol is not exported, say so and show the shape without the import line.
- Extra parity rows are allowed and print `unlisted N`; only a missing official name fails the check.
- **Any `| ` table anywhere in `parity/page.mdx` is parsed as a parity row** — a status-count table added `status, same, via Bun, partial, module only, **total**` to the checker's 42 and printed `unlisted 16`. Counts go in a bullet list.
- The tree moves under this lane: two of my pages had their status lines rewritten by another session between turns, and `runtime-plugins.ts` gained registration mid-task. Re-read the file before editing it, and never restate a "does not exist" claim without a fresh `ls`.
- A status flip is not a parity-page edit alone — the same sentence sits at the top of each surface guide, so grep `module only` across `site/app/docs/guides` in the same pass or the pages contradict each other.
- **`check:lines` walks `src/` too**, so another lane's oversized file fails this lane's gate (`src/plugins/dock.test.ts` at 213 lines, 2026-11-16). It is untracked and not mine — report it, never edit it.
- Platform status is a moving claim: `loadPlatform` now dispatches to darwin/linux/win32, Linux is proven by `bun run e2e:linux` (8/8, real GTK3 + WebKitGTK 4.1 under Xvfb), and Windows has still never run. Re-read `scripts/e2e-linux.ts` and the `gate (windows)` job before restating any of it.
- Hardened surfaces refuse rather than silently narrow, and each refusal string is verbatim in the page: `crash-reporter.clear` answers `page-cannot-clear` (runtime-only `clearCrashes(root)`), `shell.spawn` answers `env-not-allowed` without `createShellPlugin({ env: true })`, and `fs.scopeAllow` answers `outside-scope`-style `grants is "runtime"` unless the host opts in.
- `bun fmt` with an explicit path list does format `.mdx` (4 files, 2.58 ms) — run it on the pages changed, then re-run build/links/parity/lines because a table reflow can change what `check:parity` parses.
- `bun fmt site` is the area-wide fix and is safe: it reformatted 26 files on 2026-11-16 (23 `.mdx`, `global-error.tsx`, `sidebar.tsx`, `tsconfig.json`) with no behaviour change — build, links, parity and lines all stayed green, and `bun fmt --check site` then reports `All 65 files are formatted`.
- The repo-wide `bun fmt --check src scripts examples site` can still name a file under `src/` that another lane owns (e.g. `src/plugins/updater-install.test.ts`); report it and leave it alone.
- The updater is registered by the runtime when the config has an `updater` section, so the old "module only" line was stale; its three hardening refusals (`sha256` required, `updater.pubkey` pinned, verified-artifact-only install) are quoted verbatim on the page, and `unverified-artifact` / `hash-mismatch` are the two codes a page meets first.
- A signed `.app` download cannot verify end to end: `download` records one artifact and the signature covers its bytes, so a file (zip/dmg/tarball) verifies sha256 + Ed25519 while a bundle tree verifies sha256 only. The page states it as a named limitation and says to ship a signed archive, extract inside the download, and let the receipt gate `install`. The probe line is `signed=true swapped=true unverified=refused`.
- `renderExtensionImports` emits `registry.register(extension0)` from a **default** import; `extension0.default` is `undefined` and the registry refuses it (`register: not a plugin definition`). The generated entry in `examples/extensions/dist/crust-entry.ts` is the shape to copy, never a remembered one.

## Decisions

- One page per surface, grouped under Guides, because a reader arrives looking for a capability rather than a plugin list.
- Every unregistered surface opens with a bold `Status: module only` line, so the page cannot be read as a shipped runtime behaviour.
- Packaging and extensions pages say "library only" rather than documenting a CLI command that does not exist at this revision.
- `reference/platforms` states the darwin refusal verbatim instead of implying Linux or Windows work.
