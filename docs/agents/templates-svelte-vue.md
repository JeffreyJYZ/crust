# Lane D — Svelte and Vue templates (butter-parity)

## What landed

- `templates/svelte/**` and `templates/vue/**`: 8 files each, mirroring `templates/react` — same `crust.config.ts` shape, `dev.url` pinned to 5173, `build.assets: "dist/web"`, `beforeBuildCommand` running Vite, `vite.config.ts` with the framework plugin plus `crust()`. `.gitignore` is renamed on copy, so the standalone gate sees 7 globbed files per template (React sees 6).
- `src/cli/init.ts`: `TEMPLATES` gains `svelte`/`vue`; a single `FRAMEWORKS` list drives mutual exclusion and selection, so adding a ninth flag cannot leave one path behind. Error names every flag passed. `VITE_HINT` shared by the three Vite scaffolds.
- `src/cli/parse.ts`: `--svelte`/`--vue` parsed and gated to `init` like the older flags.
- `src/cli/usage.ts`: all four scaffolds listed in the synopsis and options.
- `scripts/build-standalone.ts`: count table gains `["--svelte", 7]` and `["--vue", 7]`. The file was already 199 lines, so two two-line comments were collapsed to one line each; the count stays at 199 without trimming a measured reason.
- Tests: `src/cli/init.test.ts` (scaffold per flag, token substitution, file counts, two-flag refusal, flags outside init, help, anti-drift against the gate's count table); `scripts/release/template-frameworks.test.ts` (config/plugin/page/deps shape for both templates). `src/cli/parse.test.ts` untouched.

## Measurements and decisions

- Dependency ranges read from the registry on 2026-11-17: svelte 5.57.3, `@sveltejs/vite-plugin-svelte` 7.3.1 (peer vite ^8, svelte ^5.46.4), vue 3.5.45, `@vitejs/plugin-vue` 6.0.11 (peer vite ^8). Vite stays `^8.3.8`, matching React.
- Svelte component is plain `<script>` with the `$state` rune: Svelte 5 detects the rune without `svelte.config.js` or a preprocess dependency, so the template needs no TS toolchain. Vue uses `<script setup lang="ts">`, which `@vitejs/plugin-vue` handles directly.
- Both scaffolds call `window.crust.invoke("greet", …)` on mount, so they prove the bridge the same way React does.

## Gate at report time

- `bun check <my files>`: clean (8 files). `bun test src/cli/init.test.ts src/cli/parse.test.ts scripts/release/template-frameworks.test.ts`: 28 pass, 0 fail. `bun fmt <my files>` applied; `check:lines`: my files all under 200.
- Whole-tree gates were red from Lane B's `src/plugins/sidecar.ts` only: TS2322 at line 173 (`env: { ...process.env }` into `Record<string, string>`) and 207 lines over the cap. Not mine; coordinator re-runs after that lane lands.
- No build or full suite run, per the shared brief while twelve lanes write at once.

## Not fixed — other owners

- `src/cli/doctor/build-assets.ts:79` hard-codes `TEMPLATES = ["default", "react", "next"]`; the doctor detail line will not name the two new scaffolds. Doctor's file, not mine.
- `scripts/verify-package/phases/install.ts:61` exercises only `--react`; `scripts/e2e-dev-react.ts` likewise. Neither owns a new e2e lane here.
- `site/app/docs/reference/parity/page.mdx` needs the honest Svelte/Vue row; it was already being edited by another lane.
