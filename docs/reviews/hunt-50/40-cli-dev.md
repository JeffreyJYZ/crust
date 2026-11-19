# Hunt 50 / 40 — `src/cli/dev/` (reload and restart)

Read-only source review. Count: **6 findings** (1 high-leaning-worst, 1 high, 1 medium-high, 2 medium/low, 1 low). No code changed.

## WORST — recursive main watch restarts the backend on unignored build output and `.git` writes

**Where:** `src/cli/dev/runtime.ts:126` (`watch(dirname(options.entry), { recursive: true }, …)`) together with `src/cli/dev/ignore.ts:4` (`IGNORED = /(^|[/\\])(public|dist|node_modules|\.next|out|\.crust)([/\\]|$)/`). The gate at `runtime.ts:134` is the only filter before `restart()`.

**Mechanism:** `dirname(entry)` is the project root for every shipped scaffold — `templates/{default,next,react,svelte,vue}/main.ts` all sit at root, and `devBackendEntry` (`src/cli/dev.ts:49-54`) prefers root `main.ts` whenever the HTML module is `src/main.ts`. A recursive watch on the root therefore covers `.git/**`, `native/target/**`, `zig-out/**`, editor swap files, and any other generated tree. `isIgnoredWatchPath` whitelists only `public|dist|node_modules|.next|out|.crust`, so each such write passes the gate and reaches `restart()` (`runtime.ts:111-124`), which kills the runtime at `:122`. The respawn at `:174` re-runs `main.ts`, mints a new bridge token and opens a new window.

This directly defeats the guard the same file adds three lines later: `runtime.ts:147-149` makes the *extension* watcher non-recursive precisely because "compiler output lives in child dirs such as `target/` and `zig-out/`, and a recursive watch would fire on each generated object and spin the restart loop." The main recursive watcher reintroduces the spin the extension watcher was built to avoid.

**How it is reached:** `crust dev` in any scaffold (root `main.ts`), then either compile a native extension (`native/target/**` objects stream in over seconds) or run `git add`/`git commit` while dev is running (`.git/index` is rewritten). Each burst fires the watcher, `restart()` debounces 150 ms, the child is killed and respawned; a multi-second compile bursts repeatedly, so several restarts and several new windows occur during one build. Each restart rotates the bridge token and abandons the window the user was looking at.

**Smallest fix:** add `target`, `zig-out`, `.git` to `IGNORED` in `src/cli/ignore.ts:4` (or make the root watch non-recursive and watch explicit source dirs). Keep the extension watcher non-recursive.

## HIGH — backend restart strands the open window; only a duplicate window recovers

**Where:** `src/cli/dev/runtime.ts:111-124` and `:172-175`; `src/cli/dev.ts:169-173`.

**Mechanism:** Restart kills the runtime, so `startBridge` (`src/bridge/server.ts:40`) mints a fresh `crypto.randomUUID()` token and binds a fresh ephemeral port on respawn. No code publishes a reload on the restart path — `dev.ts:171-173` advances the reload token only from `watchPublic` on `public/` changes, and a backend edit lives outside `public/`. The already-loaded window keeps the old bridge URL in `location.search`, its `EventSource` stream died with the old bridge, and nothing re-navigates it; invokes now carry a dead token against a dead port. The only way a working window reappears is the respawned `main.ts` calling `window.create()` again, which opens a second window and leaves the first one dead. The comment at `src/cli/ignore.ts:2` acknowledges the token-rotation failure but the code only suppresses the *trigger* for frontend edits — it never recovers from a real backend restart.

**How it is reached:** any genuine backend edit in plain-HTML `crust dev` — edit `main.ts`, an extension file (`runtime.ts:150-156`), or `native/*.c` (`:150-156` with `nativeDir`).

## MEDIUM-HIGH — SIGINT during crash-respawn kills the stale child and orphans the new one

**Where:** `src/cli/dev/runtime.ts:158-165` (`stop()` kills `child`), `:184-188` (`await new Promise(wake = resolve)` then `child = await spawnRuntime(options)`), and `:170-171` (`const code = await child.exited; if (stopping) return 0;`).

**Mechanism:** After a nonzero exit the loop waits at `:184-186` with `wake` set. A file change resumes it and execution reaches `child = await spawnRuntime(options)` at `:188`. If SIGINT/SIGTERM lands during that `await`, `stop()` sets `stopping = true`, calls `wake?.()` (now `undefined`) and kills `child` — which still references the *already-dead* previous process. The spawn then completes and reassigns `child` to a live process that nobody kills. Back in the loop, `:170` awaits that new child's `exited` *before* checking `stopping` at `:171`, so the CLI blocks with an orphaned app window rather than exiting.

**How it is reached:** backend crashes (nonzero exit), a file edit arrives to resume it, and Ctrl-C is pressed while `spawnRuntime` is awaiting `projectCrustRoot`/`devEntryPath`/`Bun.spawn` (`runtime.ts:31-33, 62-79`).

## MEDIUM — frontend component formats are missing from the dev.url skip, so HMR edits restart the runtime

**Where:** `src/cli/ignore.ts:15` (`FRONTEND_SOURCE` regex) applied at `src/cli/dev/runtime.ts:139`.

**Mechanism:** With a `dev.url`, `runtime.ts:139` ignores a change only when `isFrontendSource(filename)` is true. The regex covers `.tsx/.jsx/.css/.scss/.sass/.less/.html/.svg/.png/.jpg/.webp/.woff` but not `.vue`, `.svelte`, `.astro`, `.mdx`, or `.json`. The templates `svelte/main.ts` and `vue/main.ts` are root backend entries whose frontend sources are exactly those missing extensions. Editing one therefore calls `restart()`, rotating the bridge token and opening a new window while Vite HMR is already handling the same file — the race lines `runtime.ts:135-138` and `ignore.ts:12` were written to prevent.

**How it is reached:** `crust dev` on the Vue or Svelte scaffold (`config.dev.url` set, root `main.ts`), then save `src/App.vue` / `src/App.svelte`.

## LOW — `reloadGate` is dead code; the gate is duplicated and can drift

**Where:** `src/cli/dev/reload.ts:19-21` exports `reloadGate`, used only in `reload.test.ts:37-41`. Production uses the inline forms `reload.ts:54` (`if (devUrl !== undefined) return undefined`) and `dev.ts:166` (`if (devUrl === undefined)`).

No runtime impact today, but the tested predicate and the live gate are two copies; a change to one will not be covered by the tests of the other.

## LOW — initial reload token is published fire-and-forget, allowing a spurious startup reload

**Where:** `src/cli/dev.ts:170` (`void publishReload(file, String(token))`), `reload.ts:24-30` (`tokenOf` in `src/bridge/server/events.ts:24-30, 53-55`).

**Mechanism:** `publishReload` is not awaited before `watchRuntime` spawns the bridge child. If the child's `Events` constructor reads the signal file before the `"0"` write lands, `reloadToken` is `""`; the later `"0"` write then satisfies `next.length !== 0 && next !== this.reloadToken` (`events.ts:71`) and emits a `dev:reload` frame for a change nobody made.

**How it is reached:** cold `crust dev` in plain-HTML mode where the bridge binds before the scratch-file write completes (no `dev.url`, so the reload watcher is installed at `dev.ts:166-174`).

---

Verification basis: `read` of the ten files in `src/cli/dev/` plus `src/cli/dev.ts`, `src/cli/ignore.ts`, `src/bridge/server/events.ts`, `src/bridge/server/assets.ts`, `src/runtime.ts`, and the scaffold `main.ts` files; symbol/caller search via `rg`. Findings are source-reasoned, not executed.
