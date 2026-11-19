# Scaffolds — templates and examples

## High — `--next` scaffold never quits when its window closes
- where: `templates/next/main.ts:1-8` (no `window-all-closed` listener); compare `templates/default/main.ts:14-16`, `templates/react/main.ts:16-18`, `templates/svelte/main.ts:16-18`, `templates/vue/main.ts:16-18`.
- mechanism: `src/app.ts:162` only installs the every-window-closed watcher when a `window-all-closed` listener exists. Without one, `platform.pump()` keeps the process alive forever after the last window closes. The darwin platform has no `applicationShouldTerminateAfterLastWindowClosed` fallback (`read`).
- reachable by: `crust init app --next` → `bun install` → `crust dev` → close the window. The window disappears but the process and pump stay alive, so the user must kill it from the terminal.
- smallest fix: add the same two-line `app.on("window-all-closed", …)` block the other four scaffolds ship. The listener body can be a no-op; registration is what arms the quit watcher.
- evidence: `measured` with a fake `Platform` (`createApp().attach(...)`, `await run()`, `destroy("main")`, 700 ms wait): `quits` stayed `0`; adding no listener reproduced the Next scaffold exactly. No GUI launched.

## Medium — Every scaffold's grant comment claims least privilege but grants every app command
- where: `templates/default/crust.config.ts:8-14`, `templates/next/crust.config.ts:12-18`, `templates/react/crust.config.ts:9-15`, `templates/svelte/crust.config.ts:9-15`, `templates/vue/crust.config.ts:9-15`.
- mechanism: each says "this grant names the one action the page actually uses", but `src/bridge/server/actions.ts:10-13,39-42` keeps the wire action `app:invoke` as a second candidate for *every* dispatched app command. The grant therefore covers every `app.command`, present and future, not just `greet`.
- reachable by: scaffold an app → add a second sensitive `app.command("deleteAccount", …)` → page calls `invoke("deleteAccount")`. `candidateActions` returns `["app:deleteAccount","app:invoke"]`; the gate allows through `app:invoke`. The scaffold's own test (`scripts/release/template-security.test.ts:49-56`) maps `invoke("greet")` to `app:invoke` and only checks that action, so a broad grant passes.
- smallest fix: grant the narrow form the gate now supports, `app:greet`, in all five configs and fix the comment. Keep `app:invoke` only in a comment noting it is the legacy broad alias.
- nuance: `site/app/docs/guides/permissions/page.mdx:55-58` deliberately documents the broad scaffold default so new commands work without a config edit. The defect is the in-scaffold comment asserting the opposite of what the grant does; this is not a newly opened security hole. (`read` + `measured` gate probe.)

## Medium — Three frontend scaffolds call `window.crust` with no type declaration
- where: `templates/react/src/main.tsx:73`, `templates/svelte/src/App.svelte:19-20`, `templates/vue/src/App.vue:20-21`.
- mechanism: the `crust` package ships no ambient `Window.crust` declaration. `src/bridge/client/types.ts:84` declares `crust?: unknown` on `CrustTarget`, not on `Window`; the only `declare global` blocks are in `templates/next/app/page.tsx:12-16` and `examples/dogear/src/bridge.tsx:19-23`, and dogear's own comment (`bridge.tsx:5`) says "The package ships no ambient declaration for it". Vite's esbuild strips types without checking, so the build passes while the editor shows `TS2339` on the first line a new user is told to read.
- reachable by: scaffold `--react`/`--svelte`/`--vue` → open `src/main.tsx` / `App.svelte` / `App.vue` in any TS-aware editor, or add `tsc --noEmit`. `window.crust` is an error; `.then((value) => …)` additionally infers `any` under `strict`.
- smallest fix: copy the small `CrustInvoke` interface + `declare global { interface Window { crust: CrustInvoke } }` from the Next template into each of the three scaffolds (svelte/vue need a `tsconfig.json` for the editor to pick it up).
- evidence: `measured` — `tsc --noEmit` on a minimal file with `lib: ["dom"]` and `strict: true` gives `TS2339: Property 'crust' does not exist on type 'Window & typeof globalThis'` plus `TS7006` on the callback parameter.

## Low — Notes and dogear examples teach raw-Node filesystem calls on a false "fs has no X" premise
- where: `examples/notes/crust.config.ts:6-7`, `examples/notes/main.ts:132-135`, `examples/notes/README.md:88-90`, `examples/dogear/desktop/main.ts:2-7`, `examples/dogear/README.md:14-16`.
- mechanism: these claim `crust:fs` lacks `remove`, `list` and `mkdir`, and use `unlink`/`readdir`/Node `mkdir` instead. The plugin provides all three: `src/plugins/fs.ts:151` (`list`), `src/plugins/fs.ts:178` (`remove`), `src/plugins/fs-binary.ts:91` (`mkdir`); the reference page lists them at `site/app/docs/reference/api-fs/page.mdx:15-18`.
- reachable by: a reader copies the example's pattern into a real app, then configures `fs.scope` for safety — the raw Node calls bypass that scope, because only plugin commands go through `scoped()` at `src/plugins/fs.ts:100-107`. The example's stated reason for the bypass ("the plugin has no command") is false.
- smallest fix: use `fsPlugin.commands.remove/list/mkdir` (or drop the stale claims if raw Node is deliberate). At minimum delete the "v1 has no remove/mkdir" sentences, which are wrong today.
- evidence: `read` of plugin source and docs; no runtime claim.

## Low — Vanilla scaffold's gitignore omits `.crust/`, which `crust dev` writes
- where: `templates/default/gitignore:1-4` (no `.crust/`); all four other templates include it (e.g. `templates/react/gitignore:4`).
- mechanism: plain-HTML dev has no `dev.url`, so `src/cli/dev.ts:167-171` publishes `RELOAD_FILE = ".crust/dev-reload"` (`src/bridge/server/events.ts:20`) into the project directory. The vanilla scaffold does not ignore that directory.
- reachable by: `crust init app` → `crust dev` → `git status` shows an untracked `.crust/dev-reload` holding only a reload counter. A new user commits or hand-deletes framework scratch that every other scaffold already ignores.
- smallest fix: add `.crust/` to `templates/default/gitignore`.
- evidence: `read`. No GUI launched; scratch-file creation inferred from `publishReload` call path, not observed.

## Checked and clean
- `measured` — All 10 pinned third-party versions in the five templates exist on the registry (`bun info <pkg> version`): next 16.4.6, react 19.3.1, svelte 5.57.3 (5.58.0 is latest; caret covers it), vue 3.5.45, vite 8.3.8, all three Vite framework plugins, typescript 7.0.2, @types/node 26.6.6. `git ls-remote` confirms `v0.1.32`, the tag `init` pins, exists.
- `read` — Each Vite/Next scaffold's `dev.url` port matches its `server.port`/`next dev -p` and `strictPort`, and `build.assets` matches `build.outDir`/Next `out/`; scripts/release/template-frameworks.test.ts and template-build.test.ts assert this pairing. Bridge origin allowlist and asset resolver agree with those choices.
- `read` — All five scaffolds grant a capability that covers their own `invoke("greet")` calls; `scripts/release/template-security.test.ts` runs every extracted action through the real capability matcher, and `crust init`'s token substitution leaves no `{{…}}` in a written config (`src/cli/init.ts:106-133`).
- `measured` — No file under `templates/` or `examples/` exceeds 200 lines (`wc -l` over all files, max well under the cap).
- `read` — Example plugin call shapes match the current plugins: dogear's `fs.list/stat/readTextFile/writeTextFile/rename/remove`, `window.setTitle/close/focus`, `dialog.openPanel/savePanel/cancel`, `tray.setTitle/setMenu`, and multi-window's `window.create/setPosition/setSize/getPosition/getSize/list/close` all exist with those argument names. The stale claims above are prose, not broken calls.
- `read` — `examples/native/README.md:36-41` honestly states native extensions do not work in a built app; not a defect.
- Unsettled, not a finding: `templates/next/app/about/page.tsx:8` claims `output: "export"` emits `/about/index.html` (Next's default is `about.html` without `trailingSlash: true`). I did not build the Next scaffold — Next/React are not installed in the checkout and building needs a network install. Settling it needs `bun install` in a `--next` scaffold, `next build`, and `ls out`; the bridge's SPA fallback (`src/bridge/server/handler.ts:126-129`) may make the route work regardless of the filename.
